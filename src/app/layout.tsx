import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_JP, Noto_Serif_JP } from "next/font/google";
import "./globals.css";
import { site } from "@/lib/lot";

const sansJP = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["200", "300", "400", "500"],
  variable: "--font-sans-jp",
  display: "swap",
  preload: false, // 和文は unicode-range 分割が多い。全部を先読みさせない
});

const serifJP = Noto_Serif_JP({
  subsets: ["latin"],
  weight: ["300", "400"],
  variable: "--font-serif-jp",
  display: "swap",
  preload: false,
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["200", "300", "400", "500"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: `${site.title} ｜ ${site.lotKind} ${site.lotLabel}`,
    template: `%s ｜ ${site.title}`,
  },
  description:
    "用途・名称・金額が決まっていないもの。たった一点だけの、オークション。KOSU.KUMA × GAMO PRODUCT DESIGN STUDIO",
  openGraph: {
    title: `${site.title} ｜ ${site.lotKind}`,
    description: "用途も、名前も、値段もありません。あるのは、かたちだけ。",
    locale: "ja_JP",
    type: "website",
  },
  // 公開前のため検索には出さない。公開時にこの行を外す
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#e9e4db",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="ja"
      className={`${sansJP.variable} ${serifJP.variable} ${inter.variable}`}
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}
