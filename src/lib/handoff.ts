/**
 * 入札を Shopify のページへ逃がすための行き先。
 *
 * Webkul の Auction API は Pro（$40/月）にしか付いていない。
 * 無料プランのあいだは、入札の受付は Shopify の商品ページに載る
 * Webkul のウィジェットで行い、このサイトはそこへ送る役をする。
 *
 * Vercel に NEXT_PUBLIC_SHOPIFY_AUCTION_URL を入れると、この形に切り替わる。
 * 例: https://xxxx.myshopify.com/products/no-items
 *
 * Pro に上げて WEBKUL_* を設定したら、この変数を外す。
 * そうすると入札はサイトの中で完結する形（もともと作ってある形）に戻る。
 */
export const auctionPageUrl = process.env.NEXT_PUBLIC_SHOPIFY_AUCTION_URL ?? "";

/** Shopify のページへ逃がすモードかどうか */
export const isHandoff = auctionPageUrl.length > 0;
