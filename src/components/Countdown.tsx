"use client";

import { useEffect, useMemo, useState } from "react";
import { splitRemaining } from "@/lib/format";

/**
 * 端末の時計を信じない。サーバーが返した時刻との差を持ち回る。
 * 5分ずれた端末で「残り 03:12」と出ている最中に実は終わっていた、を防ぐ。
 */
export function useServerOffset(serverNow: string) {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    setOffset(new Date(serverNow).getTime() - Date.now());
  }, [serverNow]);
  return offset;
}

export function useRemaining(endsAt: string, offsetMs = 0) {
  const target = useMemo(() => new Date(endsAt).getTime(), [endsAt]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [target]);

  return splitRemaining(target - (now + offsetMs));
}

/**
 * 残り時間。等幅数字で桁が揺れない。
 *
 * 読み上げは切ってある（role="timer" + aria-hidden）。
 * 250msごとに変わるノードをライブリージョンに置くと、
 * スクリーンリーダーが延々読み上げ続けて操作できなくなる。
 * 読み上げ用の文言は AuctionRoom 側の1つのライブリージョンにまとめている。
 */
export function Countdown({
  endsAt,
  offsetMs = 0,
  className = "",
}: {
  endsAt: string;
  offsetMs?: number;
  className?: string;
}) {
  const { days, hours, minutes, seconds } = useRemaining(endsAt, offsetMs);
  const clock = `${hours}:${minutes}:${seconds}`;

  return (
    <time
      dateTime={endsAt}
      role="timer"
      aria-hidden
      suppressHydrationWarning
      className={`num whitespace-nowrap tabular-nums ${className}`}
    >
      {days > 0 ? `${days}日 ${clock}` : clock}
    </time>
  );
}

/** 読み上げ用の粗い残り時間。1時間超は10分刻み、それ以下は1分刻み */
export function coarseRemaining(totalSec: number): string {
  if (totalSec <= 0) return "オークションは終了しました";
  if (totalSec >= 86400) return `残り およそ ${Math.floor(totalSec / 86400)}日`;
  if (totalSec >= 3600) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60 / 10) * 10;
    return `残り およそ ${h}時間${m > 0 ? ` ${m}分` : ""}`;
  }
  return `残り およそ ${Math.max(1, Math.ceil(totalSec / 60))}分`;
}
