import "server-only";

import { Redis } from "@upstash/redis";
import { SHIPPING_FEE_DOMESTIC, SHIPPING_FEE_OVERSEAS } from "../auction/config";
import { adminGql, canAutopay } from "./admin";
import { createCheckout } from "./storefront";

/**
 * 落札者にだけ、自動で請求する仕組み（2026-11-17 にテストモードで通しを確認）。
 *
 *  1. 入札の前に、¥0 の「入札のためのカード登録」を買ってもらう。
 *     定期購入の仕組み（販売プラン）を使っているので、カードと住所を預かった
 *     「契約」ができる。Shopify が勝手に請求することはない（請求はこちらから起こす）。
 *  2. 落札したら、その契約の「カード登録」の行を「落札額の行」に入れ替え、
 *     送料を足して1回だけ請求する。終わったらカード登録の行に戻し、送料を0に戻す。
 *     （カード登録の行を残したままだと、注文とメールに「カード登録 ¥0」が毎回載る）
 *
 * 請求は冪等キー（オークションID）で守っている。同じキーで何度呼んでも
 * Shopify は同じ請求を返すだけで、二重には引き落とさない。
 * 行を二重に足す事故は Upstash のロックで防ぐ。
 */

/** 「入札のためのカード登録」（¥0・配送あり・販売プラン必須） */
const CARD_VARIANT_ID = "41058488680577";
/** 「落札したときだけ請求」の販売プラン */
const CARD_SELLING_PLAN_ID = "12755992705";
const CARD_SELLING_PLAN_NAME = "落札したときだけ請求";
/** 注文とメールで、落札額の行の下に出る名前（無いと「毎年お届け」と読める英語が出る） */
const WIN_LINE_NAME = "1回のみのお支払い / One-time payment";

const isCardLine = (l: { variantId: string | null }) =>
  (l.variantId ?? "").endsWith(`/${CARD_VARIANT_ID}`);

const customerGid = (id: string) =>
  id.startsWith("gid://") ? id : `gid://shopify/Customer/${id}`;

/* ── 預かったカード（契約） ──────────────────────── */

type Address = {
  address1: string | null;
  address2: string | null;
  city: string | null;
  company: string | null;
  countryCode: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  provinceCode: string | null;
  zip: string | null;
};

type ShippingOption = {
  title: string | null;
  presentmentTitle: string | null;
  code: string | null;
  description: string | null;
};

export type Card = {
  contractId: string;
  /** 登録のときの配送先の国（JP なら国内） */
  countryCode: string | null;
  address: Address | null;
  shippingOption: ShippingOption | null;
  /** カード登録の行。前回の戻しに失敗していると無い（次の戻しで付け直す） */
  cardLineId: string | null;
  /** 登録の行以外（＝前回の請求の外し忘れ）。請求の前に外す */
  extraLineIds: string[];
};

/**
 * この人の、使えるカード登録。いちばん新しい有効な契約を使う。
 * 無ければ null（＝まだ登録していない）。
 */
export async function findCard(customerId: string): Promise<Card | null> {
  const data = await adminGql<{
    customer: {
      subscriptionContracts: {
        nodes: Array<{
          id: string;
          status: string;
          lines: { nodes: Array<{ id: string; variantId: string | null }> };
          deliveryMethod: {
            __typename: string;
            address?: Address;
            shippingOption?: ShippingOption;
          } | null;
        }>;
      };
    } | null;
  }>(
    `query($id: ID!) {
      customer(id: $id) {
        subscriptionContracts(first: 20, reverse: true) {
          nodes {
            id
            status
            lines(first: 10) { nodes { id variantId } }
            deliveryMethod {
              __typename
              ... on SubscriptionDeliveryMethodShipping {
                address {
                  address1 address2 city company
                  countryCode: countryCodeV2
                  firstName lastName phone provinceCode zip
                }
                shippingOption { title presentmentTitle code description }
              }
            }
          }
        }
      }
    }`,
    { id: customerGid(customerId) },
  );

  // 見えるのはこのアプリが作った契約だけ（Webkul などの契約は出てこない）。
  // カード登録の行があるものを優先し、無ければ（請求の後の戻しに失敗した）
  // いちばん新しい有効な契約を使う。カードと住所はそのまま生きている
  const active = (data.customer?.subscriptionContracts.nodes ?? []).filter(
    (n) => n.status === "ACTIVE",
  );
  const c = active.find((n) => n.lines.nodes.some(isCardLine)) ?? active[0];
  if (!c) return null;

  return {
    contractId: c.id,
    countryCode: c.deliveryMethod?.address?.countryCode ?? null,
    address: c.deliveryMethod?.address ?? null,
    shippingOption: c.deliveryMethod?.shippingOption ?? null,
    cardLineId: c.lines.nodes.find(isCardLine)?.id ?? null,
    extraLineIds: c.lines.nodes.filter((l) => !isCardLine(l)).map((l) => l.id),
  };
}

