import { NextResponse } from "next/server";
import { cleanNickname, readSession, writeSession } from "@/lib/session";
import { saveNickname } from "@/lib/shopify/admin";
import { canReadNicknames, NICKNAME_MAX } from "@/lib/shopify/config";

export const dynamic = "force-dynamic";

/**
 * ニックネームを決める。入札記録に出る名前。
 *
 * ⚠️ 誰の名前を書き換えるかは**Cookieのログイン状態からだけ**決める。
 *    画面から顧客IDを受け取ると、他人の名前を書き換えられてしまう。
 */
export async function POST(request: Request) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json(
      { error: "先にログインしてください。" },
      { status: 401 },
    );
  }
  if (!canReadNicknames) {
    return NextResponse.json(
      { error: "ニックネームの保存先がまだ設定されていません。" },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    nickname?: string;
  } | null;
  const nickname = cleanNickname(body?.nickname ?? "");
  if (!nickname) {
    return NextResponse.json(
      { error: `ニックネームを${NICKNAME_MAX}文字までで入れてください。` },
      { status: 400 },
    );
  }

  try {
    await saveNickname(session.customerId, nickname);
  } catch (error) {
    console.error("[nickname] save", error);
    return NextResponse.json(
      { error: "保存できませんでした。しばらくして試してください。" },
      { status: 502 },
    );
  }

  await writeSession({ ...session, nickname });
  return NextResponse.json({ ok: true, nickname });
}
