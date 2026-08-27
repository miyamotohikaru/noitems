import "server-only";

import { useWebkul } from "./config";
import { mockAuctionProvider } from "./mock";
import { webkulAuctionProvider } from "./webkul";
import type { AuctionProvider } from "./types";

/**
 * 環境変数が揃っていれば Webkul、なければ土台用の mock。
 *
 * ここは "server-only"。APIキーで分岐しているので、
 * ブラウザから import するとキーが漏れるか、あるいは黙って mock 側に落ちて
 * 「入札できたように見えて1件も入っていない」という最悪の事故になる。
 * クライアントは /api/auction と /api/bid だけを見る（lib/auctionClient.ts）。
 */
export const auction: AuctionProvider = useWebkul
  ? webkulAuctionProvider
  : mockAuctionProvider;

export const providerName = auction.name;
