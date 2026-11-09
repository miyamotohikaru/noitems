"use client";

import { useEffect, useRef } from "react";

/**
 * スマホで、項目を「下から重なってくるカード」にする（2026-11-09 ユーザー指定）。
 * ユーザーが送ってきた4本の画面録画（COC・TAIYO LINKS・FUNTECH）に共通する見せ方。
 *
 *   ・カードは自分の下端が画面の下端に来たところで止まり、次のカードがその上へ重なってくる
 *   ・カードの上端に項目名を残す（いまどこを読んでいるかが分かる）
 *   ・地は半透明。後ろの立体（ページのいちばん後ろの層）がうっすら透ける
 *
 * PC では何もしない（ただの囲み）。見た目は globals.css の .card-m、
 * 透け具合などは調整パネルの「カード（スマホ）」から動かす（lib/sykim/motion.ts の CARD）。
 */
export function Card({
  label,
  no,
  children,
}: {
  label: string;
  no: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const phone = matchMedia("(max-width: 767px)");
    // 止まる位置。カードが画面より短ければ上の帯の下で、長ければ下端が画面の下端に来たところで止める
    const place = () => {
      if (!phone.matches) {
        el.style.top = "";
        return;
      }
      const nav = document.querySelector("header")?.getBoundingClientRect().height ?? 0;
      el.style.top = `${Math.min(nav, window.innerHeight - el.offsetHeight)}px`;
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener("resize", place);
    phone.addEventListener("change", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      phone.removeEventListener("change", place);
    };
  }, []);

  return (
    <div ref={ref} className="card-m">
      <div className="card-m-tab" aria-hidden>
        <span className="num">{no}</span>
        <span>{label}</span>
      </div>
      {children}
    </div>
  );
}
