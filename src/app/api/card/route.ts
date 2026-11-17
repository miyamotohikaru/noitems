import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { canAutopay } from "@/lib/shopify/admin";
import { cardCheckout } from "@/lib/shopify/autopay";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * 入札の前の、カード登録の支払い画面（¥0）のURLを作って返す。
 * 登録が済んだかどうかは /api/auth/me の needsCard で見る。
 */
export async function POST() {
  const session = await readSession();
  if (!session) {
    return NextResponse.json(
      { error: "カードの登録にはログインが必要です。" },
      { status: 401, headers: NO_STORE },
    );
  }
  if (!canAutopay()) {
    return NextResponse.json(
      { error: "いまはカードを登録できません。" },
      { status: 503, headers: NO_STORE },
    );
  }

  try {
    const url = await cardCheckout(session.email);
    return NextResponse.json({ url }, { headers: NO_STORE });
  } catch (error) {
    console.error("[card] checkout failed", error);
    return NextResponse.json(
      { error: "登録の画面を開けませんでした。時間をおいて、もう一度お試しください。" },
      { status: 503, headers: NO_STORE },
    );
  }
}
