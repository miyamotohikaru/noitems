import { shopify } from "./auction/config";

/**
 * 決済は Shopify に渡す。
 * 入札はサイト側（Webkul）で完結し、落札後の支払いだけ Shopify のチェックアウトへ送る。
 *
 * cart permalink 方式なら SDK もサーバー処理もいらない:
 *   https://<shop>.myshopify.com/cart/<variantId>:1
 * 落札額が可変なので、実運用では
 *   ① 落札額の Draft Order を作る（Admin API）か
 *   ② Webkul が発行する支払いリンクをそのまま使う
 * のどちらかになる。決まり次第ここを埋める。
 */

export const isCheckoutWired = Boolean(shopify.domain && shopify.variantId);

export function checkoutUrl(): string | null {
  if (!isCheckoutWired) return null;
  return `https://${shopify.domain}/cart/${shopify.variantId}:1`;
}
