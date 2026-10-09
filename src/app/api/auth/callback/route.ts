import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, fetchMe } from "@/lib/shopify/customerAuth";
import { sessionCookie } from "@/lib/session";
import { nicknameOf } from "@/lib/nicknames";

export const dynamic = "force-dynamic";

/**
 * Shopify のログインから戻ってくる先。
 *
 * ここでしかメールアドレスを受け取らない。画面から送られてきた
 * メールは信用しない（他人になりすませてしまうため）。
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const verifier = request.cookies.get("noitems_verifier")?.value;
  const expected = request.cookies.get("noitems_state")?.value;

  const back = (reason?: string) => {
    const to = new URL("/", request.url);
    if (reason) to.searchParams.set("login", reason);
    const res = NextResponse.redirect(to);
    res.cookies.delete("noitems_verifier");
    res.cookies.delete("noitems_state");
    return res;
  };

  // state が合わないものは、こちらが始めたログインではない
  if (!code || !state || !verifier || !expected || state !== expected) {
    return back("failed");
  }

  try {
    const token = await exchangeCode(code, verifier);
    const me = await fetchMe(token.access_token);
    if (!me.email) return back("failed");

    // 2回目以降の人は、前に決めた名前をそのまま引き継ぐ
    const nickname = await nicknameOf(me.id);

    const res = NextResponse.redirect(
      new URL(nickname ? "/?login=ok" : "/?login=nickname", request.url),
    );
    const c = sessionCookie({
      customerId: me.id,
      email: me.email,
      nickname,
    });
    res.cookies.set(c.name, c.value, c.options);
    // 使い終わった合言葉は残さない
    res.cookies.delete("noitems_verifier");
    res.cookies.delete("noitems_state");
    return res;
  } catch (error) {
    console.error("[auth] callback", error);
    return back("failed");
  }
}
