import type { AuctionState, PlaceBidResult } from "./auction/types";

/**
 * ブラウザ側はこれしか知らない。provider も APIキーもここには来ない。
 */

export async function fetchAuction(signal?: AbortSignal): Promise<AuctionState | null> {
  try {
    const res = await fetch("/api/auction", { cache: "no-store", signal });
    if (!res.ok) return null;
    return (await res.json()) as AuctionState;
  } catch {
    // 通信が切れているだけ。画面はいまの値のまま持たせる
    return null;
  }
}

export async function postBid(
  amount: number,
  requestId: string,
  email?: string,
): Promise<PlaceBidResult> {
  try {
    const res = await fetch("/api/bid", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount, requestId, email }),
    });
    return (await res.json()) as PlaceBidResult;
  } catch {
    return {
      ok: false,
      code: "NETWORK",
      message:
        "通信に失敗しました。入札は成立していません。電波の良いところでもう一度お試しください。",
    };
  }
}

/** 二重送信を弾くための鍵。同じ入札を再送しても一度しか数えられない */
export function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `r-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
