import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { useWebkul } from "@/lib/auction/config";
import { canAutopay } from "@/lib/shopify/admin";
import { findCard } from "@/lib/shopify/autopay";
import { canLogin, missingKeys } from "@/lib/shopify/config";


export const dynamic = "force-dynamic";

/** 画面が「今ログインしているか」を知るための窓口。メールは返さない */
export async function GET() {
  const s = await readSession();

  // 入札の前にカード登録が要るか。確かめられないときは要らない扱いにし、
  // 入札のときに /api/bid がもう一度確かめる
  let needsCard = false;
  if (s && useWebkul && canAutopay()) {
    try {
      needsCard = !(await findCard(s.customerId));
    } catch (error) {
      console.error("[auth/me] findCard failed", error);
    }
  }

  return NextResponse.json(
    {
      available: canLogin(),
      signedIn: Boolean(s),
      nickname: s?.nickname ?? null,
      needsNickname: Boolean(s && !s.nickname),
      needsCard,
      ...(canLogin() ? {} : { missing: missingKeys() }),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
