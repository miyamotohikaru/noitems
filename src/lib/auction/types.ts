/**
 * オークションの状態は、この型だけを介してUIに渡る。
 * Webkul に差し替えるときに触るのは provider の実装だけで、
 * components/ 側は一行も変えなくていい ── というのがこの層の目的。
 *
 * provider はサーバーでしか動かない（APIキーを持つため）。
 * ブラウザは /api/auction と /api/bid しか知らない。
 */

export type AuctionStatus = "scheduled" | "live" | "ended";

export type Bid = {
  id: string;
  /** 入札額（円・整数） */
  amount: number;
  /** 同一人物を追うための匿名ID。実名は出さない */
  bidderId: string;
  /** 表示用のラベル（例: 入札者 07） */
  bidderLabel: string;
  /** ISO8601 */
  placedAt: string;
  /** 見ている人自身の入札か */
  mine?: boolean;
};

/** 見ている人の立場。認証を入れたらここがログイン中の顧客になる */
export type Viewer = {
  /** いま自分が最高額か */
  isHighest: boolean;
  /** 自分が入れた最高額。未入札なら null */
  myMaxBid: number | null;
};

export type AuctionState = {
  lotId: string;
  status: AuctionStatus;
  /** 現在の入札額。入札が一件もなければ開始価格と同額 */
  currentBid: number;
  startPrice: number;
  /** 入札単位 */
  minIncrement: number;
  /** 1回の入札の上限。桁の打ち間違いを止めるための壁 */
  maxBid: number;
  bidCount: number;
  /** 開始時刻（ISO8601） */
  startsAt: string;
  /** 終了時刻（ISO8601） */
  endsAt: string;
  /** 残りこの秒数を切ってからの入札で延長する */
  extendWindowSec: number;
  /** 延長する秒数 */
  extendBySec: number;
  /** 一度でも延長されたか */
  extended: boolean;
  /** 新しい順 */
  bids: Bid[];
  viewer: Viewer;
  /**
   * サーバーの現在時刻。端末の時計がずれていても
   * 残り時間が狂わないよう、クライアントはこれとの差分を持つ。
   */
  serverNow: string;
  /** この state を作った時刻。古い応答で新しい state を上書きしないため */
  updatedAt: string;
};

export type BidErrorCode =
  | "TOO_LOW" // 最低入札額に届かない
  | "TOO_HIGH" // 上限を超えている（桁の打ち間違い）
  | "NOT_LIVE" // まだ始まっていない
  | "ENDED" // もう終わっている
  | "OUTBID" // 送っている間に他の人が上回った
  | "AUTH_REQUIRED" // 本人確認が要る（認証を入れたら使う）
  | "RATE_LIMITED"
  | "NETWORK"
  | "UNKNOWN";

export type PlaceBidResult =
  | { ok: true; state: AuctionState }
  /** 失敗時も最新の state を返す。画面の金額が古いまま残らないように */
  | { ok: false; code: BidErrorCode; message: string; state?: AuctionState };

/** 入札の中身 */
export type BidInput = {
  amount: number;
  /** 二重送信を弾くための冪等キー。クライアントが作る */
  requestId: string;
  /**
   * 入札者のメールアドレス。
   * Webkul は入札に「ストアに登録済みの顧客のメール」を必須で求めるため、
   * 本番ではここが空だと入札できない。mock では無視される。
   */
  email?: string;
};

export interface AuctionProvider {
  readonly name: string;
  load(): Promise<AuctionState>;
  placeBid(input: BidInput): Promise<PlaceBidResult>;
}

/** 次に必要な最低入札額 */
export function nextMinimumBid(state: AuctionState): number {
  return state.bidCount === 0
    ? state.startPrice
    : state.currentBid + state.minIncrement;
}

/** 入札額として妥当か。サーバーとクライアントで同じ判定を使う */
export function validateBid(
  state: AuctionState,
  amount: number,
): { code: BidErrorCode; message: string } | null {
  const floor = nextMinimumBid(state);

  if (!Number.isFinite(amount) || amount <= 0) {
    return { code: "TOO_LOW", message: "入札額を入力してください。" };
  }
  if (amount < floor) {
    return {
      code: "TOO_LOW",
      message: `${floor.toLocaleString("ja-JP")}円 以上で入札してください。`,
    };
  }
  if (amount > state.maxBid) {
    return {
      code: "TOO_HIGH",
      message: `一度に入札できるのは ${state.maxBid.toLocaleString("ja-JP")}円 までです。桁をお確かめください。`,
    };
  }
  // 単位の判定は「現在額からいくつ積んだか」で見る。
  // 開始価格を起点にすると、外部で端数のついた額が入った瞬間に全部弾かれる。
  if ((amount - floor) % state.minIncrement !== 0) {
    return {
      code: "TOO_LOW",
      message: `入札は ${state.minIncrement.toLocaleString("ja-JP")}円 単位です。`,
    };
  }
  return null;
}
