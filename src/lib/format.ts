export function yen(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP")}`;
}

const KANJI = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const PLACE = ["", "十", "百", "千"];

function under10000(n: number): string {
  let out = "";
  for (let i = 3; i >= 0; i--) {
    const d = Math.floor(n / 10 ** i) % 10;
    if (d === 0) continue;
    out += (d === 1 && i > 0 ? "" : KANJI[d]) + PLACE[i];
  }
  return out;
}

/**
 * 漢数字。¥12,400,000 を「千二百四十万円」と併記して、
 * 桁を1つ多く打ったことに気づけるようにする。
 */
export function kanjiYen(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "";
  const oku = Math.floor(amount / 1e8);
  const man = Math.floor((amount % 1e8) / 1e4);
  const rest = Math.floor(amount % 1e4);
  return (
    (oku ? under10000(oku) + "億" : "") +
    (man ? under10000(man) + "万" : "") +
    (rest ? under10000(rest) : "") +
    "円"
  );
}

/** 残り時間を日・時・分・秒に割る */
export function splitRemaining(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  return {
    total,
    days,
    hours: String(Math.floor((total % 86400) / 3600)).padStart(2, "0"),
    minutes: String(Math.floor((total % 3600) / 60)).padStart(2, "0"),
    seconds: String(total % 60).padStart(2, "0"),
  };
}

const TZ = "Asia/Tokyo";

export function jstDateTime(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: TZ,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function jstClock(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
