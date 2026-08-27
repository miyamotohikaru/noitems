# 「　　　　　」 ── 一点物オークション

用途・名称・金額が決まっていないもの。たった一点だけのオークションサイト。
KOSU.KUMA × GAMO PRODUCT DESIGN STUDIO

## 動かす

```bash
npm install
npm run dev -- --port 3030   # 3000 は他プロジェクトが使っていることがある
```

## いまの状態

土台。見た目とページ構成はすべて入っている。入札の挙動はダミーで動いていて、
**Webkul（入札）と Shopify（決済）は差し込み口だけ用意してある**。

| もの | いま | これから |
| --- | --- | --- |
| 入札の挙動 | `src/lib/auction/mock.ts` のメモリ上のダミー | Webkul の Shopify オークションアプリ |
| 決済 | なし（`src/lib/checkout.ts` はスタブ） | Shopify のチェックアウト |
| ホスティング | ローカル | Vercel |

## つくりの要点

```
ブラウザ ──fetch──▶ /api/auction, /api/bid ──▶ provider（mock か Webkul）
```

**provider はサーバーにしか置かない**（`import "server-only"`）。
APIキーで mock と Webkul を切り替えているので、これをブラウザから直接呼ぶと
ブラウザ側だけ mock に落ちて「入札できたように見えて1件も入っていない」になる。
クライアントが知っているのは `src/lib/auctionClient.ts` の2本の fetch だけ。

そのほか、土台のうちに入れておいたもの:

- 残り時間はサーバー時刻との差で計算する（端末の時計がずれても狂わない）
- 入札は 上限 → 確認画面（漢数字併記）→ 送信 の三段。桁の打ち間違いで止まる
- 送信には冪等キーを付ける（再送しても二重入札にならない）
- タブに戻ったとき・窓に focus が戻ったときは取り直す。終了間際は3秒ごと
- 0 を割ったら一度だけサーバーに確定結果を取りに行く
- 読み上げ用のライブリージョンは1つだけ。カウントダウンは読ませない

## Webkul をつなぐ

UI は `AuctionState` という型しか知らない。だから差し替えるのは
**`src/lib/auction/webkul.ts` の1ファイルだけ**で、`src/components/` は一行も触らない。

1. Vercel に環境変数を入れる

   ```
   WEBKUL_AUCTION_ENDPOINT=…
   WEBKUL_API_KEY=…
   WEBKUL_AUCTION_ID=…
   ```

2. `src/lib/auction/webkul.ts` の `load()` と `placeBid()` の TODO を埋める。
   Webkul のレスポンスを `AuctionState`（`src/lib/auction/types.ts`）の形に写すだけ。
3. 3つの環境変数が揃うと `src/lib/auction/index.ts` が自動で mock から切り替わる。
   何も設定しなければ、いままで通りダミーで動く。

## Shopify をつなぐ

```
NEXT_PUBLIC_SHOPIFY_DOMAIN=xxxx.myshopify.com
NEXT_PUBLIC_SHOPIFY_VARIANT_ID=…
SHOPIFY_STOREFRONT_TOKEN=…
```

落札額は毎回変わるので、実運用は次のどちらかになる。
決まったら `src/lib/checkout.ts` を埋める。

- 落札額で Draft Order を作る（Admin API）
- Webkul が発行する支払いリンクをそのまま使う

## 中身

```
src/
  app/
    page.tsx              トップ（サーバー側で現在値を読んでから描く）
    globals.css           色・書体・余白のトークンはここに集約
    privacy | terms | tokushoho   法務ページ（［　］は未確定）
  components/
    Hero / AuctionRoom / BidDialog / Countdown / Sections / SiteHeader …
  lib/
    auction/              オークションの状態。provider を差し替える層
    lot.ts                ページに出る文言はすべてここ
    format.ts             金額・時刻の整形
public/img/               キービジュアルの素材を WebP 化したもの
```

## 決めごと

- **色を足さない。** 用途も名前も決まっていないものなので、地の紙と墨だけで組む。
  唯一の例外は終了間際の朱（`--color-alert`）。
- **文言は `src/lib/lot.ts` に集約。** デザインを触らずに文章だけ直せる。
- **`［　］` で囲んだ箇所は未確定**（仕上げ・寸法・日数・事業者情報）。
  画面上では点線の下線で薄く出るので、埋め忘れが目で分かる。
- 数字は必ず等幅（`.num`）。カウントダウンの桁が揺れないため。
- 和文は `font-feature-settings: "palt"`。約物のアキを詰めないと素人くさくなる。

## 公開するとき

`src/app/layout.tsx` の `robots: { index: false, follow: false }` を外す。
いまは公開前なので検索に出さない設定にしてある。
