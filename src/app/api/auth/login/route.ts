import { NextResponse } from "next/server";
import { authorizeUrl, makeVerifier } from "@/lib/shopify/customerAuth";
import { canLogin } from "@/lib/shopify/config";
import { randomBytes } from "node:crypto";

export const dynamic = "force-dynamic";

/**
 * ログインの入口。Shopify の画面へ送り出す。
 *
 * 合言葉(verifier)と state は、戻ってきたときに照合するので
 * 短命のCookieに預けておく。state を見ないと、他所のサイトから
 * 偽の戻りを投げ込まれても気づけない。
 */
export async function GET() {
  if (!canLogin()) {
    return NextResponse.json(
      { error: "ログインの設定が未完了です。" },
      { status: 503 },
    );
  }

  const verifier = makeVerifier();
  const state = randomBytes(16).toString("base64url");
  const nonce = randomBytes(16).toString("base64url");

  let target: string;
  try {
    target = authorizeUrl({ state, nonce, verifier });
  } catch (error) {
    console.error("[auth] login", error);
    return NextResponse.json(
      { error: "ログインの行き先を組み立てられませんでした。", detail: String(error) },
      { status: 500 },
    );
  }

  const res = NextResponse.redirect(target);
  const opts = {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  } as const;
  res.cookies.set("noitems_verifier", verifier, opts);
  res.cookies.set("noitems_state", state, opts);
  return res;
}
