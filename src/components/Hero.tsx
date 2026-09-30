import { hero, site } from "@/lib/lot";
import { Bracket } from "./Bracket";
import { HeroObject, ResetFormButton } from "./HeroObject";

/**
 * キービジュアルのポスターと同じ組み方にする。
 * 紙の上に、小さめの立体をひとつ浮かせ、まわりは全部あける。
 * 写真を全面に敷くと余白の緊張が消えて、ただのDTCサイトになる。
 */
export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      {/* デスクトップ ── 紙の上に直に置く。矩形の縁をつくらない。
          文字の“後ろ”に敷く。文字は z-10 で前に出しているので読みやすさは保たれる。
          はみ出しは画面幅の％ではなく rem で持つ。％だと、立体を小さくしたときに
          枠だけ右に残って、物体の右端がかえって外へ出てしまう。 */}
      <HeroObject
        className="pointer-events-none absolute top-1/2 z-0 hidden
                   right-[3rem] 2xl:right-[7rem]
                   w-[min(64vw,55rem)] -translate-y-1/2 md:block"
        showReset={false}
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

          {/* かたちを戻すボタン。立体は画面いっぱいに大きく、その下に置くと
              画面外へ出てしまうので、デスクトップでは本文の下に置く */}
          <ResetFormButton className="mt-9 hidden md:inline-flex" />
        </div>

        {/* モバイル ── 文字に重ねない。上下をたっぷりあけて、小さく置く */}
        <div className="mt-4 -mb-10 flex justify-center md:hidden">
          <HeroObject className="w-[132%] -mx-[16%]" />
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
