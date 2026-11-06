"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { hero, site } from "@/lib/lot";
import { Bracket } from "./Bracket";
import { HeroObject, ResetFormButton } from "./HeroObject";

/**
 * スマホ幅かどうか。
 *
 * ⚠️ デスクトップ用とスマホ用の立体を両方置いて CSS で隠す、という作りにしない。
 *    隠れているほうも WebGL を抱えたまま動き続けるので、描画も計算も倍かかる。
 *    「戻す」の窓口を取り合う不具合も、ここから出ていた。
 */
const QUERY = "(max-width: 767px)";
function useIsMobile() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(QUERY);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(QUERY).matches,
    () => false, // サーバー側ではデスクトップとして組む
  );
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/**
 * ファーストビュー。fondan.jp の見せ方を参考にしている。
 *
 *   1. 開いた瞬間は、立体だけ。画面からはみ出すほど寄せて置く
 *   2. スクロールしても画面は留まり、立体が回りながら引いていく
 *   3. 引ききるころに、括弧と本文が浮かび上がる（スマホは本文が下に続く）
 *
 * 画面を留めておく長さは、セクションの高さ（下の h-[…svh]）で決まる。
 * 立体の回転は HeroObject 側でスクロール量から出している。
 *
 * 立体の拡大縮小は、canvas の大きさを変えずに CSS の transform で行う。
 * canvas の大きさを変えると、そのたびに描画の作り直しが走って重くなる。
 * 寄った姿（いちばん大きい状態）で canvas を作り、引くときは縮めるだけなので、
 * 縮んだ先ではむしろ画素が細かくなり、粗くならない。
 */
export function Hero() {
  const isMobile = useIsMobile();
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const objRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const cueRef = useRef<HTMLDivElement>(null);
  const tagRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const sec = sectionRef.current;
    const stage = stageRef.current;
    const obj = objRef.current;
    if (!sec || !stage || !obj) return;

    let raf = 0;
    const update = () => {
      raf = 0;
      const vw = stage.clientWidth;
      const vh = stage.clientHeight;
      const r = sec.getBoundingClientRect();
      // 留まっているあいだの進み具合（0 → 1）
      const p = clamp(-r.top / Math.max(1, r.height - vh));

      // 立体: 前半で引ききる
      const a = ease(clamp(p / (isMobile ? 0.85 : 0.7)));
      const startW = obj.offsetWidth;
      const rem =
        parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      let endW: number;
      let endX: number;
      const endY = vh / 2;
      if (isMobile) {
        // これまでのスマホの大きさ（幅の132%）に合わせる
        endW = vw * 1.32;
        endX = vw / 2;
      } else {
        // これまでのデスクトップの置き方（右寄せ・幅 min(64vw, 55rem)）に合わせる
        endW = Math.min(vw * 0.64, 55 * rem);
        const right = vw >= 1536 ? 7 * rem : 3 * rem;
        endX = vw - right - endW / 2;
      }
      const s = lerp(1, endW / startW, a);
      const x = lerp(vw / 2, endX, a) - vw / 2;
      const y = lerp(vh / 2, endY, a) - vh / 2;
      obj.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s})`;

      // 本文と縦組みの署名: 立体が引ききる少し前から浮かぶ
      const t = ease(clamp((p - 0.45) / 0.3));
      for (const el of [textRef.current, tagRef.current]) {
        if (!el) continue;
        el.style.opacity = String(t);
        el.style.transform = `translate3d(0, ${(1 - t) * 1.5}rem, 0)`;
      }
      // 見えないうちは押せないようにする（戻すボタンの誤操作よけ）
      if (textRef.current) textRef.current.dataset.live = t > 0.6 ? "1" : "";

      // SCROLL の合図: 動き出したら消す
      if (cueRef.current)
        cueRef.current.style.opacity = String(1 - clamp(p / 0.12));
    };
    const request = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", request);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", request);
      window.removeEventListener("resize", request);
    };
  }, [isMobile]);

  return (
    <>
      <section
        id="top"
        ref={sectionRef}
        className="relative h-[200svh] md:h-[260svh]"
      >
        <div
          ref={stageRef}
          className="sticky top-0 h-[100svh] overflow-hidden"
        >
          {/* 立体。はじめは画面の真ん中に、はみ出すほど大きく置く。
              縮める・寄せるは上の update() が transform で行う */}
          <div
            ref={objRef}
            className="pointer-events-none absolute left-1/2 top-1/2 z-0
                       -ml-[85vmin] -mt-[85vmin] w-[170vmin] origin-center
                       will-change-transform"
          >
            <HeroObject showReset={false} />
          </div>

          {/* キービジュアルの署名。明朝の縦組みでここだけ書体を変える */}
          <p
            ref={tagRef}
            className="vertical font-mincho pointer-events-none absolute hidden opacity-0 lg:block
                       right-[var(--spacing-gutter)] top-[calc(var(--nav-h)+4rem)]
                       text-[0.9375rem] font-light tracking-[0.12em] text-ink/72"
          >
            {site.tagline}
          </p>

          {/* デスクトップの本文。立体が右へ引いたあとに、左へ浮かぶ */}
          {!isMobile && (
            <div
              className="page pointer-events-none absolute inset-0 flex flex-col justify-center
                         pt-[var(--nav-h)]"
            >
              <div ref={textRef} className="group relative z-10 max-w-[34rem] opacity-0">
                <HeroText />
                <ResetFormButton className="mt-9 group-data-[live=1]:pointer-events-auto" />
              </div>
            </div>
          )}

          {/* 下へ続くことだけを、静かに示す */}
          <div
            ref={cueRef}
            aria-hidden
            className="pointer-events-none absolute bottom-8 flex flex-col items-start gap-3
                       left-[var(--spacing-gutter)]"
          >
            <span className="label text-[0.625rem] tracking-[0.3em]">SCROLL</span>
            <span className="relative block h-12 w-px overflow-hidden bg-[var(--rule-firm)]">
              <span className="absolute inset-x-0 top-0 h-4 bg-ink/70 animate-[trickle_2.6s_cubic-bezier(0.7,0,0.3,1)_infinite]" />
            </span>
          </div>
        </div>
      </section>

      {/* スマホの本文。立体の場面を抜けたあとに、ふつうに続ける */}
      {isMobile && (
        <div className="page pb-14 pt-10">
          <HeroText />
          <ResetFormButton className="mt-9" />
        </div>
      )}
    </>
  );
}

/** 括弧・四行・注記。デスクトップとスマホで置き場所だけが違う */
function HeroText() {
  return (
    <>
      {/* 括弧はフォントで打たず、キービジュアルの比率で組む（Bracket.tsx）。
          あいだの空白が、そのまま作品の名前になっている。 */}
      <h1>
        <Bracket
          gap={8}
          title={site.title}
          className="w-[min(24rem,88%)] text-ink"
        />
      </h1>

      <div className="prose-jp mt-12 space-y-[0.35em] md:mt-16">
        {hero.lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>

      {/* いま何が行われているのか。ポスターの四行より一段落として、
          罫を挟んで注記の調子で置く */}
      <div className="mt-11 max-w-[30rem] border-t border-[var(--rule)] pt-6 md:mt-14">
        {hero.note.map((line) => (
          <p
            key={line}
            className="text-[0.8125rem] leading-[2] tracking-[0.03em] text-ink/78"
          >
            {line}
          </p>
        ))}
      </div>
    </>
  );
}
