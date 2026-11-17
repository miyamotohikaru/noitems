"use client";

import { useEffect, useRef, useState } from "react";

/**
 * ローディング画面（2026-11-13 ユーザー指定）。
 *
 * 立体（3.8MB）が届くまで、地の色の上に括弧だけを置く。
 * 読み込みが進むにつれて、括弧が左右へ離れていき、あいだの空白が広がる。
 * 空白が見出しと同じ幅（括弧の高さの 8 倍）まで開ききったら、幕ごと消える。
 * 空白がそのまま作品の名前なので、「名前ができあがるまで」を待ってもらう形にした。
 *
 * 進み具合は HeroObject が "hero-progress"（0〜1）、
 * 立体を出せたら "hero-ready" を window に投げる。
 * 3D が動かない端末でも閉じ込めないよう、12 秒たったら必ず開ける（CSS 側にも同じ保険）。
 */

const SIZE = 100;
const STROKE = 15;
const DROP = 135;
const HEIGHT = SIZE + DROP;
const GAP_FROM = 0.6; // 始まりのアキ（括弧どうしがほぼ触れている）
const GAP_TO = 8; // 開ききったアキ（見出しの括弧と同じ）
const WIDTH = SIZE * 2 + SIZE * GAP_TO;
const GIVE_UP = 12000;

declare global {
  interface Window {
    __heroProgress__?: number;
    __heroReady__?: boolean;
  }
}

export function Loader() {
  const left = useRef<SVGPathElement>(null);
  const right = useRef<SVGPathElement>(null);
  const count = useRef<HTMLSpanElement>(null);
  const [phase, setPhase] = useState<"load" | "out" | "gone">("load");

  useEffect(() => {
    const root = document.documentElement;
    root.style.overflow = "hidden";
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let target = window.__heroProgress__ ?? 0;
    let ready = window.__heroReady__ ?? false;
    let shown = 0;
    let raf = 0;
    let last = performance.now();
    const t0 = last;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      root.style.overflow = "";
      setPhase("out");
      window.setTimeout(() => setPhase("gone"), 900);
    };

    const draw = (v: number) => {
      // 真ん中を動かさず、左右の括弧が同じだけ外へ離れていく
      const half = ((GAP_TO - GAP_FROM) * (1 - v) * SIZE) / 2;
      left.current?.setAttribute("transform", `translate(${half} 0)`);
      right.current?.setAttribute("transform", `translate(${-half} 0)`);
      if (count.current)
        count.current.textContent = String(Math.round(v * 100)).padStart(3, "0");
    };

    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // 届いた量の 9 割までは素直に追う。最後の 1 割は立体が出せてから開く
      const want = ready ? 1 : Math.min(target, 1) * 0.9;
      // 一気に跳ばず、すっと寄る（最後の詰めは秒速 0.5 で押し切る）
      if (want > shown)
        shown = Math.min(want, shown + Math.max(dt * 0.5, (want - shown) * Math.min(1, dt * 3)));
      draw(shown);
      if (ready && shown > 0.995) {
        draw(1);
        window.setTimeout(finish, 260);
        return;
      }
      if (now - t0 > GIVE_UP) return finish();
      raf = requestAnimationFrame(tick);
    };

    const onProgress = (e: Event) => {
      target = Math.max(target, (e as CustomEvent<number>).detail);
    };
    const onReady = () => {
      ready = true;
      if (reduced) finish();
    };
    window.addEventListener("hero-progress", onProgress);
    window.addEventListener("hero-ready", onReady);
    if (reduced) {
      draw(1);
      if (ready) finish();
      else window.setTimeout(finish, GIVE_UP);
    } else raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      root.style.overflow = "";
      window.removeEventListener("hero-progress", onProgress);
      window.removeEventListener("hero-ready", onReady);
    };
  }, []);

  if (phase === "gone") return null;

  return (
    <div
      aria-hidden
      data-phase={phase}
      className="loader fixed inset-0 z-[200] flex items-center justify-center bg-ground transition-opacity duration-[800ms] ease-out data-[phase=out]:pointer-events-none data-[phase=out]:opacity-0"
    >
      <div className="flex w-[min(58vw,22rem)] flex-col items-center gap-6">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full overflow-visible text-ink"
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
        >
          <path
            ref={left}
            transform={`translate(${((GAP_TO - GAP_FROM) * SIZE) / 2} 0)`}
            d={`M ${SIZE} ${STROKE / 2} H ${STROKE / 2} V ${SIZE - STROKE / 2}`}
          />
          <path
            ref={right}
            transform={`translate(${-((GAP_TO - GAP_FROM) * SIZE) / 2} 0)`}
            d={`M ${WIDTH - SIZE} ${HEIGHT - STROKE / 2} H ${WIDTH - STROKE / 2} V ${DROP + STROKE / 2}`}
          />
        </svg>
        <span
          ref={count}
          className="num text-[0.6875rem] tracking-[0.2em] text-ink/52"
        >
          000
        </span>
      </div>
    </div>
  );
}
