import { site } from "@/lib/lot";
import { Bracket } from "./Bracket";
import { SiteFooter } from "./Sections";

/* ［　］は未確定。文言が決まったら差し替える */
function fill(text: string) {
  return text.split(/(［[^］]*］)/g).map((part, i) =>
    part.startsWith("［") ? (
      <span
        key={i}
        className="text-ink/38 [border-bottom:1px_dotted_var(--rule-firm)]"
      >
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export type LegalRow = { term: string; body: string[] };

export function LegalShell({
  title,
  lead,
  rows,
}: {
  title: string;
  lead?: string;
  rows: LegalRow[];
}) {
  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 h-[var(--nav-h)] border-b border-[var(--rule)] bg-ground/78 backdrop-blur-md">
        <div className="page flex h-full items-center justify-between gap-6">
          <a href="/" className="-my-2 py-2" aria-label={`${site.title} ホームへ`}>
            <Bracket gap={3.4} className="h-7 w-auto" />
          </a>
          <a href="/#auction" className="btn-line">
            オークションへ
          </a>
        </div>
      </header>

      <main className="page pt-[calc(var(--nav-h)+clamp(3rem,7vw,6rem))] pb-[clamp(4rem,8vw,7rem)]">
        <hr className="rule mb-6 w-14 border-t-[var(--rule-firm)]" />
        <h1 className="heading">{title}</h1>
        {lead && <p className="prose-jp mt-8 max-w-[46rem]">{fill(lead)}</p>}

        <dl className="mt-12 max-w-[59.5rem] border-t border-[var(--rule)]">
          {rows.map((row) => (
            <div
              key={row.term}
              className="grid gap-3 border-b border-[var(--rule)] py-7 md:grid-cols-[minmax(0,16rem)_minmax(0,38rem)] md:gap-14"
            >
              <dt className="text-[0.875rem] font-normal leading-[1.9] tracking-[0.06em]">
                {row.term}
              </dt>
              <dd className="prose-jp">
                {row.body.map((line, i) => (
                  <span key={i} className="block">
                    {fill(line)}
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>

        <p className="label-jp mt-10">最終更新 ［YYYY年M月D日］</p>
      </main>

      <SiteFooter />
    </>
  );
}
