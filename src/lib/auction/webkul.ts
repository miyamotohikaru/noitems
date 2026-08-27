import "server-only";

import {
  EXTEND_BY_SEC,
  EXTEND_WINDOW_SEC,
  LOT_ID,
  MIN_INCREMENT,
  bidCeiling,
  webkul,
} from "./config";
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
 *   WEBKUL_AUCTION_ENDPOINT  … 既定は https://sp-auction.webkul.com/product-auction-api
 *   WEBKUL_API_KEY           … refresh token（/api/user/refresh に渡すもの）
 *   WEBKUL_AUCTION_ID        … このロットに割り当てられたオークションID
 *
 * ⚠️ 認証ヘッダの正確な書式は公開資料に無い。Bearer で通らなければ
 *    AUTH_HEADER のところだけ差し替える。
 */

const BASE =
  webkul.endpoint || "https://sp-auction.webkul.com/product-auction-api";

/* ── トークン ───────────────────────────────────────
   refresh token を渡して access token をもらい、期限まで使い回す */

let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const res = await fetch(`${BASE}/api/user/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: webkul.apiKey }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`webkul: refresh failed (${res.status})`);

  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) throw new Error("webkul: no access_token in response");

  cached = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return cached.token;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      // ここが通らなければ書式を差し替える
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`webkul: ${path} failed (${res.status})`);
  return (await res.json()) as T;
}

/* ── 型（APIの生の形） ───────────────────────────── */

type RawAuction = {
  id: string;
  start_date: string;
  end_date: string;
  auction_status: string;
  reserve_price: string;
  start_price: string;
  bid_winner_amt: string | null;
  max_bid: string | null;
  total_bid: string | null;
  extend_deadline_within?: { type: string; value: number };
  extend_deadline_by?: { type: string; value: number };
};

type RawBidList = {
  Auction_id: string;
  total_bids: string;
  max_bid: string;
  bids: Array<{
    id: string;
    bid_amount: string;
    is_public: string;
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

/** {type:"minutes", value:5} を秒に */
function toSeconds(
  v: { type: string; value: number } | undefined,
  fallback: number,
): number {
  if (!v) return fallback;
  const unit = v.type.toLowerCase();
  const mult = unit.startsWith("hour") ? 3600 : unit.startsWith("sec") ? 1 : 60;
  return v.value * mult;
}

/** 実名は出さない。同じ人は同じラベルになるよう頭文字だけ使う */
function label(first: string, last: string, isPublic: string, i: number): string {
  if (isPublic === "0") return `入札者 ${String(i + 1).padStart(2, "0")}`;
  const initials = `${(first || "").charAt(0)}${(last || "").charAt(0)}`.trim();
  return initials ? `${initials.toUpperCase()}. さん` : `入札者 ${String(i + 1).padStart(2, "0")}`;
}

function toState(a: RawAuction, list: RawBidList | null, viewerEmail?: string): AuctionState {
  const startPrice = num(a.start_price);
  const currentBid = num(a.max_bid, startPrice) || startPrice;
  const bids: Bid[] = (list?.bids ?? []).map((b, i) => ({
    id: b.id,
    amount: num(b.bid_amount),
    bidderId: `${b.first_name}${b.last_name}` || `b${i}`,
    bidderLabel: label(b.first_name, b.last_name, b.is_public, i),
    placedAt: toISO(b.bid_date),
  }));

  const status = a.auction_status?.toLowerCase();
  const now = Date.now();
  const startsAt = toISO(a.start_date);
  const endsAt = toISO(a.end_date);

  return {
    lotId: LOT_ID,
    status:
      status === "finished" || new Date(endsAt).getTime() <= now
        ? "ended"
        : new Date(startsAt).getTime() > now
          ? "scheduled"
          : "live",
    currentBid,
    startPrice,
    minIncrement: MIN_INCREMENT,
    maxBid: bidCeiling(currentBid),
    bidCount: num(a.total_bid ?? list?.total_bids),
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
  void viewerEmail;
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

    return toState(target, bidList);
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
