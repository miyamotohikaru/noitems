import "server-only";

import { Redis } from "@upstash/redis";
import { NICKNAME_MAX } from "./shopify/config";

/**
 * 入札記録に出す名前の置き場。
 *
 * Shopify の顧客メタフィールドに置く案から切り替えた。
 * 他の人の名前を読むには Admin API のトークンが要るが、
 * このストアは本番ストアで Dev Dashboard からアプリを入れられず、
 * トークンが取れなかった（2026-10-09）。
 *
 * ニックネームは Shopify の持ち物ではなく、このサイトの表示用の名前
 * でしかないので、こちらで持つほうが筋が通る。鍵は Webkul の入札一覧が
 * 返してくる `shopify_customer_id`。
 */

const PREFIX = "nickname:";

let client: Redis | null = null;

/**
 * ⚠️ モジュールの先頭で作らない。環境変数が無いビルド時に落ちる。
 *    使うときに初めて作って、以後は使い回す。
 */
function redis(): Redis | null {
  if (client) return client;
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return null;
  }
  client = Redis.fromEnv();
  return client;
}

/** 保存先が用意できているか。できていなければ「入札者 01」のまま出す */
export function canStoreNicknames(): boolean {
  return redis() !== null;
}

/**
 * 顧客IDの一覧から対応表を作る。
 *
 * 失敗しても例外は投げない。名前が出ないだけで、入札記録そのものは
 * 表示できたほうがよい。
 */
export async function nicknamesFor(
  customerIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(customerIds.filter(Boolean))];
  const r = redis();
  if (!r || ids.length === 0) return out;

  try {
    // 1件ずつ往復すると入札が増えたときに遅くなる。まとめて引く
    const values = await r.mget<(string | null)[]>(
      ...ids.map((id) => `${PREFIX}${id}`),
    );
    ids.forEach((id, i) => {
      const v = values[i];
      if (typeof v === "string" && v) out.set(id, v);
    });
  } catch (error) {
    console.error("[nicknames] read", error);
  }
  return out;
}

/** 1人分だけ引く */
export async function nicknameOf(customerId: string): Promise<string | null> {
  const r = redis();
  if (!r || !customerId) return null;
  try {
    return await r.get<string>(`${PREFIX}${customerId}`);
  } catch (error) {
    console.error("[nicknames] get", error);
    return null;
  }
}

/** 本人が決めた名前を保存する。呼ぶ前に必ずログイン状態を確かめること */
export async function saveNickname(
  customerId: string,
  nickname: string,
): Promise<void> {
  const r = redis();
  if (!r) throw new Error("nicknames: 保存先が設定されていません");
  await r.set(`${PREFIX}${customerId}`, nickname.slice(0, NICKNAME_MAX));
}
