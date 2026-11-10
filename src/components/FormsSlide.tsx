"use client";

import { useEffect, useRef } from "react";

/**
 * かたちの5つの並び。スマホでは画面に収まらないので、縦のスクロールで右まで送る（2026-11-10 ユーザー指定）。
 *
 * page.tsx で、かたちのカードのすぐ後ろに空きの帯（#forms-hold、高さは画面 CARD.slide 個ぶん）を置いてある。
 * その帯がスクロールで上がっていく間、かたちのカードは止まったままで、並びだけが左へ流れる。
 * カードが止まった所で 01 から始まり、帯の下端が画面の下端に来た所（次のカードが来る直前）で 05 まで見える。
 * PC は5つとも収まるので何もしない。
 */
export function FormsSlide({ children }: { children: React.ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const w = wrap.current;
    const r = row.current;
    if (!w || !r) return;
    const phone = matchMedia("(max-width: 767px)");
    let raf = 0;
    const place = () => {
      raf = 0;
      const hold = document.getElementById("forms-hold");
      if (!phone.matches || !hold) {
        r.style.transform = "";
        return;
      }
      const vh = window.innerHeight;
      const b = hold.getBoundingClientRect();
      // カードが止まったときの下端（= 帯の上端がここまで来たら止まっている）から送り始め、
      // 帯の下端が画面の下端に来る（次のカードが顔を出す）までに送りきる
      const card = w.closest(".card-m") as HTMLElement | null;
      const stuck = card ? (parseFloat(card.style.top) || 0) + card.offsetHeight : vh;
      const run = Math.max(1, b.height - (vh - stuck));
      const p = Math.min(1, Math.max(0, (stuck - b.top) / run));
      const max = Math.max(0, r.scrollWidth - w.clientWidth);
      r.style.transform = `translate3d(${-p * max}px,0,0)`;
    };
    const ask = () => {
      if (!raf) raf = requestAnimationFrame(place);
    };
    place();
    window.addEventListener("scroll", ask, { passive: true });
    window.addEventListener("resize", ask);
    window.addEventListener("card-layout", ask);
    phone.addEventListener("change", ask);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", ask);
      window.removeEventListener("resize", ask);
      window.removeEventListener("card-layout", ask);
      phone.removeEventListener("change", ask);
    };
  }, []);

  return (
    <div ref={wrap} className="mt-14 overflow-hidden md:mt-20 md:overflow-visible">
      <ol ref={row} className="flex items-stretch gap-4 pb-2 will-change-transform md:gap-7">
        {children}
      </ol>
    </div>
  );
}
