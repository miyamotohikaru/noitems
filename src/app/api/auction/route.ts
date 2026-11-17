import { after, NextResponse } from "next/server";
import { auction } from "@/lib/auction";
import { settleEnded } from "@/lib/auction/settle";
import { readSession } from "@/lib/session";

export const dynamic = "force-dynamic";
/** 終了後の請求（after）が結果を待つ時間を含める */
export const maxDuration = 60;

/** 現在の状態を返す。タブに戻ったとき・終了した瞬間・定期の取り直しで叩かれる */
export async function GET() {
  try {
    // ログインしていれば本人目線（最高額か・自分の入札）で返す
    const session = await readSession();
    const state = await auction.load(
      session ? { customerId: session.customerId } : null,
    );
    // 終わっていたら、返事のあとで落札者に請求する（済んでいれば何もしない）
    if (state.status === "ended") {
      after(() =>
        settleEnded(state).catch((e) => console.error("[autopay] settleEnded", e)),
      );
    }
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
