import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { canLogin } from "@/lib/shopify/config";

export const dynamic = "force-dynamic";

/** 画面が「今ログインしているか」を知るための窓口。メールは返さない */
export async function GET() {
  const s = await readSession();
  return NextResponse.json(
    {
      available: canLogin,
      signedIn: Boolean(s),
      nickname: s?.nickname ?? null,
      needsNickname: Boolean(s && !s.nickname),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
