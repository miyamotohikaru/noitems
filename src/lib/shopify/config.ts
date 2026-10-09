import "server-only";

/**
 * Shopify の接続先。
 *
 * 使うのは**お客様アカウントAPI だけ**。お客さんがログインするためのもので、
 * Headless チャネルの「お客様アカウントAPI」で発行する。
 * クライアントIDは公開前提で、シークレットは無い（PKCE で守る）。
 *
 * ニックネームは Shopify ではなく Upstash に置いている（src/lib/nicknames.ts）。
 * 他人の名前を読むには Admin API が要るが、本番ストアには Dev Dashboard から
 * アプリを入れられずトークンが取れなかったため、方式を変えた。
 *
 * ⚠️ **値は必ず関数の中で読む。モジュールの先頭で定数にしない。**
 *    定数にするとビルド時の値で固まってしまい、あとから環境変数を
 *    足しても反映されない。一度これで半日溶かしている。
 *    あわせて、登録の仕方によっては改行が混じるので trim もかける。
 */

const env = (name: string) => (process.env[name] ?? "").trim();

export const shop = () => ({
  domain: env("SHOPIFY_SHOP_DOMAIN"),
  /** 新しいお客様アカウントのショップID。ログインURLに出ている番号 */
  id: env("SHOPIFY_SHOP_ID"),
});

export const customerAccount = () => ({
  clientId: env("SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID"),
  /** https://shopify.com/authentication/<shopId> */
  authBase: env("SHOPIFY_AUTH_BASE"),
  /**
   * ログイン後の戻り先。
   * ⚠️ Shopify 側に登録した文字列と1文字でも違うと弾かれる。
   * ⚠️ https 必須。localhost では試せない（本番URLで確認する）。
   */
  redirectUri: env("SHOPIFY_AUTH_REDIRECT_URI"),
});

/** ログイン状態のCookieに署名する鍵 */
export const sessionSecret = () => env("SESSION_SECRET");

export function canLogin(): boolean {
  const c = customerAccount();
  return Boolean(
    c.clientId && c.authBase && c.redirectUri && sessionSecret(),
  );
}

/** 設定が足りないときに、空の環境変数の**名前だけ**返す。値は返さない */
export function missingKeys(): string[] {
  return [
    "SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID",
    "SHOPIFY_AUTH_BASE",
    "SHOPIFY_AUTH_REDIRECT_URI",
    "SESSION_SECRET",
    "SHOPIFY_SHOP_DOMAIN",
    "SHOPIFY_SHOP_ID",
  ].filter((k) => !env(k));
}

/** 表示してよい長さ。長い名前で記録の行が壊れないように */
export const NICKNAME_MAX = 16;
