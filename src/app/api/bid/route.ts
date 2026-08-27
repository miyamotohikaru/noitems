import { NextResponse } from "next/server";
import { auction } from "@/lib/auction";
import type { BidErrorCode, PlaceBidResult } from "@/lib/auction/types";

export const dynamic = "force-dynamic";

/**
 * 入札はここを通す。provider（＝APIキー）はサーバーから出さない。
 *
 * 本番で足すもの:
 *   - 顧客の認証（Shopify Customer Account のトークン検証）
 *   - レート制限
 * どちらも未実装なので、いまは誰でも入札できる。
 */
export async function POST(request: Request) {
  let amount: unknown;
  let requestId: unknown;
  let email: unknown;

  try {
    const body = await request.json();
    amount = body?.amount;
    requestId = body?.requestId;
    email = body?.email;
  } catch {
    return bad("UNKNOWN", "リクエストを読み取れませんでした。");
  }

  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return bad("TOO_LOW", "入札額を入力してください。");
  }
  if (typeof requestId !== "string" || requestId.length === 0) {
    return bad("UNKNOWN", "リクエストIDがありません。");
  }

  try {
    const result = await auction.placeBid({
      amount: Math.floor(amount),
      requestId,
      email: typeof email === "string" && email.length > 0 ? email : undefined,
    });
    return NextResponse.json(result, {
      status: result.ok ? 200 : 422,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("[auction] placeBid failed", error);
    return bad(
      "NETWORK",
      "入札を送信できませんでした。入札は成立していません。",
      503,
    );
  }
}

function bad(code: BidErrorCode, message: string, status = 400) {
  return NextResponse.json(
    { ok: false, code, message } satisfies PlaceBidResult,
    { status, headers: { "cache-control": "no-store" } },
  );
}
