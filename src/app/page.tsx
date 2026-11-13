import { auction } from "@/lib/auction";
import { AuctionRoom } from "@/components/AuctionRoom";
import { Card } from "@/components/Card";
import { Hero } from "@/components/Hero";
import { Loader } from "@/components/Loader";
import { PaymentDrawer } from "@/components/PaymentDrawer";
import { SiteHeader } from "@/components/SiteHeader";
import {
  Concept,
  Faq,
  Forms,
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
      <Loader />
      <SiteHeader />
      <PaymentDrawer />
      <main>
        <Hero />
        {initial ? (
          <AuctionRoom initial={initial} />
        ) : (
          <Card no="01" label="入札">
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
          </Card>
        )}
        {/* スマホでは、項目ごとに下から重なってくるカードにする（components/Card.tsx） */}
        {/* 入札のあとの一枚（LotPlate）は 2026-11-10 にユーザーの指示で外した */}
        <Card no="02" label="コンセプト">
          <Concept />
        </Card>
        <Card no="03" label="かたち" stop={1}>
          <Forms />
        </Card>
        {/* スマホで、かたちの並びを右まで送るあいだの空き（components/FormsSlide.tsx）。PC では高さ 0 */}
        <div id="forms-hold" aria-hidden className="forms-hold" />
        {/* 近くで見る（Details）は 2026-11-10 にユーザーの指示で外した */}
        <Card no="04" label="問い">
          <Faq />
        </Card>
      </main>
      <SiteFooter />
    </>
  );
}
