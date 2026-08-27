"use client";

import { useEffect, useRef, useState } from "react";
import { kanjiYen, jstDateTime, yen } from "@/lib/format";
import { nextMinimumBid, validateBid, type AuctionState } from "@/lib/auction/types";
import type { PlaceBidResult } from "@/lib/auction/types";

type Step = "input" | "confirm" | "done";

/** 最低額から 入札単位×n を足した候補 */
const QUICK = [0, 4, 9];

export function BidDialog({
  open,
  state,
  onClose,
  onSubmit,
}: {
  open: boolean;
  state: AuctionState;
  onClose: () => void;
  onSubmit: (amount: number) => Promise<PlaceBidResult>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const floor = nextMinimumBid(state);
  const [step, setStep] = useState<Step>("input");
  const [amount, setAmount] = useState<number | null>(floor);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<AuctionState | null>(null);
  /** 開いている最中に最低額が上がったか */
  const [floorRaised, setFloorRaised] = useState<number | null>(null);
  const openedFloor = useRef(floor);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      openedFloor.current = floor;
      setStep("input");
      setAmount(floor);
      setError(null);
      setDone(null);
      setFloorRaised(null);
      el.showModal();
      // 最初のフォーカスは閉じるボタンではなく入札額へ
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (!open && el.open) {
      el.close();
    }
  }, [open, floor]);

  // 開いている最中に他の人が入札してきたら、黙って弾かれる前に知らせる
  useEffect(() => {
    if (!open || step === "done") return;
    if (floor > openedFloor.current) {
      setFloorRaised(floor);
      // 自分が入れた額のほうが高ければ、勝手に下げない
      setAmount((a) => (a === null || a < floor ? floor : a));
      setStep("input");
    }
  }, [floor, open, step]);

  function toConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (amount === null) {
      setError("入札額を入力してください。");
      return;
    }
    const invalid = validateBid(state, amount);
    if (invalid) {
      setError(invalid.message);
      return;
    }
    setError(null);
    setStep("confirm");
  }

  async function commit() {
    if (amount === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onSubmit(amount);
      if (result.ok) {
        setDone(result.state);
        setStep("done");
      } else {
        setError(result.message);
        setStep("input");
      }
    } catch {
      setError(
        "通信に失敗しました。入札は成立していません。もう一度お試しください。",
      );
      setStep("input");
    } finally {
      setBusy(false);
    }
  }

  const overFloorRatio = amount !== null && amount > floor * 2;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current && !busy) onClose();
      }}
      aria-labelledby="bid-title"
      className="m-auto max-h-[92dvh] w-[min(30rem,calc(100vw-1.5rem))] overflow-y-auto
                 border border-[var(--rule-firm)] bg-paper p-0 text-ink
                 shadow-[0_40px_90px_-40px_rgb(22_19_15/0.5)]
                 backdrop:bg-ink/45 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex items-start justify-between gap-4 px-6 pt-6 sm:px-9 sm:pt-8">
        <h2 id="bid-title" className="text-[1.0625rem] font-light tracking-[0.16em]">
          {step === "done" ? "入札を受け付けました" : "入札する"}
        </h2>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label="閉じる"
          className="-m-2 grid h-11 w-11 place-items-center text-ink/60 transition-colors hover:text-ink disabled:opacity-40"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path
              d="M1 1l12 12M13 1L1 13"
              stroke="currentColor"
              strokeWidth="1"
              fill="none"
            />
          </svg>
        </button>
      </div>

      {step === "done" && done ? (
        <div className="px-6 pb-7 sm:px-9 sm:pb-9">
          <p className="num mt-6 text-[2rem] font-extralight leading-none">
            {yen(done.currentBid)}
          </p>
          <p className="mt-3 text-[0.8125rem] leading-[1.9] text-ink/70">
            {jstDateTime(done.bids[0]?.placedAt ?? done.updatedAt)}（日本時間）に受け付けました。
          </p>

          <p className="mt-6 border-y border-[var(--rule)] py-4 text-[0.875rem] leading-[1.9]">
            {done.viewer.isHighest
              ? "現在、あなたが最高額です。"
              : "送信のあいだに、他の方が上回りました。"}
          </p>

          <p className="mt-5 text-[0.75rem] leading-[1.95] text-ink/70">
            終了時に最高額だった場合、ご登録の連絡先に落札のご案内をお送りします。
            お支払いは Shopify のチェックアウトで承ります。
          </p>

          <button type="button" onClick={onClose} className="btn-solid mt-7 w-full">
            閉じる
          </button>
        </div>
      ) : step === "confirm" && amount !== null ? (
        <div className="px-6 pb-7 sm:px-9 sm:pb-9">
          <p className="label-jp mt-6">この金額で入札します</p>
          <p className="num mt-3 text-[clamp(2rem,8vw,2.75rem)] font-extralight leading-none">
            {yen(amount)}
          </p>
          <p className="mt-3 text-[0.875rem] tracking-[0.08em] text-ink/72">
            {kanjiYen(amount)}
          </p>

          {overFloorRatio && (
            <p className="mt-5 border border-alert/45 px-4 py-3 text-[0.8125rem] leading-[1.9] text-alert">
              最低入札額の {Math.floor(amount / floor)} 倍以上です。桁をお確かめください。
            </p>
          )}

          <p className="mt-6 border-t border-[var(--rule)] pt-5 text-[0.8125rem] leading-[1.95]">
            入札は取り消せません。
            <span className="text-ink/70">
              　終了時に最高額だった場合、購入の意思があるものとして扱われます。
            </span>
          </p>

          {error && (
            <p role="alert" className="mt-4 text-[0.8125rem] leading-[1.9] text-alert">
              {error}
            </p>
          )}

          <div className="mt-7 grid gap-3 sm:grid-cols-[auto_1fr]">
            <button
              type="button"
              onClick={() => setStep("input")}
              disabled={busy}
              className="btn-line min-h-11 disabled:opacity-40"
            >
              戻る
            </button>
            <button
              type="button"
              onClick={commit}
              disabled={busy}
              aria-busy={busy}
              className="btn-solid"
            >
              {busy ? "送信しています" : "確定して入札する"}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={toConfirm} noValidate className="px-6 pb-7 sm:px-9 sm:pb-9">
          <fieldset disabled={busy} className="contents">
            {floorRaised && (
              <p
                role="status"
                className="mt-6 border border-[var(--rule-firm)] px-4 py-3 text-[0.8125rem] leading-[1.9]"
              >
                他の方が入札しました。最低入札額が {yen(floorRaised)} になりました。
              </p>
            )}

            <dl className="mt-6 space-y-2.5 border-y border-[var(--rule)] py-5">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="label-jp">現在の入札額</dt>
                <dd className="num text-[0.9375rem]">{yen(state.currentBid)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="label-jp">次の最低入札額</dt>
                <dd className="num text-[0.9375rem]">{yen(floor)}</dd>
              </div>
            </dl>

            <div className="mt-7">
              <label htmlFor="bid-amount" className="label-jp">
                入札額
              </label>
              <div className="mt-3 flex items-center border border-[var(--rule-firm)] bg-ground-lift focus-within:border-ink">
                <span className="num pl-4 text-[0.9375rem] text-ink/60">¥</span>
                <input
                  ref={inputRef}
                  id="bid-amount"
                  type="number"
                  inputMode="numeric"
                  min={floor}
                  max={state.maxBid}
                  step={state.minIncrement}
                  value={amount ?? ""}
                  aria-invalid={Boolean(error)}
                  aria-describedby="bid-readout bid-help"
                  // ホイールで金額が勝手に動く事故を止める
                  onWheel={(e) => e.currentTarget.blur()}
                  onChange={(e) => {
                    const v = e.target.value;
                    setAmount(v === "" ? null : Number(v));
                    setError(null);
                  }}
                  className="num w-full bg-transparent px-3 py-3.5 text-[1.125rem] outline-none"
                />
              </div>

              {/* 7桁を裸の数字で目視確認させない */}
              <p
                id="bid-readout"
                aria-live="polite"
                className="num mt-2.5 min-h-5 text-[0.8125rem] text-ink/72"
              >
                {amount !== null && amount > 0 ? yen(amount) : " "}
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                {QUICK.map((n) => {
                  const v = floor + n * state.minIncrement;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => {
                        setAmount(v);
                        setError(null);
                      }}
                      data-on={amount === v}
                      className="num min-h-11 border border-[var(--rule)] px-3.5 text-[0.75rem]
                                 text-ink/78 transition-colors duration-300
                                 hover:border-[var(--rule-firm)] hover:text-ink
                                 data-[on=true]:border-ink data-[on=true]:text-ink"
                    >
                      {yen(v)}
                    </button>
                  );
                })}
              </div>
            </div>

            {error && (
              <p role="alert" className="mt-4 text-[0.8125rem] leading-[1.9] text-alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={amount === null}
              className="btn-solid mt-7 w-full"
            >
              確認へ進む
            </button>

            <p id="bid-help" className="mt-4 text-[0.6875rem] leading-[1.95] text-ink/70">
              入札単位 {yen(state.minIncrement)}／一度の上限 {yen(state.maxBid)}。
              入札は取り消せません。お支払いは落札後、Shopify のチェックアウトで承ります。
            </p>
          </fieldset>
        </form>
      )}
    </dialog>
  );
}
