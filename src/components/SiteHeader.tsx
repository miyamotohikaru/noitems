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
      <div className="page flex h-full items-center justify-between gap-6">
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

        <a href="#auction" className="btn-line shrink-0">
          入札する
        </a>
      </div>
    </header>
  );
}
