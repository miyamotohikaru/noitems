import { after, NextResponse } from "next/server";
import { useWebkul } from "@/lib/auction/config";
import { unpaidWinsFor } from "@/lib/auction/webkul";
import { readSession } from "@/lib/session";
import { canAutopay } from "@/lib/shopify/admin";
import { findCard, settledResult, settleWin } from "@/lib/shopify/autopay";
import { createCheckout } from "@/lib/shopify/storefront";

export const dynamic = "force-dynamic";
/** 登録のカードへの請求（after）が結果を待つ時間を含める */
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };

/**
 * 落札後の支払い。
 *
 * ⚠️ 誰の落札分かは**ログイン状態（Cookie）の顧客IDからしか決めない**。
 *    画面から送られた ID を信じると、他人の落札分の支払い画面を開けてしまう。
 *
 * GET  … ログイン中の人の、支払いがまだの落札分（無ければ空）。
 *        カード登録があれば、その場で請求を始めて autopay: true を付けて返す
 * POST … { auctionId } の支払い画面のURLを作って返す。
 *        カード登録が無い・カードが通らなかったときの、手動の支払い
 */
export async function GET() {
  const session = await readSession();
  if (!session || !useWebkul) {
    return NextResponse.json({ wins: [] }, { headers: NO_STORE });
  }

  try {
    const wins = await unpaidWinsFor(session.customerId);
    const card =
      wins.length > 0 && canAutopay() ? await findCard(session.customerId) : null;

    const out = await Promise.all(
      wins.map(async (w) => {
        // カードが通らなかったものは、手動の支払い画面に回す
        const done = card ? await settledResult(w.auctionId) : null;
        const autopay = Boolean(card) && done?.status !== "failed";
        if (autopay) {
          after(() =>
            settleWin({ ...w, customerId: session.customerId }).catch((e) =>
              console.error("[autopay] settleWin", e),
            ),
          );
        }
        // バリエーションIDは画面に渡さない。支払い画面はサーバーが作る
        return { auctionId: w.auctionId, title: w.title, amount: w.amount, autopay };
      }),
    );
    return NextResponse.json({ wins: out }, { headers: NO_STORE });
  } catch (error) {
    console.error("[checkout] wins failed", error);
    return NextResponse.json({ wins: [] }, { headers: NO_STORE });
  }
}

export async function POST(request: Request) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json(
      { error: "お支払いにはログインが必要です。" },
      { status: 401, headers: NO_STORE },
    );
  }

  let auctionId: unknown;
  try {
    auctionId = (await request.json())?.auctionId;
  } catch {
    // 下でまとめて弾く
  }
  if (typeof auctionId !== "string" || !auctionId) {
    return NextResponse.json(
      { error: "お支払いの対象が分かりませんでした。" },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const win = (await unpaidWinsFor(session.customerId)).find(
      (w) => w.auctionId === auctionId,
    );
    if (!win) {
      return NextResponse.json(
        { error: "お支払いがまだの落札は見つかりませんでした。" },
        { status: 404, headers: NO_STORE },
      );
    }

    const url = await createCheckout(win.variantId, session.email);
    return NextResponse.json({ url }, { headers: NO_STORE });
  } catch (error) {
    console.error("[checkout] create failed", error);
    return NextResponse.json(
      {
        error:
          "お支払いの画面を開けませんでした。時間をおいて、もう一度お試しください。",
      },
      { status: 503, headers: NO_STORE },
    );
  }
}
