import { auction } from "@/lib/auction";
import { AuctionRoom } from "@/components/AuctionRoom";
import { Hero } from "@/components/Hero";
import { SiteHeader } from "@/components/SiteHeader";
import {
  Concept,
  Details,
  Faq,
  Forms,
  LotPlate,
  SiteFooter,
} from "@/components/Sections";

// オークションの現在値をキャッシュに乗せない
export const dynamic = "force-dynamic";

export default async function Page() {
  let initial = null;
  try {
    initial = await auction.load();
  } catch (error) {
    // オークションが落ちていても、作品のページ自体は必ず出す
    console.error("[page] auction.load failed", error);
  }

  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        {initial ? (
          <AuctionRoom initial={initial} />
        ) : (
          <section id="auction" className="page py-[var(--gap-major)]">
            <div className="sheet max-w-[var(--measure)] px-8 py-10">
              <p className="text-[0.9375rem] leading-[1.95]">
                入札は一時的にご利用いただけません。
              </p>
              <p className="prose-jp mt-4">
                復旧までしばらくお待ちください。お急ぎの場合は
                ［メールアドレス］ までご連絡ください。
              </p>
            </div>
          </section>
        )}
        <LotPlate />
        <Concept />
        <Forms />
        <Details />
        <Faq />
      </main>
      <SiteFooter />
    </>
  );
}
