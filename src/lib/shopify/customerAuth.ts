import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { customerAccount, shop, NICKNAME_METAFIELD } from "./config";

/**
 * Shopify の「お客様アカウントAPI」でログインさせる。
 *
 * パスワードはこちらを一切通らない。Shopify の画面でメールにコードが届き、
 * 戻ってきた引換券（code）をサーバーでトークンに交換するだけ。
 *
 * クライアントシークレットが無い種類のアプリなので、代わりに **PKCE** で守る。
 * 「こちらだけが知っている合言葉(verifier)のハッシュを先に預けておき、
 *  交換のときに合言葉そのものを見せる」という仕組み。途中で code を
 * 盗まれても、合言葉を知らない相手はトークンに替えられない。
 */

const SCOPE = "openid email customer-account-api:full";

export function makeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function authorizeUrl(opts: {
  state: string;
  nonce: string;
  verifier: string;
}): string {
  const u = new URL(`${customerAccount.authBase}/oauth/authorize`);
  u.searchParams.set("client_id", customerAccount.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", customerAccount.redirectUri);
  u.searchParams.set("scope", SCOPE);
  u.searchParams.set("state", opts.state);
  u.searchParams.set("nonce", opts.nonce);
  u.searchParams.set("code_challenge", challengeFor(opts.verifier));
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

export function logoutUrl(idToken: string, backTo: string): string {
  const u = new URL(`${customerAccount.authBase}/logout`);
  u.searchParams.set("id_token_hint", idToken);
  u.searchParams.set("post_logout_redirect_uri", backTo);
  return u.toString();
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  id_token?: string;
  refresh_token?: string;
};

export async function exchangeCode(
  code: string,
  verifier: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: customerAccount.clientId,
    redirect_uri: customerAccount.redirectUri,
    code,
    code_verifier: verifier,
  });

  const res = await fetch(`${customerAccount.authBase}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `shopify: token exchange failed (${res.status}) ${await res.text()}`,
    );
  }
  return (await res.json()) as TokenResponse;
}

/* ── お客様アカウントAPI（GraphQL） ───────────────── */

function customerApiUrl(): string {
  return `https://shopify.com/${shop.id}/account/customer/api/2026-10/graphql`;
}

async function customerQuery<T>(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(customerApiUrl(), {
    method: "POST",
    headers: {
      authorization: accessToken,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`shopify: customer api failed (${res.status})`);
  }
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (!json.data) throw new Error(`shopify: ${JSON.stringify(json.errors)}`);
  return json.data;
}

export type LoggedInCustomer = {
  id: string;
  email: string;
  nickname: string | null;
};

/** ログインした本人の情報を取る */
export async function fetchMe(accessToken: string): Promise<LoggedInCustomer> {
  const data = await customerQuery<{
    customer: {
      id: string;
      emailAddress: { emailAddress: string } | null;
      metafield: { value: string } | null;
    };
  }>(
    accessToken,
    `query Me($ns: String!, $key: String!) {
      customer {
        id
        emailAddress { emailAddress }
        metafield(namespace: $ns, key: $key) { value }
      }
    }`,
    { ns: NICKNAME_METAFIELD.namespace, key: NICKNAME_METAFIELD.key },
  );

  const c = data.customer;
  return {
    // "gid://shopify/Customer/6617166020737" から数字だけ取る。
    // Webkul が返す shopify_customer_id と突き合わせるため
    id: c.id.split("/").pop() ?? c.id,
    email: c.emailAddress?.emailAddress ?? "",
    nickname: c.metafield?.value ?? null,
  };
}
