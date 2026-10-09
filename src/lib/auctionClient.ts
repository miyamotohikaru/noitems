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
): Promise<PlaceBidResult> {
  try {
    const res = await fetch("/api/bid", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // メールは送らない。サーバーがログイン状態から取る
      body: JSON.stringify({ amount, requestId }),
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

/* ── ログイン状態 ─────────────────────────────────── */

export type Viewer = {
  /** ログインの仕組みが使える状態か（未設定ならボタンを出さない） */
  available: boolean;
  signedIn: boolean;
  nickname: string | null;
  /** ログイン済みだが、まだ名前を決めていない */
  needsNickname: boolean;
};

export async function fetchViewer(): Promise<Viewer | null> {
  try {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as Viewer;
  } catch {
    return null;
  }
}

export async function postNickname(
  nickname: string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch("/api/nickname", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    return res.ok && json.ok
      ? { ok: true }
      : { ok: false, message: json.error ?? "保存できませんでした。" };
  } catch {
    return { ok: false, message: "通信に失敗しました。" };
  }
}
