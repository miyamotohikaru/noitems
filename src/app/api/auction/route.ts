import { NextResponse } from "next/server";
import { auction } from "@/lib/auction";
import { readSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** 現在の状態を返す。タブに戻ったとき・終了した瞬間・定期の取り直しで叩かれる */
export async function GET() {
  try {
    // ログインしていれば本人目線（最高額か・自分の入札）で返す
    const session = await readSession();
    const state = await auction.load(
      session ? { customerId: session.customerId } : null,
    );
    return NextResponse.json(state, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("[auction] load failed", error);
    return NextResponse.json(
      { error: "オークションの状態を取得できませんでした。" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
