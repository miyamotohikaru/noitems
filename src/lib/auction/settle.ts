import "server-only";

import { useWebkul, webkul } from "./config";
import { unpaidWinsFor } from "./webkul";
import type { AuctionState } from "./types";
import { canAutopay } from "../shopify/admin";
import { settleWin, settledResult } from "../shopify/autopay";

/**
 * 終わったオークションの落札者に、登録のカードで請求する。
 *
 * 定期実行（cron）は使わず、/api/auction が「終了」を返すたびに after() で呼ぶ。
 * 終了の瞬間は見ている人の画面が必ず取り直しに来るので、それをきっかけにする。
 * 落札者本人が開いたときも /api/checkout から同じ請求を呼ぶ（二重にはならない）。
 */

let lastTry = 0;

export async function settleEnded(state: AuctionState): Promise<void> {
  if (!useWebkul || !canAutopay() || state.status !== "ended") return;

  // 何人もが同時に開いても、1台のサーバーからは1分に1回まで
  if (Date.now() - lastTry < 60_000) return;
  lastTry = Date.now();

  if (await settledResult(String(webkul.auctionId))) return;

  const top = state.bids.reduce<AuctionState["bids"][number] | null>(
    (best, b) => (!best || b.amount > best.amount ? b : best),
    null,
  );
  if (!top) return;

  // 落札が確定していなければ（最低落札価格に届かない・処理待ち）ここで空になる
  const win = (await unpaidWinsFor(top.bidderId)).find(
    (w) => w.auctionId === String(webkul.auctionId),
  );
  if (!win) return;

  const result = await settleWin({ ...win, customerId: top.bidderId });
  console.info("[autopay]", win.auctionId, result.status);
}
