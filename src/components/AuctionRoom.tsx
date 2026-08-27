"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AuctionState } from "@/lib/auction/types";
import { fetchAuction, newRequestId, postBid } from "@/lib/auctionClient";
import { auctionPageUrl, isHandoff } from "@/lib/handoff";
import { jstDateTime, yen } from "@/lib/format";
import { legal, site } from "@/lib/lot";
import { tradeTerms } from "@/lib/tradeTerms";
import { Bracket } from "./Bracket";
import { BidDialog } from "./BidDialog";
import { Countdown, coarseRemaining, useRemaining, useServerOffset } from "./Countdown";

export function AuctionRoom({ initial }: { initial: AuctionState }) {
  const [state, setState] = useState(initial);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [barShown, setBarShown] = useState(false);
  const [showAllBids, setShowAllBids] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const offset = useServerOffset(state.serverNow);
  const { total } = useRemaining(state.endsAt, offset);

  // サーバーの status を正とし、クライアントの時計は補助にとどめる。
  // 初回描画をサーバーと一致させないと、いちばん大事な瞬間に hydration がずれる。
  const ended = mounted ? state.status === "ended" || total <= 0 : state.status === "ended";
  const scheduled = state.status === "scheduled";
  const nearEnd = mounted && !ended && total <= state.extendWindowSec;

  /** 取り直し。古い応答で新しい state を上書きしない */
  const refresh = useCallback(async () => {
    const next = await fetchAuction();
    if (!next) return;
    setState((prev) =>
      new Date(next.updatedAt).getTime() >= new Date(prev.updatedAt).getTime()
        ? next
        : prev,
    );
  }, []);

  // タブに戻ったとき・窓に focus が戻ったときは必ず取り直す。
  // 1時間放置して戻ると、金額だけ1時間前という状態になるため。
  useEffect(() => {
    if (ended) return;
    const onWake = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const id = setInterval(() => void refresh(), nearEnd ? 3_000 : 20_000);
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [ended, nearEnd, refresh]);

  // 0 を割った瞬間に、確定結果をサーバーへ取りに行く。
  // 最後の1秒に入った他人の入札を取りこぼしたまま「落札額」を出さないため。
  const settled = useRef(false);
  useEffect(() => {
    if (!mounted || total > 0 || settled.current) return;
    settled.current = true;
    void refresh();
  }, [mounted, total, refresh]);

  // 読み上げは、意味のある変化のときだけ。カウントダウンは読ませない
  const prev = useRef(initial);
  useEffect(() => {
    const before = prev.current;
    prev.current = state;
    if (state.currentBid !== before.currentBid) {
      setAnnouncement(
        state.viewer.isHighest
          ? `${yen(state.currentBid)} で入札しました。現在あなたが最高額です。`
          : `現在の入札額が ${yen(state.currentBid)} に更新されました。`,
      );
    } else if (state.extended && !before.extended) {
      setAnnouncement("終了時刻が5分延長されました。");
    } else if (state.status === "ended" && before.status !== "ended") {
      setAnnouncement("オークションが終了しました。");
    }
  }, [state]);

  // 入札カードを追い越したら、下端に控えの入札バーを出す
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) =>
        setBarShown(!entry.isIntersecting && entry.boundingClientRect.top < 0),
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const submit = useCallback(async (amount: number) => {
    const result = await postBid(amount, newRequestId());
    // 失敗でも最新の state が返ってくるなら反映する。画面の金額を古いまま残さない
    if (result.ok) setState(result.state);
    else if (result.state) setState(result.state);
    return result;
  }, []);

  const outbid =
    !ended && state.viewer.myMaxBid !== null && !state.viewer.isHighest;
  const visibleBids = showAllBids ? state.bids : state.bids.slice(0, 5);

  return (
    <>
      <section id="auction" className="relative">
        <div className="page pt-[clamp(3.5rem,8vw,7rem)] pb-[clamp(3rem,6vw,5rem)]">
          {/* 読み上げ専用。ここ以外にライブリージョンを置かない */}
          <p aria-live="polite" className="sr-only">
            {announcement}
          </p>

          <div ref={panelRef} className="sheet">
            {/* 自分の立場。オークションでいちばん知りたいこと */}
            {outbid && (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-alert/35 bg-alert/8 px-[clamp(1.5rem,4vw,3.5rem)] py-3.5 text-[0.8125rem] text-alert">
                <span aria-hidden>●</span>
                他の方が {yen(state.currentBid)} で入札しました。
                <span className="text-ink/72">
                  あなたの入札 {yen(state.viewer.myMaxBid!)}
                </span>
              </p>
            )}
            {!ended && !outbid && state.viewer.isHighest && (
              <p className="border-b border-[var(--rule)] px-[clamp(1.5rem,4vw,3.5rem)] py-3.5 text-[0.8125rem]">
                現在、あなたが最高額です。
              </p>
            )}
            {nearEnd && (
              <p className="border-b border-alert/35 px-[clamp(1.5rem,4vw,3.5rem)] py-3.5 text-[0.8125rem] text-alert">
                まもなく終了 ── 残り5分以内の入札で、終了が5分延長されます。
              </p>
            )}

            <div className="px-[clamp(1.5rem,4vw,3.5rem)] pt-[clamp(2rem,3.6vw,3rem)] pb-[clamp(1.75rem,3.2vw,2.75rem)]">
              <div className="grid gap-0 md:grid-cols-[1.1fr_1fr]">
                {/* 金額 */}
                <div className="md:pr-[clamp(1.5rem,3vw,3rem)]">
                  <div className="flex items-center gap-2.5">
                    {/* 点滅する点は「ここで進行中」の印。逃がすモードでは出さない */}
                    {!isHandoff && !ended && !scheduled && (
                      <span className="relative flex h-1.5 w-1.5" aria-hidden>
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ink/45" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-ink" />
                      </span>
                    )}
                    <span className="label-jp">
                      {isHandoff
                        ? "開始価格"
                        : ended
                          ? "落札額"
                          : scheduled
                            ? "開始価格"
                            : "現在の入札額"}
                    </span>
                  </div>
                  <p className="num mt-4 text-[clamp(2.375rem,1rem+5.4vw,4.25rem)] font-extralight leading-[0.94] tracking-[-0.025em]">
                    {yen(isHandoff || scheduled ? state.startPrice : state.currentBid)}
                  </p>
                  {/* 現在額と件数は Shopify 側にしかないので、逃がすモードでは出さない */}
                  {!isHandoff && (
                    <p className="label-jp mt-5">
                      入札 {state.bidCount} 件
                      <span className="mx-2 text-[var(--sep)]">／</span>
                      開始 {yen(state.startPrice)}
                    </p>
                  )}
                </div>

                {/* 残り時間 ── 左と同じ行ボックスで始める（揃わないと主役が半行ずれる） */}
                <div
                  className="mt-8 border-t border-[var(--rule)] pt-8
                             md:mt-0 md:border-t-0 md:border-l md:border-[var(--rule)]
                             md:pt-0 md:pl-[clamp(1.5rem,3vw,3rem)]"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="label-jp">
                      {ended ? "終了しました" : scheduled ? "開始まで" : "残り時間"}
                    </span>
                  </div>
                  <p
                    className={`mt-4 text-[clamp(2.375rem,1rem+5.4vw,4.25rem)] font-extralight leading-[0.94] tracking-[-0.02em]
                                ${nearEnd ? "text-alert" : ""}`}
                  >
                    {ended ? (
                      <span className="num">00:00:00</span>
                    ) : (
                      <Countdown
                        endsAt={scheduled ? state.startsAt : state.endsAt}
                        offsetMs={offset}
                      />
                    )}
                  </p>
                  <p className="label-jp mt-5">
                    終了 {jstDateTime(state.endsAt)}（日本時間）
                    {state.extended && (
                      <span className="ml-2 text-alert">延長されました</span>
                    )}
                  </p>
                </div>
              </div>
            </div>

            {/* 終了は「押せないボタン」で表さない。確定した事実として刷る */}
            {isHandoff ? (
              <a href={auctionPageUrl} className="btn-solid w-full">
                入札ページへ進む
              </a>
            ) : ended ? (
              <p className="bg-ink px-[clamp(1.5rem,4vw,3.5rem)] py-5 text-[0.875rem] tracking-[0.14em] text-ground-lift">
                オークションは終了しました
              </p>
            ) : (
              <button
                type="button"
                onClick={() => setDialogOpen(true)}
                disabled={scheduled}
                className="btn-solid w-full"
              >
                {scheduled ? "まもなく開始します" : "入札する"}
              </button>
            )}
          </div>

          {isHandoff && (
            <p className="mt-4 max-w-[52rem] text-[0.75rem] leading-[1.9] text-ink/72">
              入札の受付は Shopify のページで行います。
              <span className="text-ink">入札は取り消せません。</span>
            </p>
          )}
          <p className="mt-4 max-w-[52rem] text-[0.75rem] leading-[1.9] text-ink/72" hidden={isHandoff}>
            入札単位 {yen(state.minIncrement)}
            <span className="mx-1.5 text-[var(--sep)]">／</span>
            一度の上限 {yen(state.maxBid)}。
            <span className="text-ink">入札は取り消せません。</span>
          </p>

          {/* 取引条件 ── 押す前に見えるところに置く */}
          <dl className="mt-9 grid max-w-[52rem] gap-x-10 gap-y-0 border-t border-[var(--rule)] sm:grid-cols-2">
            {tradeTerms.map((row) => (
              <div
                key={row.term}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-[var(--rule)] py-3"
              >
                <dt className="label-jp w-[6.5rem] shrink-0">{row.term}</dt>
                <dd className="min-w-0 flex-1 text-[0.8125rem] leading-[1.85] text-ink/82">
                  {row.body.split(/(［[^］]*］)/g).map((part, i) =>
                    part.startsWith("［") ? (
                      <span
                        key={i}
                        className="text-ink/52 [border-bottom:1px_dotted_var(--rule-firm)]"
                      >
                        {part}
                      </span>
                    ) : (
                      <span key={i}>{part}</span>
                    ),
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[0.75rem]">
            {legal.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="link-ul text-ink/72 transition-colors duration-500 hover:text-ink"
              >
                {item.label}
              </a>
            ))}
          </p>

          {/* 入札の記録 ── 吊り上げを疑われたときの、唯一の反証材料 */}
          {!isHandoff && state.bids.length > 0 && (
            <div className="mt-12 max-w-[52rem] md:mt-16">
              <h2 className="label-jp">入札の記録</h2>
              <ol className="mt-4 border-t border-[var(--rule)]">
                {visibleBids.map((bid) => (
                  <li
                    key={bid.id}
                    data-mine={bid.mine}
                    className="grid grid-cols-[6rem_1fr_auto] items-baseline gap-4
                               border-b border-[var(--rule)] py-3.5
                               text-[0.8125rem] text-ink/82
                               data-[mine=true]:text-ink"
                  >
                    <span className="num text-[0.75rem] text-ink/65">
                      {jstDateTime(bid.placedAt)}
                    </span>
                    <span className="font-light tracking-[0.05em]">
                      {bid.mine ? <strong className="font-medium">{bid.bidderLabel}</strong> : bid.bidderLabel}
                    </span>
                    <span className="num">{yen(bid.amount)}</span>
                  </li>
                ))}
              </ol>
              {state.bids.length > 5 && (
                <button
                  type="button"
                  onClick={() => setShowAllBids((v) => !v)}
                  className="link-ul mt-4 text-[0.75rem] text-ink/72 hover:text-ink"
                >
                  {showAllBids
                    ? "記録を畳む"
                    : `記録をすべて見る（${state.bids.length} 件）`}
                </button>
              )}
              <p className="label-jp mt-4">
                時刻は日本時間。入札者名はご本人が特定されないよう伏せています。
              </p>
            </div>
          )}
        </div>
      </section>

      {/* 追い越したあとの控え */}
      <div
        data-shown={barShown && !ended}
        inert={!barShown || ended}
        className="fixed inset-x-0 bottom-0 z-40 translate-y-full border-t border-[var(--rule)]
                   bg-ground/92 opacity-0 backdrop-blur-md
                   transition-[transform,opacity] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]
                   data-[shown=true]:translate-y-0 data-[shown=true]:opacity-100"
      >
        <div className="page flex items-center gap-4 py-2.5">
          <Bracket
            gap={3.4}
            title={site.title}
            className="hidden h-4 w-auto shrink-0 sm:block"
          />
          <div className="flex min-w-0 flex-1 items-baseline gap-4 sm:justify-end">
            <span className="num text-[1.0625rem] font-light">
              {yen(state.currentBid)}
            </span>
            <span
              className={`num text-[0.8125rem] ${nearEnd ? "text-alert" : "text-ink/78"}`}
            >
              残り <Countdown endsAt={state.endsAt} offsetMs={offset} />
            </span>
          </div>
          {isHandoff ? (
            <a
              href={auctionPageUrl}
              className="btn-line shrink-0 border-ink bg-ink text-ground-lift hover:bg-ink"
            >
              入札する
            </a>
          ) : (
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="btn-line shrink-0 border-ink bg-ink text-ground-lift hover:bg-ink"
            >
              入札する
            </button>
          )}
        </div>
      </div>

      <BidDialog
        open={dialogOpen}
        state={state}
        onClose={() => setDialogOpen(false)}
        onSubmit={submit}
      />
    </>
  );
}