/** カード登録の支払い画面（¥0）。登録が済むと契約ができる */
export function cardCheckout(email: string): Promise<string> {
  return createCheckout(CARD_VARIANT_ID, email, {
    sellingPlanId: CARD_SELLING_PLAN_ID,
  });
}

/** 国内か海外かで送料を決める。値は auction/config.ts */
export function shippingFeeFor(countryCode: string | null): number {
  return countryCode === "JP" ? SHIPPING_FEE_DOMESTIC : SHIPPING_FEE_OVERSEAS;
}

/* ── 請求 ──────────────────────────────────────── */

export type SettleResult =
  | { status: "paid"; orderName: string }
  /** 別の処理が請求している最中 */
  | { status: "busy" }
  /** カード登録が無い。手動の支払い画面に回す */
  | { status: "no-card" }
  /** 請求の結果待ち。次に呼ばれたときに続きを見る */
  | { status: "pending" }
  /** カードが通らなかったなど。手動の支払い画面に回す */
  | { status: "failed"; reason: string };

let redisClient: Redis | null = null;
function redis(): Redis | null {
  if (redisClient) return redisClient;
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  redisClient = Redis.fromEnv();
  return redisClient;
}

const resultKey = (auctionId: string) => `autopay:${auctionId}`;

/** 前に請求を済ませた（または失敗した）記録 */
export async function settledResult(auctionId: string): Promise<SettleResult | null> {
  const r = redis();
  if (!r) return null;
  return (await r.get<SettleResult>(resultKey(auctionId))) ?? null;
}

type UserErrors = { userErrors: { message: string }[] };

function must<T extends UserErrors>(label: string, d: T | null | undefined): T {
  if (!d) throw new Error(`autopay: ${label} returned nothing`);
  if (d.userErrors.length) {
    throw new Error(`autopay: ${label} ${d.userErrors.map((e) => e.message).join(" / ")}`);
  }
  return d;
}

/** 契約を下書きにして、手を入れて、確定する */
async function editContract(
  contractId: string,
  edit: (draftId: string) => Promise<void>,
): Promise<void> {
  const { subscriptionContractUpdate: u } = await adminGql<{
    subscriptionContractUpdate: UserErrors & { draft: { id: string } | null };
  }>(
    `mutation($id: ID!) {
      subscriptionContractUpdate(contractId: $id) { draft { id } userErrors { message } }
    }`,
    { id: contractId },
  );
  const draftId = must("contractUpdate", u).draft!.id;

  await edit(draftId);

  const { subscriptionDraftCommit: c } = await adminGql<{
    subscriptionDraftCommit: UserErrors;
  }>(
    `mutation($d: ID!) {
      subscriptionDraftCommit(draftId: $d) { contract { id } userErrors { message } }
    }`,
    { d: draftId },
  );
  must("draftCommit", c);
}

async function removeLine(draftId: string, lineId: string) {
  const { subscriptionDraftLineRemove: r } = await adminGql<{
    subscriptionDraftLineRemove: UserErrors;
  }>(
    `mutation($d: ID!, $l: ID!) {
      subscriptionDraftLineRemove(draftId: $d, lineId: $l) { lineRemoved { id } userErrors { message } }
    }`,
    { d: draftId, l: lineId },
  );
  must("lineRemove", r);
}

/** 送料と、注文に載る送料の名前を変える */
async function setDelivery(draftId: string, card: Card, fee: number, title: string | null) {
  const input: Record<string, unknown> = { deliveryPrice: fee };
  if (card.address && title) {
    input.deliveryMethod = {
      shipping: {
        address: card.address,
        shippingOption: {
          title,
          presentmentTitle: title,
          code: card.shippingOption?.code ?? undefined,
          description: card.shippingOption?.description ?? undefined,
        },
      },
    };
  }
  const { subscriptionDraftUpdate: r } = await adminGql<{
    subscriptionDraftUpdate: UserErrors;
  }>(
    `mutation($d: ID!, $i: SubscriptionDraftInput!) {
      subscriptionDraftUpdate(draftId: $d, input: $i) { draft { id } userErrors { message } }
    }`,
    { d: draftId, i: input },
  );
  must("draftUpdate", r);
}

async function addLine(draftId: string, input: Record<string, unknown>) {
  const { subscriptionDraftLineAdd: a } = await adminGql<{
    subscriptionDraftLineAdd: UserErrors;
  }>(
    `mutation($d: ID!, $i: SubscriptionLineInput!) {
      subscriptionDraftLineAdd(draftId: $d, input: $i) { lineAdded { id } userErrors { message } }
    }`,
    { d: draftId, i: input },
  );
  must("lineAdd", a);
}

/**
 * 請求したあと、契約を登録したときの姿（カード登録の行だけ・送料0）に戻す。
 * カード登録の行は、販売プランごと付け直せば元と同じになる（2026-11-20 に確認）
 */
