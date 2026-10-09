import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { sessionSecret, NICKNAME_MAX } from "./shopify/config";

/**
 * ログイン状態。HMACで署名したCookieに入れる。
 *
 * ⚠️ 入札に使うメールアドレスは**必ずここから取る**。
 *    ブラウザから送られてきた値を信じると、他人のアドレスで入札できてしまう。
 */
export type Session = {
  /** Shopify の顧客ID。入札記録の突き合わせに使う */
  customerId: string;
  email: string;
  nickname: string | null;
  /** 失効時刻（ミリ秒） */
  exp: number;
};

const COOKIE = "noitems_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 14;

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret).update(payload).digest("base64url");
}

function serialize(s: Session): string {
  const payload = Buffer.from(JSON.stringify(s)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function deserialize(raw: string): Session | null {
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;

  const payload = raw.slice(0, dot);
  const given = raw.slice(dot + 1);
  const want = sign(payload);

  // 長さが違うと timingSafeEqual が例外を投げるので、先に見る
  if (given.length !== want.length) return null;
  if (!timingSafeEqual(Buffer.from(given), Buffer.from(want))) return null;

  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    if (!s.customerId || !s.email || s.exp < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

export async function readSession(): Promise<Session | null> {
  if (!sessionSecret) return null;
  const raw = (await cookies()).get(COOKIE)?.value;
  return raw ? deserialize(raw) : null;
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: MAX_AGE_SEC,
} as const;

/**
 * Cookie の中身を組み立てて返す。
 * リダイレクトを返すルートでは `cookies()` ではなく
 * レスポンスに直接付けたいので、組み立てだけ切り出してある。
 */
export function sessionCookie(s: Omit<Session, "exp"> & { exp?: number }) {
  const full: Session = { ...s, exp: s.exp ?? Date.now() + MAX_AGE_SEC * 1000 };
  return { name: COOKIE, value: serialize(full), options: COOKIE_OPTIONS };
}

export async function writeSession(
  s: Omit<Session, "exp"> & { exp?: number },
): Promise<void> {
  const c = sessionCookie(s);
  (await cookies()).set(c.name, c.value, c.options);
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** 入力されたニックネームを、表示に出して安全な形に整える */
export function cleanNickname(input: string): string | null {
  const trimmed = input
    // 改行や制御文字を落とす。記録の行が崩れるのを防ぐ
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!trimmed) return null;
  return [...trimmed].slice(0, NICKNAME_MAX).join("");
}
