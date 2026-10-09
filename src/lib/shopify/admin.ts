import "server-only";

import { admin, shop, NICKNAME_METAFIELD, canReadNicknames } from "./config";

/**
 * Admin API。**サーバー専用。トークンは絶対にブラウザへ出さない。**
 *
 * 用途は2つだけ。
 *   ① 入札記録に出す「他の人の」ニックネームを読む
 *   ② 本人が決めたニックネームを保存する
 *
 * ①は本人以外の情報なので、お客様アカウントAPIでは取れない。
 * そのためだけに Admin API を使っている。読むのは
 * ニックネームのメタフィールドだけで、住所や注文には触れない。
 */

async function query<T>(
  q: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(
    `https://${shop.domain}/admin/api/${admin.apiVersion}/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": admin.token,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: q, variables }),
      cache: "no-store",
    },
  );
  if (!res.ok) throw new Error(`shopify admin: ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (!json.data) throw new Error(`shopify admin: ${JSON.stringify(json.errors)}`);
  return json.data;
}

const gid = (customerId: string) => `gid://shopify/Customer/${customerId}`;

/**
 * 顧客IDの一覧から、ニックネームの対応表を作る。
 *
 * 失敗しても例外は投げない。ニックネームが出ないだけで
 * 入札記録そのものは表示できたほうがよいため。
 */
export async function nicknamesFor(
  customerIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(customerIds.filter(Boolean))];
  if (!canReadNicknames || ids.length === 0) return out;

  try {
    const data = await query<{
      nodes: Array<{ id: string; metafield: { value: string } | null } | null>;
    }>(
      `query Nicknames($ids: [ID!]!, $ns: String!, $key: String!) {
        nodes(ids: $ids) {
          ... on Customer {
            id
            metafield(namespace: $ns, key: $key) { value }
          }
        }
      }`,
      {
        ids: ids.map(gid),
        ns: NICKNAME_METAFIELD.namespace,
        key: NICKNAME_METAFIELD.key,
      },
    );

    for (const node of data.nodes ?? []) {
      const value = node?.metafield?.value;
      if (node && value) out.set(node.id.split("/").pop() ?? node.id, value);
    }
  } catch (error) {
    console.error("[shopify admin] nicknamesFor", error);
  }
  return out;
}

/** 本人が決めたニックネームを保存する。呼ぶ前に必ずログイン状態を確かめること */
export async function saveNickname(
  customerId: string,
  nickname: string,
): Promise<void> {
  const data = await query<{
    metafieldsSet: { userErrors: Array<{ message: string }> };
  }>(
    `mutation SetNickname($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { message } }
    }`,
    {
      metafields: [
        {
          ownerId: gid(customerId),
          namespace: NICKNAME_METAFIELD.namespace,
          key: NICKNAME_METAFIELD.key,
          type: NICKNAME_METAFIELD.type,
          value: nickname,
        },
      ],
    },
  );

  const errors = data.metafieldsSet?.userErrors ?? [];
  if (errors.length) {
    throw new Error(errors.map((e) => e.message).join(" / "));
  }
}
