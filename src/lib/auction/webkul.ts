import "server-only";

import {
  EXTEND_BY_SEC,
  EXTEND_WINDOW_SEC,
  LOT_ID,
  MIN_INCREMENT,
  bidCeiling,
  webkul,
} from "./config";
import { nicknamesFor } from "../shopify/admin";
import type {
  AuctionProvider,
  AuctionState,
  Bid,
  BidInput,
  PlaceBidResult,
} from "./types";

/**
 * Webkul の Auction API に繋ぐ実装。
 *
 * 必要な環境変数（Vercel に登録する）
 *   WEBKUL_AUCTION_ENDPOINT  … https://sp-auction.webkul.com/product-auction-api
 *   WEBKUL_ACCESS_TOKEN      … 通信に使うトークン
 *   WEBKUL_API_KEY           … refresh token（access token が切れたときの引き換え券）
 *   WEBKUL_AUCTION_ID        … このロットに割り当てられたオークションID
 *
 * 2つとも Shopify管理画面 → アプリ → Webkul Product Auction → Api Credentials
 * の表にある。画面では20文字で切られて見えるが、文字をトリプルクリックすれば全文
 * （86文字）がコピーできる。Actions メニューには Disable しか無い。
 *
 * ── 実地で確かめた仕様（2026-09-30）。公開ドキュメントと食い違う ──
 *  - 認証は `Authorization: Bearer <access_token>`。
 *  - POST /api/user/refresh の本体は **キャメルケース**の
 *    `{accessToken, refreshToken}`。ドキュメントには `access_token` /
 *    `refresh_token` と書いてあるが、それだと "Missing parameter" で弾かれる。
 *  - 期限が切れる前に refresh を呼ぶと HTTP 405 /
 *    `{"Message":"Access Token not expired"}` が返る。つまり refresh は
 *    「切れてから」しか使えない。だから access token を種として持つ必要がある。
 *  - POST /api/auctions.json（オークション作成）は何を送っても 500 を返す。
 *    Webkul 側の不具合。オークションはアプリの画面から作ること。
 */

const BASE =
  webkul.endpoint || "https://sp-auction.webkul.com/product-auction-api";

/* ── トークン ───────────────────────────────────────
   環境変数の access token をそのまま使い、弾かれたときだけ refresh する。
   「切れる前の更新」を Webkul が拒むので、先回りして更新することはできない。 */

let current: string = webkul.accessToken;
/** 同時に何本もリクエストが来ても refresh は1回で済ませる */
let refreshing: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}/api/user/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // ⚠️ キャメルケース。ドキュメントのスネークケースでは通らない
        body: JSON.stringify({
          accessToken: current,
          refreshToken: webkul.apiKey,
        }),
        cache: "no-store",
      });

      const json = (await res.json().catch(() => null)) as {
        accessToken?: string;
        access_token?: string;
        refreshToken?: string;
        refresh_token?: string;
        Message?: string;
      } | null;

      // まだ切れていなければ今のトークンで続行してよい
      if (json?.Message === "Access Token not expired") return current;

      const next = json?.accessToken ?? json?.access_token;
      if (!next) {
        throw new Error(
          `webkul: refresh failed (${res.status}) ${json?.Message ?? ""}`,
        );
      }

      // refresh token が回っていたら分かるように残す。環境変数の更新が要る
      const nextRefresh = json?.refreshToken ?? json?.refresh_token;
      if (nextRefresh && nextRefresh !== webkul.apiKey) {
        console.warn(
          "[webkul] refresh token が更新された。WEBKUL_API_KEY を差し替えないと、" +
            "次にサーバーが立ち上がったとき認証できなくなる",
        );
      }

      current = next;
      return current;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

async function request(path: string, token: string, init?: RequestInit) {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res = await request(path, current, init);

  // 期限切れとみて1度だけ更新して入れ直す
  if (res.status === 401 || res.status === 403) {
    const token = await refreshAccessToken();
    res = await request(path, token, init);
  }

  if (!res.ok) throw new Error(`webkul: ${path} failed (${res.status})`);
  return (await res.json()) as T;
}

/* ── 型（APIの生の形） ───────────────────────────── */

/**
 * 実際に返ってくる形（2026-10-07 に実物で確認）。
 * ⚠️ 項目名がドキュメントの想定と違う。`maxBid` と `totalbid` はキャメルと
 *    全小文字が混在していて、スネークケースではない。
 * ⚠️ extend_deadline_* は**オブジェクトではなく JSON文字列**で来る。
 */
type RawAuction = {
  id: number | string;
  shopify_product_id?: number | string;
  product_title?: string;
  start_date: string;
  end_date: string;
  auction_status: string;
  reserve_price: string;
  start_price: string;
  bid_winner_amt: string | null;
  maxBid: string | null;
  totalbid: number | string | null;
  extend_deadline_within?: string | { type: string; value: number };
  extend_deadline_by?: string | { type: string; value: number };
};

type RawBidList = {
  Auction_id: string;
  total_bids: number | string;
  max_bid: string;
  bids: Array<{
    id: number | string;
    bid_amount: string;
    is_public: number | string;
    /** ⚠️ これがあるおかげでニックネームと突き合わせられる */
    shopify_customer_id: number | string;
    email_id: string;
    first_name: string;
    last_name: string;
    bid_date: string;
  }>;
};

/* ── 変換 ──────────────────────────────────────── */

