import { NextResponse } from "next/server";
import { clearSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * こちらのログイン状態だけ消す。
 * Shopify 側のログインまで切ると、同じ端末で入り直すたびに
 * メールのコード待ちになって煩わしいので、ここでは触らない。
 */
export async function POST(request: Request) {
  await clearSession();
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
