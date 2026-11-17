"use client";

import { useEffect, useRef } from "react";
import { cardLayout } from "@/lib/sykim/motion";

/**
 * スマホで、項目を「下から重なってくるカード」にする（2026-11-09 ユーザー指定）。
 * ユーザーが送ってきた4本の画面録画（COC・TAIYO LINKS・FUNTECH）に共通する見せ方。
 *
 *   ・カードは最後の行まで読める所（下端が画面の上から35%の高さ）まで上がってから止まり、
 *     次のカードがその上へ重なってくる（止まる高さは lib/sykim/motion.ts の CARD.stop）
 *   ・カードの上端に項目名を残す（いまどこを読んでいるかが分かる）
 *   ・地は半透明。後ろの立体（ページのいちばん後ろの層）がうっすら透ける
 *
 * PC では何もしない（ただの囲み）。見た目は globals.css の .card-m、
 * 透け具合などは調整パネルの「カード（スマホ）」から動かす（lib/sykim/motion.ts の CARD）。
 */
export function Card({
  label,
  no,
  stop,
  children,
}: {
  label: string;
  no: string;
  /** このカードだけ止まる高さを変えるとき（かたちは並びを送る間、全体を見せたいので 1） */
  stop?: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const phone = matchMedia("(max-width: 767px)");
    // 止まる位置。カードが短ければ上の帯の下で、長ければ下端が画面の stop 割の高さまで
    // 上がったところで止める（最後の行まで読めてから、次のカードが下から来る）
    const place = () => {
      if (!phone.matches) {
        el.style.top = "";
        return;
      }
      const nav = document.querySelector("header")?.getBoundingClientRect().height ?? 0;
      el.style.top = `${Math.min(nav, window.innerHeight * (stop ?? cardLayout.stop) - el.offsetHeight)}px`;
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener("resize", place);
    window.addEventListener("card-layout", place);
    phone.addEventListener("change", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("card-layout", place);
      phone.removeEventListener("change", place);
    };
  }, [stop]);

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
