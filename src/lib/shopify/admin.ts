import "server-only";

/**
 * Admin API（自前の支払いアプリ「noitems-autopay」）。
 *
 * カードを預かる契約（定期購入の仕組み）を読み書きし、落札者に請求するために使う。
 * Dev Dashboard で作ったアプリで、トークンは client credentials で毎回もらう
 * （有効期限は約24時間。期限の少し前まで使い回す）。
 *
 * 必要な環境変数
 *   SHOPIFY_SHOP_DOMAIN             … yxd0fi-im.myshopify.com
 *   SHOPIFY_AUTOPAY_CLIENT_ID       … アプリのクライアントID
 *   SHOPIFY_AUTOPAY_CLIENT_SECRET   … アプリのシークレット（画面にもログにも出さない）
 *
 * ⚠️ 値は関数の中で読む（shopify/config.ts と同じ理由）。
 */

const API_VERSION = "2025-10";

const env = (name: string) => (process.env[name] ?? "").trim();

export function canAutopay(): boolean {
  return Boolean(
    env("SHOPIFY_SHOP_DOMAIN") &&
      env("SHOPIFY_AUTOPAY_CLIENT_ID") &&
      env("SHOPIFY_AUTOPAY_CLIENT_SECRET"),
  );
}

let cached: { token: string; expiresAt: number } | null = null;

async function token(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const res = await fetch(
    `https://${env("SHOPIFY_SHOP_DOMAIN")}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: env("SHOPIFY_AUTOPAY_CLIENT_ID"),
        client_secret: env("SHOPIFY_AUTOPAY_CLIENT_SECRET"),
      }),
      cache: "no-store",
    },
  );
  if (!res.ok) throw new Error(`admin: token failed (${res.status})`);

  const json = (await res.json()) as { access_token: string; expires_in?: number };
  // 期限の10分前には取り直す
  const life = Math.max((json.expires_in ?? 3600) - 600, 60);
  cached = { token: json.access_token, expiresAt: Date.now() + life * 1000 };
  return cached.token;
}

export async function adminGql<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(
    `https://${env("SHOPIFY_SHOP_DOMAIN")}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-shopify-access-token": await token(),
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    },
  );
  const json = (await res.json().catch(() => null)) as {
    data?: T;
    errors?: { message: string }[];
  } | null;
  if (!res.ok || !json?.data) {
    throw new Error(
      `admin: graphql failed (${res.status}) ${json?.errors?.[0]?.message ?? ""}`,
    );
  }
  return json.data;
}