async function restore(card: Card) {
  const fresh = await findCardByContract(card);
  await editContract(card.contractId, async (draftId) => {
    // 先に足してから外す（行が0本の契約にしないため）
    if (!fresh.cardLineId) {
      await addLine(draftId, {
        productVariantId: `gid://shopify/ProductVariant/${CARD_VARIANT_ID}`,
        quantity: 1,
        currentPrice: 0,
        sellingPlanId: `gid://shopify/SellingPlan/${CARD_SELLING_PLAN_ID}`,
        sellingPlanName: CARD_SELLING_PLAN_NAME,
      });
    }
    for (const id of fresh.extraLineIds) await removeLine(draftId, id);
    await setDelivery(draftId, card, 0, card.shippingOption?.title ?? null);
  });
}

/** 今の行の姿を知るため、同じ契約を読み直す */
async function findCardByContract(card: Card): Promise<Card> {
  const { subscriptionContract: c } = await adminGql<{
    subscriptionContract: {
      lines: { nodes: Array<{ id: string; variantId: string | null }> };
    } | null;
  }>(
    `query($id: ID!) { subscriptionContract(id: $id) { lines(first: 10) { nodes { id variantId } } } }`,
    { id: card.contractId },
  );
  const lines = c?.lines.nodes ?? [];
  return {
    ...card,
    cardLineId: lines.find(isCardLine)?.id ?? null,
    extraLineIds: lines.filter((l) => !isCardLine(l)).map((l) => l.id),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 落札者に、落札額＋送料を請求する。何度呼んでも二重には請求しない。
 *
 * 呼ぶ側は「Webkul で支払いがまだ」の落札分だけを渡すこと。
 */
export async function settleWin(win: {
  auctionId: string;
  customerId: string;
  /** Webkul が落札のたびに作る、落札額のバリエーション */
  variantId: string;
  amount: number;
}): Promise<SettleResult> {
  if (!canAutopay()) return { status: "no-card" };

  const r = redis();
  // ロックが取れない環境では請求しない（行の二重追加を防げないため）
  if (!r) return { status: "busy" };

  // 済んだ結果（支払い済み・カードが通らなかった）はそのまま返す。
  // 通らなかったものを繰り返し請求しない。手動の支払い画面に回す
  const done = await settledResult(win.auctionId);
  if (done) return done;

  const lockKey = `${resultKey(win.auctionId)}:lock`;
  const locked = await r.set(lockKey, "1", { nx: true, ex: 300 });
  if (!locked) return { status: "busy" };

  try {
    const card = await findCard(win.customerId);
    if (!card) return { status: "no-card" };

    const fee = shippingFeeFor(card.countryCode);

    await editContract(card.contractId, async (draftId) => {
      // 落札額の行を先に足す（行が0本の契約にしないため）
      await addLine(draftId, {
        productVariantId: `gid://shopify/ProductVariant/${win.variantId}`,
        quantity: 1,
        currentPrice: win.amount,
        sellingPlanName: WIN_LINE_NAME,
      });
      // 前回の外し忘れと、カード登録の行を外す（注文に載せないため）。
      // カード登録の行は請求のあと restore() で付け直す
      for (const id of card.extraLineIds) await removeLine(draftId, id);
      if (card.cardLineId) await removeLine(draftId, card.cardLineId);

      await setDelivery(draftId, card, fee, "送料 / Shipping");
    });

    const { subscriptionBillingAttemptCreate: b } = await adminGql<{
      subscriptionBillingAttemptCreate: UserErrors & {
        subscriptionBillingAttempt: { id: string } | null;
      };
    }>(
      `mutation($c: ID!, $i: SubscriptionBillingAttemptInput!) {
        subscriptionBillingAttemptCreate(subscriptionContractId: $c, subscriptionBillingAttemptInput: $i) {
          subscriptionBillingAttempt { id }
          userErrors { message }
        }
      }`,
      {
        c: card.contractId,
        // ⚠️ この鍵が二重請求を止めている。オークションごとに1つ
        i: { idempotencyKey: `noitems-win-${win.auctionId}` },
      },
    );
    const attemptId = must("billingAttemptCreate", b).subscriptionBillingAttempt!.id;

    let result: SettleResult = { status: "pending" };
    for (let i = 0; i < 15; i++) {
      await sleep(2000);
      const { subscriptionBillingAttempt: s } = await adminGql<{
        subscriptionBillingAttempt: {
          ready: boolean;
          errorCode: string | null;
          errorMessage: string | null;
          order: { name: string } | null;
        } | null;
      }>(
        `query($id: ID!) {
          subscriptionBillingAttempt(id: $id) { ready errorCode errorMessage order { name } }
        }`,
        { id: attemptId },
      );
      if (!s?.ready) continue;
      result = s.order
        ? { status: "paid", orderName: s.order.name }
        : { status: "failed", reason: s.errorCode ?? s.errorMessage ?? "UNKNOWN" };
      break;
    }

    // 結果が出るまでは契約を戻さない（請求中に行を外さないため）
    if (result.status === "pending") return result;

    await r.set(resultKey(win.auctionId), result);
    await restore(card);
    return result;
  } catch (error) {
    console.error("[autopay] settle failed", win.auctionId, error);
    return { status: "failed", reason: "ERROR" };
  } finally {
    await r.del(lockKey);
  }
}
