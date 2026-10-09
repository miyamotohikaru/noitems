import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { admin } from "@/lib/shopify/config";

export const dynamic = "force-dynamic";

/**
 * インストールの戻り先。ここで引換券をトークンに替える。
 *
 * ⚠️ Shopify からの戻りであることを HMAC で必ず確かめる。
 *    確かめないと、偽の戻りを投げ込まれて別のストアのトークンを
 *    掴まされる余地が出る。
 *
 * 取れたトークンは画面に1度だけ出す。環境変数に入れたら、
 * このルートごと消してよい。
 */
function validHmac(url: URL): boolean {
  const params = new URLSearchParams(url.search);
  const given = params.get("hmac") ?? "";
  params.delete("hmac");

  const sorted = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  const message = sorted.map(([k, v]) => `${k}=${v}`).join("&");
  const want = createHmac("sha256", admin.clientSecret)
    .update(message)
    .digest("hex");

  if (given.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const shopParam = url.searchParams.get("shop");
  const expected = request.cookies.get("noitems_install_state")?.value;

  if (!code || !shopParam || !state || state !== expected || !validHmac(url)) {
    return NextResponse.json({ error: "不正な戻りです。" }, { status: 400 });
  }

  const res = await fetch(`https://${shopParam}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: admin.clientId,
      client_secret: admin.clientSecret,
      code,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: `トークンを取得できませんでした (${res.status})` },
      { status: 502 },
    );
  }

  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    return NextResponse.json({ error: "トークンがありません。" }, { status: 502 });
  }

  // 一度だけ画面に出す。ここからコピーして環境変数へ。
  return new NextResponse(
    [
      "インストールできました。",
      "",
      "下の1行を SHOPIFY_ADMIN_TOKEN として環境変数に入れてください。",
      "入れ終わったら、このページは二度と開かないでください。",
      "",
      json.access_token,
    ].join("\n"),
    {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        // 検索に拾われないように
        "x-robots-tag": "noindex, nofollow",
      },
    },
  );
}
