import { hero, site } from "@/lib/lot";
import { Bracket } from "./Bracket";

/**
 * キービジュアルのポスターと同じ組み方にする。
 * 紙の上に、小さめの立体をひとつ浮かせ、まわりは全部あける。
 * 写真を全面に敷くと余白の緊張が消えて、ただのDTCサイトになる。
 */
export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      {/* デスクトップ ── 紙の上に直に置く。矩形の縁をつくらない */}
      <img
        src="/img/form-hero.webp"
        alt=""
        aria-hidden
        fetchPriority="high"
        decoding="async"
        className="cutout pointer-events-none absolute right-[8%] top-1/2 hidden
                   w-[min(30vw,25rem)] -translate-y-1/2 md:block"
      />

      {/* キービジュアルの署名。明朝の縦組みでここだけ書体を変える */}
      <p
        className="vertical font-mincho pointer-events-none absolute hidden lg:block
                   right-[var(--spacing-gutter)] top-[calc(var(--nav-h)+4rem)]
                   text-[0.9375rem] font-light tracking-[0.12em] text-ink/72"
      >
        {site.tagline}
      </p>

      <div
        className="page relative flex flex-col justify-center
                   pt-[calc(var(--nav-h)+3rem)] pb-14
                   md:min-h-[100svh] md:pb-[clamp(5rem,12vh,9rem)]"
      >
        <div className="relative z-10 max-w-[34rem]">
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
        </div>

        {/* モバイル ── 文字に重ねない。上下をたっぷりあけて、小さく置く */}
        <div className="mt-16 mb-4 flex justify-center md:hidden">
          <img
            src="/img/form-hero.webp"
            alt="つや消しの銀色をした、用途の定まらないかたち"
            decoding="async"
            className="cutout w-[58%]"
          />
        </div>
      </div>

      {/* 下へ続くことだけを、静かに示す */}
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-8 hidden flex-col items-start gap-3
                   left-[var(--spacing-gutter)] md:flex"
      >
        <span className="label text-[0.625rem] tracking-[0.3em]">SCROLL</span>
        <span className="relative block h-12 w-px overflow-hidden bg-[var(--rule-firm)]">
          <span className="absolute inset-x-0 top-0 h-4 bg-ink/70 animate-[trickle_2.6s_cubic-bezier(0.7,0,0.3,1)_infinite]" />
        </span>
      </div>
    </section>
  );
}
