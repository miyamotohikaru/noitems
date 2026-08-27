import { NextResponse } from "next/server";
import { auction } from "@/lib/auction";

export const dynamic = "force-dynamic";

/** 現在の状態を返す。タブに戻ったとき・終了した瞬間・定期の取り直しで叩かれる */
export async function GET() {
  try {
    const state = await auction.load();
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
