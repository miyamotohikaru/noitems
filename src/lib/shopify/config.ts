import "server-only";

/**
 * Shopify の接続先。
 *
 * 2つのAPIを使い分けている。混同しないこと。
 *
 *  ① お客様アカウントAPI（customerAccount）
 *     お客さんがログインするためのもの。Headless チャネルの
 *     「お客様アカウントAPI」で発行する。クライアントIDは公開前提で、
 *     シークレットは無い（PKCE で守る）。
 *
 *  ② Admin API（admin）
 *     こちらがサーバーから顧客情報を読むためのもの。入札記録に
 *     「他の人の」ニックネームを出すのに要る。Dev Dashboard のアプリ
 *     `noitems-site` をストアにインストールして得る。
 *     **トークンは絶対にクライアントへ出さない。**
 */

export const shop = {
  domain: process.env.SHOPIFY_SHOP_DOMAIN ?? "",
  /** 新しいお客様アカウントのショップID。ログインURLに出ている番号 */
  id: process.env.SHOPIFY_SHOP_ID ?? "",
};

export const customerAccount = {
  clientId: process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID ?? "",
  /** https://shopify.com/authentication/<shopId> */
  authBase: process.env.SHOPIFY_AUTH_BASE ?? "",
  /**
   * ログイン後の戻り先。
   * ⚠️ Shopify 側に登録した文字列と1文字でも違うと弾かれる。
   * ⚠️ https 必須。localhost では試せない（本番URLで確認する）。
   */
  redirectUri: process.env.SHOPIFY_AUTH_REDIRECT_URI ?? "",
};

export const admin = {
  clientId: process.env.SHOPIFY_APP_CLIENT_ID ?? "",
  clientSecret: process.env.SHOPIFY_APP_CLIENT_SECRET ?? "",
  /** インストールを1度通して得るアクセストークン */
  token: process.env.SHOPIFY_ADMIN_TOKEN ?? "",
  apiVersion: "2026-10",
};

/** ログイン状態のCookieに署名する鍵 */
export const sessionSecret = process.env.SESSION_SECRET ?? "";

export const canLogin = Boolean(
  customerAccount.clientId &&
    customerAccount.authBase &&
    customerAccount.redirectUri &&
    sessionSecret,
);

/** ニックネームの読み書きができるか。できなければ「入札者 01」のまま出す */
export const canReadNicknames = Boolean(shop.domain && admin.token);

/** ニックネームを入れておく場所。顧客のメタフィールド */
export const NICKNAME_METAFIELD = {
  namespace: "noitems",
  key: "nickname",
  type: "single_line_text_field",
} as const;

/** 表示してよい長さ。長い名前で記録の行が壊れないように */
export const NICKNAME_MAX = 16;
