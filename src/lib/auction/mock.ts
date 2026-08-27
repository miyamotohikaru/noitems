import "server-only";

import {
  AUCTION_STARTS_AT,
  EXTEND_BY_SEC,
  EXTEND_WINDOW_SEC,
  LOT_ID,
  MIN_INCREMENT,
  START_PRICE,
  bidCeiling,
  resolveEndsAt,
} from "./config";
import type {
  AuctionProvider,
  AuctionState,
  Bid,
  BidInput,
  PlaceBidResult,
} from "./types";
import { nextMinimumBid, validateBid } from "./types";

/**
 * 土台用のダミー。挙動は本番と同じ形をしているが、値はサーバーのメモリ上にしかない。
 * Webkul を入れたらこのファイルは使われなくなる。
 *
 * 認証がまだ無いので「見ている人」はプロセスに1人だけ。
 * 本番では顧客IDごとに viewer を作ることになる。
 */

const SEED_CURRENT = 1_240_000;
const SEED_COUNT = 25;

/** 相手が入札し返してくるまでの間。抜かれたときの画面を実際に確認できるように */
const COMPETITOR_DELAY_MS = 45_000;

type MockState = {
  currentBid: number;
  bidCount: number;
  endsAt: string;
  extended: boolean;
  bids: Bid[];
  myMaxBid: number | null;
  /** 冪等キー。同じ requestId の再送はもう一度数えない */
  seenRequests: Map<string, number>;
};

let store: MockState | null = null;

/** 終了時刻から逆算した固定の履歴。SSRとクライアントで必ず一致する */
function seedBids(endsAt: Date): Bid[] {
  const minutesAgo = [192, 274, 331, 468, 592, 735, 902, 1105];
  return minutesAgo.map((m, i) => {
    const no = SEED_COUNT - i;
    return {
      id: `seed-${i}`,
      amount: SEED_CURRENT - i * MIN_INCREMENT,
      // 同じ人が複数回入札しているように見せる（履歴の信頼性はここで担保される）
      bidderId: `b${(no % 5) + 1}`,
      bidderLabel: `入札者 ${String((no % 5) + 1).padStart(2, "0")}`,
      placedAt: new Date(endsAt.getTime() - m * 60_000).toISOString(),
    };
  });
}

function initial(): MockState {
  const endsAt = resolveEndsAt();
  return {
    currentBid: SEED_CURRENT,
    bidCount: SEED_COUNT,
    endsAt: endsAt.toISOString(),
    extended: false,
    bids: seedBids(endsAt),
    myMaxBid: null,
    seenRequests: new Map(),
  };
}

function current(): MockState {
  if (!store) store = initial();
  return store;
}

/**
 * 自分が最高額のまま少し経ったら、相手が積んでくる。
 * 「抜かれた」状態を目で確認できないと、その画面は誰にもレビューできない。
 */
function maybeCompete(s: MockState) {
  const top = s.bids[0];
  if (!top?.mine) return;
  if (Date.now() - new Date(top.placedAt).getTime() < COMPETITOR_DELAY_MS) return;
  if (Date.now() >= new Date(s.endsAt).getTime()) return;

  const amount = s.currentBid + MIN_INCREMENT;
  s.bids = [
    {
      id: `rival-${Date.now()}`,
      amount,
      bidderId: "b3",
      bidderLabel: "入札者 03",
      placedAt: new Date().toISOString(),
    },
    ...s.bids,
  ].slice(0, 24);
  s.currentBid = amount;
  s.bidCount += 1;
}

function toPublic(s: MockState): AuctionState {
  const now = Date.now();
  const startsAt = new Date(AUCTION_STARTS_AT);
  const ends = new Date(s.endsAt);

  const status =
    now < startsAt.getTime() ? "scheduled" : now < ends.getTime() ? "live" : "ended";

  return {
    lotId: LOT_ID,
    status,
    currentBid: s.currentBid,
    startPrice: START_PRICE,
    minIncrement: MIN_INCREMENT,
    maxBid: bidCeiling(s.currentBid),
    bidCount: s.bidCount,
    startsAt: startsAt.toISOString(),
    endsAt: s.endsAt,
    extendWindowSec: EXTEND_WINDOW_SEC,
    extendBySec: EXTEND_BY_SEC,
    extended: s.extended,
    bids: s.bids.slice(0, 12),
    viewer: {
      isHighest: Boolean(s.bids[0]?.mine),
      myMaxBid: s.myMaxBid,
    },
    serverNow: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };
}

export const mockAuctionProvider: AuctionProvider = {
  name: "mock",

  async load() {
    const s = current();
    maybeCompete(s);
    return toPublic(s);
  },

  async placeBid({ amount, requestId }: BidInput): Promise<PlaceBidResult> {
    const s = current();
    maybeCompete(s);

    // 同じ送信が二度届いたら、二度は数えない
    const seen = s.seenRequests.get(requestId);
    if (seen !== undefined) return { ok: true, state: toPublic(s) };

    const state = toPublic(s);

    if (state.status === "scheduled") {
      return {
        ok: false,
        code: "NOT_LIVE",
        message: "オークションはまだ始まっていません。",
        state,
      };
    }
    if (state.status === "ended") {
      return {
        ok: false,
        code: "ENDED",
        message: "オークションは終了しました。",
        state,
      };
    }

    const invalid = validateBid(state, amount);
    if (invalid) return { ok: false, ...invalid, state };

    const now = Date.now();
    const end = new Date(s.endsAt).getTime();

    // 終了間際の入札は終了時刻を後ろへずらす
    const willExtend = (end - now) / 1000 <= EXTEND_WINDOW_SEC;
    if (willExtend) {
      s.endsAt = new Date(end + EXTEND_BY_SEC * 1000).toISOString();
      s.extended = true;
    }

    s.currentBid = amount;
    s.bidCount += 1;
    s.myMaxBid = Math.max(s.myMaxBid ?? 0, amount);
    s.bids = [
      {
        id: `bid-${now}`,
        amount,
        bidderId: "me",
        bidderLabel: "あなた",
        placedAt: new Date(now).toISOString(),
        mine: true,
      },
      ...s.bids,
    ].slice(0, 24);

    s.seenRequests.set(requestId, now);
    if (s.seenRequests.size > 200) s.seenRequests.clear();

    return { ok: true, state: toPublic(s) };
  },
};

export { nextMinimumBid };
