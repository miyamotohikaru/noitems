/**
 * 作品名「　　　　　」。
 *
 * フォントの括弧を打つと、em内の位置と細さがそのまま出てしまい、
 * キービジュアルのポスターとは別物になる。あれは組まれた記号なので、
 * ここでも比率を写して作字する。
 *
 *   ・線の太さ ＝ 括弧の高さの 15%
 *   ・閉じ括弧の落差 ＝ 括弧の高さの 1.35 倍
 *   ・あいだのアキ ＝ 括弧の高さの 8 倍（見出し用）／ 3.4 倍（ロゴ用）
 *
 * あいだの空白が、そのまま作品の名前になっている。
 */

const SIZE = 100; // 括弧の一辺
const STROKE = 15;
const DROP = 135; // 閉じ括弧の落差
const HEIGHT = SIZE + DROP;

export function Bracket({
  gap = 8,
  className = "",
  title,
}: {
  /** あいだのアキ。括弧の高さに対する倍率 */
  gap?: number;
  className?: string;
  /** 読み上げ用。省略すると装飾として無視される */
  title?: string;
}) {
  const width = SIZE * 2 + SIZE * gap;
  const half = STROKE / 2;
  const arm = SIZE - half;

  return (
    <svg
      viewBox={`0 0 ${width} ${HEIGHT}`}
      className={className}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      vectorEffect="non-scaling-stroke"
    >
      {/* 「 ── 左上 */}
      <path d={`M ${SIZE} ${half} H ${half} V ${arm}`} />
      {/* 」 ── 右下。1.35倍ぶん落として斜めにずらす */}
      <path
        d={`M ${width - SIZE} ${HEIGHT - half} H ${width - half} V ${DROP + half}`}
      />
    </svg>
  );
}
