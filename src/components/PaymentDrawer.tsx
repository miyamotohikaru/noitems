"use client";

import { useEffect, useRef, useState } from "react";
import { fetchWins, startCheckout, type Win } from "@/lib/auctionClient";
import { kanjiYen, yen } from "@/lib/format";

/** 落札した画面から、このパネルを開くための合図 */
export const PAY_EVENT = "noitems:pay";

/** 支払いのパネルを開く（落札者でなければ何も起きない） */
export function openPayment() {
  window.dispatchEvent(new Event(PAY_EVENT));
}

/**
 * 落札したあとの支払い。
 *
 * 落札者本人がログインしているときだけ、ヘッダーの下に帯を出す。
 * 押すと右からパネルが出て、品名と落札額を確かめてから Shopify の支払い画面へ移る。
 * 入札しただけの人には何も出ない（払うのは落札した1人だけ）。
 */
export function PaymentDrawer() {
  const ref = useRef<HTMLDialogElement>(null);
  const [wins, setWins] = useState<Win[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 手元の開発サーバーでは、ログインせずに見た目を確かめられるようにする。
    // localhost ではログイン（https 必須）が試せないため。本番では効かない
    if (
      process.env.NODE_ENV === "development" &&
      new URLSearchParams(window.location.search).has("pay-demo")
    ) {
      setWins([{ auctionId: "demo", title: "TEST2", amount: 100 }]);
      return;
    }
    void fetchWins().then(setWins);
  }, []);

  // 落札が決まった画面から呼ばれる。Webkul が落札を確定させるまで数秒かかるので、少し待ちながら取り直す
  useEffect(() => {
    let cancelled = false;
    async function onPay() {
      for (let i = 0; i < 8 && !cancelled; i++) {
        const next = await fetchWins();
        if (next.length > 0) {
          setWins(next);
          setOpen(true);
          return;
        }
        await new Promise((r) => setTimeout(r, 2_000));
      }
    }
    window.addEventListener(PAY_EVENT, onPay);
    return () => {
      cancelled = true;
      window.removeEventListener(PAY_EVENT, onPay);
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  if (wins.length === 0) return null;

  const total = wins.reduce((n, w) => n + w.amount, 0);

  async function pay(auctionId: string) {
    setBusy(auctionId);
    setError(null);
    const result = await startCheckout(auctionId);
    if (result.ok) {
      // 戻るボタンでこの画面に戻れるよう、置き換えではなく遷移にする
      window.location.assign(result.url);
      return;
    }
    setError(result.message);
    setBusy(null);
  }

  return (
    <>
      <div className="fixed inset-x-0 top-[var(--nav-h)] z-40 bg-ink text-ground-lift">
        <div className="page flex items-center justify-between gap-4 py-2.5">
          <p className="text-[0.8125rem] tracking-[0.08em]">
            {/* 狭い幅では読点の位置でだけ折る */}
            <span className="inline-block">落札した品の、</span>
            <span className="inline-block">お支払いがまだです。</span>
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="btn-line shrink-0 border-ground-lift/50 hover:border-ground-lift hover:bg-ground-lift hover:text-ink"
          >
            お支払いへ進む
          </button>
        </div>
      </div>

      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === ref.current && !busy) setOpen(false);
        }}
        aria-labelledby="pay-title"
        className="m-0 ml-auto h-dvh max-h-dvh w-[min(26rem,100vw)] max-w-none
                   border-l border-[var(--rule-firm)] bg-sheet p-0 text-ink
                   backdrop:bg-ink/45 backdrop:backdrop-blur-[2px]"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-[var(--rule)] px-6 py-5 sm:px-8">
            <h2 id="pay-title" className="text-[1rem] tracking-[0.14em]">
              お支払い
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={Boolean(busy)}
              aria-label="閉じる"
              className="-mr-2 grid size-11 place-items-center text-[1.25rem] text-ink/70 hover:text-ink"
            >
              ×
            </button>
          </div>

          <ul className="flex-1 overflow-y-auto px-6 sm:px-8">
            {wins.map((w) => (
              <li key={w.auctionId} className="border-b border-[var(--rule)] py-6">
                <p className="text-[0.75rem] tracking-[0.14em] text-ink/62">落札した品</p>
                <p className="mt-1.5 text-[0.9375rem]">{w.title}</p>
                <p className="num mt-3 text-[1.5rem] font-light">{yen(w.amount)}</p>
                <p className="mt-0.5 text-[0.75rem] text-ink/62">
                  {kanjiYen(w.amount)}円（税込）
                </p>
                {wins.length > 1 && (
                  <button
                    type="button"
                    onClick={() => void pay(w.auctionId)}
                    disabled={Boolean(busy)}
                    className="btn-line mt-4 w-full"
                  >
                    {busy === w.auctionId ? "支払い画面を開いています" : "この品を支払う"}
                  </button>
                )}
              </li>
            ))}
          </ul>

          <div className="border-t border-[var(--rule)] px-6 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-8">
            <div className="flex items-baseline justify-between">
              <span className="text-[0.8125rem] tracking-[0.14em]">ごうけい</span>
              <span className="num text-[1.125rem]">{yen(total)}</span>
            </div>
            {error && (
              <p role="alert" className="mt-3 text-[0.8125rem] leading-[1.8] text-alert">
                {error}
              </p>
            )}
            {wins.length === 1 && (
              <button
                type="button"
                onClick={() => void pay(wins[0].auctionId)}
                disabled={Boolean(busy)}
                className="btn-solid mt-5 w-full"
              >
                {busy ? "支払い画面を開いています" : "レジにすすむ"}
              </button>
            )}
            <p className="mt-4 text-[0.75rem] leading-[1.9] text-ink/72">
              お支払いは Shopify の画面で行います。
              <br />
              カード・Apple Pay などが使えます。
            </p>
          </div>
        </div>
      </dialog>
    </>
  );
}
