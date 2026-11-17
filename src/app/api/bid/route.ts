import { NextResponse } from "next/server";
import { auction } from "@/lib/auction";
import { useWebkul } from "@/lib/auction/config";
import type { BidErrorCode, PlaceBidResult } from "@/lib/auction/types";
import { readSession } from "@/lib/session";
import { canAutopay } from "@/lib/shopify/admin";
import { findCard } from "@/lib/shopify/autopay";
import { canLogin } from "@/lib/shopify/config";

export const dynamic = "force-dynamic";

/**
 * 入札はここを通す。provider（＝APIキー）はサーバーから出さない。
 *
 * ⚠️ **メールアドレスはログイン状態（Cookie）からしか取らない。**
 *    画面から送られてきたメールを使うと、他人のアドレスで入札できてしまう。
 *    Webkul は「ストアに登録済みの顧客のメール」なら誰のものでも受け付けるので、
 *    ここを緩めると なりすまし入札が成立する。
 *
 * まだ無いもの: レート制限。
 */
export async function POST(request: Request) {
  const session = await readSession();
  if (canLogin() && !session) {
    return bad(
      "AUTH_REQUIRED",
      "入札するにはログインしてください。",
      401,
    );
  }

  // 落札したら登録のカードに請求するので、登録の無い人は入札できない。
  // 確かめられなかったときも入れない（払えない落札を作らないため）
  if (session && useWebkul && canAutopay()) {
    let card = null;
    try {
      card = await findCard(session.customerId);
    } catch (error) {
      console.error("[bid] findCard failed", error);
      return bad(
        "NETWORK",
        "カードの登録を確かめられませんでした。入札は成立していません。もう一度お試しください。",
        503,
      );
    }
    if (!card) {
      return bad(
        "CARD_REQUIRED",
        "入札の前に、お支払いのカードを登録してください。",
        403,
      );
    }
  }

  let amount: unknown;
  let requestId: unknown;

  try {
    const body = await request.json();
    amount = body?.amount;
    requestId = body?.requestId;
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
      email: session?.email,
      customerId: session?.customerId,
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
