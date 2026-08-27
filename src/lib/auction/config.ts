/**
 * オークションの数値と、外部サービスの接続先。
 * 本番では Webkul（入札の挙動）と Shopify（決済）の値がここに入る。
 */

export const LOT_ID = "NO.001";

/** 開始価格 */
export const START_PRICE = 1_000_000;

/** 入札単位 */
export const MIN_INCREMENT = 10_000;

/**
 * 1回の入札の上限。桁を1つ多く打った事故を止めるための壁。
 * 現在額の3倍か 500万円の、大きいほう。
 */
export function bidCeiling(currentBid: number): number {
  return Math.max(currentBid * 3, 5_000_000);
}

/**
 * 開始・終了時刻。本番では Webkul が持つ値に置き換える。
 */
export const AUCTION_STARTS_AT = "2026-01-03T21:00:00+09:00";
export const AUCTION_ENDS_AT = "2026-01-10T21:00:00+09:00";

/**
 * 土台のあいだだけ、過ぎた終了時刻を日単位で先送りして
 * いつ開いてもカウントダウンが動いているようにする。
 *
 * 本番デプロイでは絶対に立てない（有効なままだとオークションが永久に終わらない）。
 * ローカルと Vercel のプレビューでだけ動くので、確認用URLでは
 * カウントダウンが生きたまま見られる。
 * Webkul を繋いだあとは終了時刻が向こうから来るので、この値は使われなくなる。
 */
export const DEMO_ROLL_FORWARD = process.env.VERCEL_ENV !== "production";

/** 残り5分を切ってからの入札で、5分延長する */
export const EXTEND_WINDOW_SEC = 5 * 60;
export const EXTEND_BY_SEC = 5 * 60;

/** 終了時刻を求める。DEMO_ROLL_FORWARD の間だけ日送りする */
export function resolveEndsAt(base: string = AUCTION_ENDS_AT): Date {
  const end = new Date(base);
  if (!DEMO_ROLL_FORWARD) return end;

  const now = Date.now();
  if (end.getTime() > now) return end;

  const DAY = 24 * 60 * 60 * 1000;
  const daysBehind = Math.ceil((now - end.getTime()) / DAY);
  return new Date(end.getTime() + daysBehind * DAY);
}

/* ------------------------------------------------------------------
   外部サービス。値は Vercel の環境変数から入れる（まだ未設定）
   ------------------------------------------------------------------ */

export const webkul = {
  /** Webkul Auction アプリのエンドポイント */
  endpoint: process.env.WEBKUL_AUCTION_ENDPOINT ?? "",
  apiKey: process.env.WEBKUL_API_KEY ?? "",
  /** Webkul 側でこのロットに割り当てられる ID */
  auctionId: process.env.WEBKUL_AUCTION_ID ?? "",
};

export const shopify = {
  domain: process.env.NEXT_PUBLIC_SHOPIFY_DOMAIN ?? "",
  storefrontToken: process.env.SHOPIFY_STOREFRONT_TOKEN ?? "",
  /** 落札後に決済へ回すための商品バリアントID */
  variantId: process.env.NEXT_PUBLIC_SHOPIFY_VARIANT_ID ?? "",
};

/** Webkul の資格情報が揃っていれば本番プロバイダを使う */
export const useWebkul = Boolean(
  webkul.endpoint && webkul.apiKey && webkul.auctionId,
);
