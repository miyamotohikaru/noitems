import "server-only";

import { storefront } from "./config";

const API_VERSION = "2025-10";

/**
 * 落札分だけを入れたカートを作り、支払い画面のURLを返す。
 *
 * 支払い画面は日本語・日本向けで開く（指定しないと en-jp になる）。
 * メールを渡しておくと、支払い画面で打ち直さなくて済む。
 */
export async function createCheckout(
  variantId: string,
  email: string,
): Promise<string> {
  const { domain, token } = storefront();
  if (!domain || !token) throw new Error("storefront: not configured");

  const res = await fetch(`https://${domain}/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-storefront-access-token": token,
    },
    body: JSON.stringify({
      query: `mutation ($input: CartInput!) @inContext(country: JP, language: JA) {
        cartCreate(input: $input) {
          cart { checkoutUrl }
          userErrors { message }
        }
      }`,
      variables: {
        input: {
          lines: [
            {
              merchandiseId: `gid://shopify/ProductVariant/${variantId}`,
              quantity: 1,
            },
          ],
          buyerIdentity: { email, countryCode: "JP" },
        },
      },
    }),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => null)) as {
    data?: {
      cartCreate?: {
        cart?: { checkoutUrl?: string } | null;
        userErrors?: { message: string }[];
      };
    };
  } | null;

  const url = json?.data?.cartCreate?.cart?.checkoutUrl;
  if (!url) {
    const reason = json?.data?.cartCreate?.userErrors?.[0]?.message ?? res.status;
    throw new Error(`storefront: cartCreate failed (${reason})`);
  }
  return url;
}
