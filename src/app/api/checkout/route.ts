import { NextResponse } from "next/server";
import { useWebkul } from "@/lib/auction/config";
import { unpaidWinsFor } from "@/lib/auction/webkul";
import { readSession } from "@/lib/session";
import { createCheckout } from "@/lib/shopify/storefront";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * 落札後の支払い。
 *
 * ⚠️ 誰の落札分かは**ログイン状態（Cookie）の顧客IDからしか決めない**。
 *    画面から送られた ID を信じると、他人の落札分の支払い画面を開けてしまう。
 *
 * GET  … ログイン中の人の、支払いがまだの落札分（無ければ空）
 * POST … { auctionId } の支払い画面のURLを作って返す
 */
export async function GET() {
  const session = await readSession();
  if (!session || !useWebkul) {
    return NextResponse.json({ wins: [] }, { headers: NO_STORE });
  }

  try {
    const wins = await unpaidWinsFor(session.customerId);
    return NextResponse.json(
      {
        // バリエーションIDは画面に渡さない。支払い画面はサーバーが作る
        wins: wins.map(({ auctionId, title, amount }) => ({
          auctionId,
          title,
          amount,
        })),
      },
      { headers: NO_STORE },
    );
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
