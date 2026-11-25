"use client";

import { useEffect, useState } from "react";
import { nav, site } from "@/lib/lot";
import { Bracket } from "./Bracket";

export function SiteHeader() {
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const onScroll = () => setSettled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      data-settled={settled}
      className="fixed inset-x-0 top-0 z-50 h-[var(--nav-h)]
                 border-b border-transparent
                 transition-[background-color,border-color,backdrop-filter] duration-700
                 data-[settled=true]:border-[var(--rule)]
                 data-[settled=true]:bg-ground/82
                 data-[settled=true]:backdrop-blur-md"
    >
      <div className="page flex h-[var(--nav-row)] items-center justify-between gap-6">
        <a
          href="#top"
          className="-my-2 shrink-0 py-2"
          aria-label={`${site.title} ホームへ`}
        >
          {/* ロゴ用は見出しよりアキを詰める。小さいと「汚れが2つ」に見えるため */}
          <Bracket gap={3.4} className="h-7 w-auto" />
        </a>

        <nav className="hidden items-center gap-9 md:flex" aria-label="セクション">
          {nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="link-ul text-[0.8125rem] font-light tracking-[0.14em] text-ink/82 transition-colors duration-500 hover:text-ink"
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* 入札ボタン。中身は AuctionRoom が #header-bid へ差し込む。
            オークションが読めなかったときだけ下の「入札する」が残る（globals.css の .header-bid-fallback） */}
        <div className="flex shrink-0 items-center gap-4 md:gap-6">
          <div id="header-bid" className="contents" />
          <a href="#auction" className="header-bid-fallback btn-line shrink-0">
            入札する
          </a>
        </div>
      </div>

      {/* 2段目: いまの金額と残り時間。はじめからずっと出す（2026-11-25 ユーザー指定
          「残り時間と金額がヘッダーに欲しい」「ヘッダーの一個下」。それまでは下端のバーに出していた）。
          中身は AuctionRoom が #header-sub へ差し込む */}
      <div className="border-t border-[var(--rule)] bg-ground/82 backdrop-blur-md">
        <div
          id="header-sub"
          className="page flex h-[var(--nav-sub)] items-center justify-between gap-4"
        />
      </div>
    </header>
  );
}