const num = (v: string | null | undefined, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Webkul は "2021-10-13 12:01:18" のUTC文字列を返す */
function toISO(v: string | null | undefined): string {
  if (!v) return new Date().toISOString();
  const iso = v.includes("T") ? v : `${v.replace(" ", "T")}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/**
 * 延長設定を秒に直す。
 * Webkul は `"{\"type\":\"minutes\",\"value\":10}"` という**文字列**で返す。
 * 延長を設定していないオークションは `{"type":"","value":0}` になるので、
 * その場合はこちらの既定値を使う。
 */
function toSeconds(
  v: string | { type: string; value: number } | undefined | null,
  fallback: number,
): number {
  if (!v) return fallback;

  let parsed: { type?: string; value?: number } | null = null;
  if (typeof v === "string") {
    try {
      parsed = JSON.parse(v);
    } catch {
      return fallback;
    }
  } else {
    parsed = v;
  }

  const unit = (parsed?.type ?? "").toLowerCase();
  const value = Number(parsed?.value ?? 0);
  if (!unit || !Number.isFinite(value) || value <= 0) return fallback;

  const mult = unit.startsWith("hour") ? 3600 : unit.startsWith("sec") ? 1 : 60;
  return value * mult;
}

/**
 * 入札記録に出す名前。
 *
 * 本人が決めたニックネームがあればそれを出す。無ければ連番。
 * **Webkul が持っている本名は使わない。** 一点物の記録に実名が
 * 並ぶのは意図と違うし、本人の同意も取っていない。
 */
function label(nickname: string | undefined, i: number): string {
  return nickname ?? `入札者 ${String(i + 1).padStart(2, "0")}`;
}

function toState(
  a: RawAuction,
  list: RawBidList | null,
  nicknames: Map<string, string> = new Map(),
): AuctionState {
  const startPrice = num(a.start_price);
  const currentBid = num(a.maxBid, startPrice) || startPrice;
  const bids: Bid[] = (list?.bids ?? []).map((b, i) => {
    const customerId = String(b.shopify_customer_id ?? "");
    return {
      id: String(b.id),
      amount: num(b.bid_amount),
      bidderId: customerId || `b${i}`,
      bidderLabel: label(nicknames.get(customerId), i),
      placedAt: toISO(b.bid_date),
    };
  });

  // 実物は "Running"。終了すると "Expired" などに変わる
  const status = a.auction_status?.toLowerCase();
  const now = Date.now();
  const startsAt = toISO(a.start_date);
  const endsAt = toISO(a.end_date);

  return {
    lotId: LOT_ID,
    /**
     * ⚠️ 日付の文字列より auction_status を優先する。
     * Webkul が返す日時はUTCではなくアプリ側のタイムゾーンで、ずれがある。
     * 日付で判定すると、開催中のオークションが「開始前」に見えてしまう。
     * 向こうが Running と言っているなら開催中として扱う。
     */
    status:
      status === "finished" ||
      status === "expired" ||
      status === "stopped"
        ? "ended"
        : status === "running"
          ? "live"
          : new Date(endsAt).getTime() <= now
            ? "ended"
            : new Date(startsAt).getTime() > now
              ? "scheduled"
              : "live",
    currentBid,
    startPrice,
    minIncrement: MIN_INCREMENT,
    maxBid: bidCeiling(currentBid),
    bidCount: num(
      a.totalbid != null ? String(a.totalbid) : String(list?.total_bids ?? ""),
    ),
    startsAt,
    endsAt,
    extendWindowSec: toSeconds(a.extend_deadline_within, EXTEND_WINDOW_SEC),
    extendBySec: toSeconds(a.extend_deadline_by, EXTEND_BY_SEC),
    // Webkul は「延長されたか」を返さないので、この画面では出さない
    extended: false,
    bids: bids.slice(0, 12),
    // 認証を入れるまで「自分の入札」は判定できない
    viewer: { isHighest: false, myMaxBid: null },
    serverNow: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };
}

/* ── provider ──────────────────────────────────── */

export const webkulAuctionProvider: AuctionProvider = {
  name: "webkul",

  async load(): Promise<AuctionState> {
    const auctions = await call<RawAuction[] | { auctions: RawAuction[] }>(
      "/api/shop/auctions.json",
    );
    const list = Array.isArray(auctions) ? auctions : (auctions.auctions ?? []);
    const target =
      list.find((a) => String(a.id) === String(webkul.auctionId)) ?? list[0];
    if (!target) throw new Error("webkul: auction not found");

    let bidList: RawBidList | null = null;
    try {
      bidList = await call<RawBidList>(
        `/api/shop/auction/bidding_list/${target.id}.json`,
      );
    } catch {
      // 入札がまだ無いときに落ちることがある。金額だけでも出す
    }

    // ニックネームが引けなければ空のまま。記録自体は出す
    const nicknames = await nicknamesFor(
      (bidList?.bids ?? []).map((b) => String(b.shopify_customer_id ?? "")),
    );

    return toState(target, bidList, nicknames);
  },

  async placeBid({ amount, email }: BidInput): Promise<PlaceBidResult> {
    if (!email) {
      return {
        ok: false,
        code: "AUTH_REQUIRED",
        message: "入札にはメールアドレスが必要です。",
      };
    }

    try {
      const res = await call<{ Response?: boolean; message?: string }>(
        "/api/bids.json",
        {
          method: "POST",
          body: JSON.stringify({
            auction_id: webkul.auctionId,
            amount: String(amount),
            email,
            quantity: "1",
            public: "0", // 実名を出さない
            proxy_bid: "0",
          }),
        },
      );

      if (res.Response !== true) {
        return {
          ok: false,
          code: "UNKNOWN",
          message: res.message ?? "入札できませんでした。",
          state: await this.load(),
        };
      }
      return { ok: true, state: await this.load() };
    } catch (error) {
      console.error("[webkul] placeBid", error);
      return {
        ok: false,
        code: "NETWORK",
        message:
          "通信に失敗しました。入札は成立していません。もう一度お試しください。",
      };
    }
  },
};
