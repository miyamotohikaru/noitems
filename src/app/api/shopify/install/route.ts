import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { admin, shop } from "@/lib/shopify/config";

export const dynamic = "force-dynamic";

/**
 * Admin API のトークンを取るための、一度きりの入口。
 *
 * Shopify のアプリは「インストールの手続きを通す」ことでしか
 * Admin API のトークンを出さない。画面からコピーできる種類の値ではない。
 *
 * ⚠️ 誰でも叩けると困るので、合言葉（INSTALL_SECRET）を要求する。
 *    トークンが取れたらこのルートは消してよい。
 */
export async function GET(request: NextRequest) {
  const secret = process.env.INSTALL_SECRET;
  const key = new URL(request.url).searchParams.get("key");
  if (!secret || key !== secret) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const state = randomBytes(16).toString("hex");
  const u = new URL(`https://${shop.domain}/admin/oauth/authorize`);
  u.searchParams.set("client_id", admin.clientId);
  u.searchParams.set("scope", "read_customers,write_customers");
  u.searchParams.set(
    "redirect_uri",
    `${new URL(request.url).origin}/api/shopify/install/callback`,
  );
  u.searchParams.set("state", state);

  const res = NextResponse.redirect(u.toString());
  res.cookies.set("noitems_install_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
