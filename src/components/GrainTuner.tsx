"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SILVER, type Silver } from "@/lib/sykim/silverGrain";
import {
  AUTO_SPEED,
  CARD,
  END_SCALE,
  SHADE,
  MOBILE,
  START_SCALE,
  TURN,
  applyCard,
  applyShade,
  heroLayout,
  heroMotion,
  heroTurn,
  mobileLayout,
} from "@/lib/sykim/motion";

/**
 * 立体の質感を、その場で動かして確かめる調整パネル。
 * URL に ?tune を付けたときだけ出る（例: https://noitems01.vercel.app/?tune）。
 *
 * 使い方: つまみを動かす →「値をコピー」→ その文字をそのまま Claude に送る。
 * 送られた値を lib/sykim/silverGrain.ts の SILVER に書き写して確定する
 * （ground だけは背景色なので globals.css の --color-ground へ）。
 * 動かした値はこのブラウザに覚えておくので、再読み込みしても消えない。
 */

// 黒い粒子の頃（noitems-grain-tune）とは値の中身が違うので、覚える場所を分ける
const STORE = "noitems-silver-tune";

/** ページの背景（globals.css の --color-ground）。立体の値と一緒に調整する */
const GROUND = "#d9d7d3";
// autoSpeed は lib/sykim/motion.ts の AUTO_SPEED（引ききったあと、ひとりでに動く速さ）
// startScale / endScale も motion.ts（立体の大きさ）
// m* はスマホの配置、card* はスマホのカード、turn は PC の回る速さ（どれも motion.ts）
type Tune = Silver & {
  ground: string;
  autoSpeed: number;
  startScale: number;
  endScale: number;
  turn: number;
  mLength: number;
  mStart: number;
  mEnd: number;
  mX: number;
  mY: number;
  mTurn: number;
  cardAlpha: number;
  cardBlur: number;
  cardRadius: number;
  cardShadow: number;
  cardStop: number;
  cardSlide: number;
  shadeAlpha: number;
  shadeBlur: number;
};
const DEFAULT: Tune = {
  ...SILVER,
  ground: GROUND,
  autoSpeed: AUTO_SPEED,
  startScale: START_SCALE,
  endScale: END_SCALE,
  turn: TURN,
  mLength: MOBILE.length,
  mStart: MOBILE.startScale,
  mEnd: MOBILE.endScale,
  mX: MOBILE.endX,
  mY: MOBILE.endY,
  mTurn: MOBILE.turn,
  cardAlpha: CARD.alpha,
  cardBlur: CARD.blur,
  cardRadius: CARD.radius,
  cardShadow: CARD.shadow,
  cardStop: CARD.stop,
  cardSlide: CARD.slide,
  shadeAlpha: SHADE.alpha,
  shadeBlur: SHADE.blur,
};

/** 動きと大きさを当てる（質感以外） */
function applyMotion(g: Tune) {
  heroMotion.autoSpeed = g.autoSpeed;
  heroTurn.pc = g.turn;
  heroLayout.startScale = g.startScale;
  heroLayout.endScale = g.endScale;
  Object.assign(mobileLayout, {
    length: g.mLength,
    startScale: g.mStart,
    endScale: g.mEnd,
    endX: g.mX,
    endY: g.mY,
    turn: g.mTurn,
  });
  applyCard({
    alpha: g.cardAlpha,
    blur: g.cardBlur,
    radius: g.cardRadius,
    shadow: g.cardShadow,
    stop: g.cardStop,
    slide: g.cardSlide,
  });
  applyShade({ alpha: g.shadeAlpha, blur: g.shadeBlur });
  // Hero に置き直させる（大きさ・位置・最初の場面の長さ）
  window.dispatchEvent(new Event("hero-layout"));
}

const toHex = (a: number[]) =>
  "#" + a.slice(0, 3).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) =>
  [1, 3, 5].map((i) => +(parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3));
const isHex = (h: string) => /^#[0-9a-fA-F]{6}$/.test(h);

/** 背景色を変える。節の帯（--color-ground-lift）は今と同じ差で少し明るくする */
function paint(hex: string) {
  const el = document.documentElement;
  if (hex.toLowerCase() === GROUND) {
    el.style.removeProperty("--color-ground");
    el.style.removeProperty("--color-ground-lift");
    return;
  }
  const lift = toHex(fromHex(hex).map((v, i) => v + [6, 6, 7][i] / 255));
  el.style.setProperty("--color-ground", hex);
  el.style.setProperty("--color-ground-lift", lift);
}

type Swatch = {
  label: string;
  hint: string;
  get: (g: Tune) => string;
  set: (g: Tune, hex: string) => Tune;
};

const SWATCHES: Swatch[] = [
  { label: "背景の色", hint: "ページの地",
    get: (g) => g.ground, set: (g, h) => ({ ...g, ground: h }) },
  { label: "本体の色", hint: "金属の色",
    get: (g) => g.base, set: (g, h) => ({ ...g, base: h }) },
];

type Knob = {
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  get: (g: Tune) => number;
  set: (g: Tune, v: number) => Tune;
};

const GROUPS: { title: string; knobs: Knob[] }[] = [
  {
    title: "粒",
    knobs: [
      { label: "ざらつき", hint: "画素ごとの明るさの揺れ", min: 0, max: 0.15, step: 0.001,
        get: (g) => g.noise, set: (g, v) => ({ ...g, noise: v }) },
      { label: "白い粒の量", hint: "光った所に散る白い点", min: 0, max: 0.8, step: 0.01,
        get: (g) => g.dots, set: (g, v) => ({ ...g, dots: v }) },
      { label: "白い粒が出る所", hint: "小さいほど暗い所にも出る", min: 0, max: 1, step: 0.01,
        get: (g) => g.dotsFrom, set: (g, v) => ({ ...g, dotsFrom: v }) },
      { label: "黒い粒の量", hint: "影に散る黒い点", min: 0, max: 0.8, step: 0.01,
        get: (g) => g.darkDots, set: (g, v) => ({ ...g, darkDots: v }) },
      { label: "粒の大きさ", hint: "画素数", min: 1, max: 4, step: 1,
        get: (g) => g.grainPx, set: (g, v) => ({ ...g, grainPx: v }) },
      { label: "ラメ", hint: "銀色に元からある金属の粒。1で元のまま", min: 0, max: 1, step: 0.01,
        get: (g) => g.flake, set: (g, v) => ({ ...g, flake: v }) },
      { label: "表面の凹凸", hint: "1で元のまま、0でつるつる", min: 0, max: 1.5, step: 0.01,
        get: (g) => g.bump, set: (g, v) => ({ ...g, bump: v }) },
      { label: "光り方のムラ", hint: "1で元のまま、0で均一", min: 0, max: 1.5, step: 0.01,
        get: (g) => g.mottle, set: (g, v) => ({ ...g, mottle: v }) },
    ],
  },
  {
    title: "大きさ",
    knobs: [
      { label: "はじめの大きさ", hint: "1で従来の大きさ", min: 0.4, max: 1.2, step: 0.01,
        get: (g) => g.startScale, set: (g, v) => ({ ...g, startScale: v }) },
      { label: "引いたときの大きさ", hint: "1で従来の大きさ", min: 0.5, max: 1.5, step: 0.01,
        get: (g) => g.endScale, set: (g, v) => ({ ...g, endScale: v }) },
    ],
  },
  {
    title: "動き",
    knobs: [
      { label: "ひとりでに動く速さ", hint: "引ききったあと。0で止まる", min: 0, max: 2, step: 0.01,
        get: (g) => g.autoSpeed, set: (g, v) => ({ ...g, autoSpeed: v }) },
      { label: "回る速さ（PC）", hint: "画面1つぶんのスクロールで何周", min: 0, max: 1, step: 0.01,
        get: (g) => g.turn, set: (g, v) => ({ ...g, turn: v }) },
    ],
  },
  {
    title: "スマホの配置（スマホで開いたときだけ効く）",
    knobs: [
      { label: "最初の場面の長さ", hint: "立体だけが映るあいだ。画面の高さの%", min: 110, max: 440, step: 5,
        get: (g) => g.mLength, set: (g, v) => ({ ...g, mLength: v }) },
      { label: "はじめの大きさ", hint: "1で画面の短い辺の1.7倍", min: 0.3, max: 1.4, step: 0.01,
        get: (g) => g.mStart, set: (g, v) => ({ ...g, mStart: v }) },
      { label: "引いたときの大きさ", hint: "1で幅の132%", min: 0.3, max: 1.8, step: 0.01,
        get: (g) => g.mEnd, set: (g, v) => ({ ...g, mEnd: v }) },
      { label: "引いたときの横の位置", hint: "0で左端、0.5で真ん中", min: -0.2, max: 1.2, step: 0.01,
        get: (g) => g.mX, set: (g, v) => ({ ...g, mX: v }) },
      { label: "引いたときの縦の位置", hint: "0で上端、0.5で真ん中", min: -0.2, max: 1.2, step: 0.01,
        get: (g) => g.mY, set: (g, v) => ({ ...g, mY: v }) },
      { label: "回る速さ", hint: "画面1つぶんのスクロールで何周", min: 0, max: 1.5, step: 0.01,
        get: (g) => g.mTurn, set: (g, v) => ({ ...g, mTurn: v }) },
    ],
  },
  {
    title: "地のある所（影）",
    knobs: [
      { label: "地の濃さ", hint: "下げると後ろの立体の影が濃く出る。1で影なし", min: 0.4, max: 1, step: 0.01,
        get: (g) => g.shadeAlpha, set: (g, v) => ({ ...g, shadeAlpha: v }) },
      { label: "影のぼかし", hint: "px", min: 0, max: 40, step: 1,
        get: (g) => g.shadeBlur, set: (g, v) => ({ ...g, shadeBlur: v }) },
    ],
  },
  {
    title: "カード（スマホ）",
    knobs: [
      { label: "止まる高さ", hint: "下端がここまで上がってから次が来る。1で画面の下端", min: 0.3, max: 1, step: 0.01,
        get: (g) => g.cardStop, set: (g, v) => ({ ...g, cardStop: v }) },
      { label: "かたちを送る長さ", hint: "5つの並びを右まで送るのに、画面いくつぶんスクロールするか", min: 0.3, max: 3, step: 0.05,
        get: (g) => g.cardSlide, set: (g, v) => ({ ...g, cardSlide: v }) },
      { label: "地の濃さ", hint: "1で透けない。下げると後ろの立体が透ける", min: 0.3, max: 1, step: 0.01,
        get: (g) => g.cardAlpha, set: (g, v) => ({ ...g, cardAlpha: v }) },
      { label: "後ろのぼかし", hint: "px", min: 0, max: 40, step: 1,
        get: (g) => g.cardBlur, set: (g, v) => ({ ...g, cardBlur: v }) },
      { label: "上の角の丸み", hint: "px", min: 0, max: 32, step: 1,
        get: (g) => g.cardRadius, set: (g, v) => ({ ...g, cardRadius: v }) },
      { label: "上の縁の影", hint: "", min: 0, max: 1, step: 0.01,
        get: (g) => g.cardShadow, set: (g, v) => ({ ...g, cardShadow: v }) },
    ],
  },
  {
    title: "引き（スクロールで縮んだとき）",
    knobs: [
      { label: "ラメ", hint: "", min: 0, max: 1, step: 0.01,
        get: (g) => g.farFlake, set: (g, v) => ({ ...g, farFlake: v }) },
      { label: "ラメの大きさ", hint: "1で近くと同じ", min: 1, max: 5, step: 0.05,
        get: (g) => g.farFlakeSize, set: (g, v) => ({ ...g, farFlakeSize: v }) },
      { label: "粗さの上限", hint: "ほどけた時に粒が大きすぎるなら下げる", min: 1, max: 6, step: 0.05,
        get: (g) => g.farSizeMax, set: (g, v) => ({ ...g, farSizeMax: v }) },
      { label: "表面の凹凸", hint: "", min: 0, max: 2, step: 0.01,
        get: (g) => g.farBump, set: (g, v) => ({ ...g, farBump: v }) },
      { label: "凹凸の大きさ", hint: "1で近くと同じ", min: 1, max: 5, step: 0.05,
        get: (g) => g.farBumpSize, set: (g, v) => ({ ...g, farBumpSize: v }) },
      { label: "光り方のムラ", hint: "", min: 0, max: 1.5, step: 0.01,
        get: (g) => g.farMottle, set: (g, v) => ({ ...g, farMottle: v }) },
      { label: "ざらつき", hint: "", min: 0, max: 0.15, step: 0.001,
        get: (g) => g.farNoise, set: (g, v) => ({ ...g, farNoise: v }) },
      { label: "白い粒の量", hint: "", min: 0, max: 0.8, step: 0.01,
        get: (g) => g.farDots, set: (g, v) => ({ ...g, farDots: v }) },
      { label: "継ぎ目の暗さ", hint: "白い線が浮くなら下げる", min: 0, max: 1, step: 0.01,
        get: (g) => g.farSeam, set: (g, v) => ({ ...g, farSeam: v }) },
      { label: "明るさ", hint: "近くとの差", min: -1.5, max: 1.5, step: 0.01,
        get: (g) => g.farExposure, set: (g, v) => ({ ...g, farExposure: v }) },
    ],
  },
  {
    title: "金属",
    knobs: [
      { label: "明るさ", hint: "全体の露出", min: -3, max: 0.5, step: 0.01,
        get: (g) => g.exposure, set: (g, v) => ({ ...g, exposure: v }) },
      { label: "金属っぽさ", hint: "0で塗装、1で鏡のよう", min: 0, max: 1, step: 0.005,
        get: (g) => g.metalness, set: (g, v) => ({ ...g, metalness: v }) },
      { label: "映り込み", hint: "まわりの景色", min: 0, max: 0.6, step: 0.005,
        get: (g) => g.env, set: (g, v) => ({ ...g, env: v }) },
      { label: "継ぎ目の暗さ", hint: "小さいほど暗い線", min: 0, max: 1, step: 0.01,
        get: (g) => g.seam, set: (g, v) => ({ ...g, seam: v }) },
    ],
  },
];

type W = { __heroSilver__?: (g: Silver) => void; __heroSilverLast__?: Silver };

/** 立体へ値を送る。立体がまだ読み込み中なら、読み込み後に立体の側が拾う */
function push(g: Silver) {
  const w = window as unknown as W;
  w.__heroSilverLast__ = g;
  w.__heroSilver__?.(g);
}

/** 既定値から変えたところだけを書き出す */
function diff(g: Tune) {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(DEFAULT) as (keyof Tune)[]) {
    if (JSON.stringify(g[k]) !== JSON.stringify(DEFAULT[k])) out[k] = g[k];
  }
  return out;
}

function SwatchRow({ s, g, onChange }: { s: Swatch; g: Tune; onChange: (g: Tune) => void }) {
  const hex = s.get(g);
  const [text, setText] = useState(hex);
  useEffect(() => setText(hex), [hex]);
  return (
    <label className="mb-1.5 flex items-center gap-2">
      <span className="flex-1">
        {s.label}
        <span className="ml-1 text-black/40">{s.hint}</span>
      </span>
      {/* 参考画像の色を貼り付けられるように、色の番号も直接打てる */}
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (isHex(e.target.value)) onChange(s.set(g, e.target.value.toLowerCase()));
        }}
        className="w-[5.5rem] rounded border border-black/15 bg-white px-1.5 py-1 font-mono text-[11px]"
        spellCheck={false}
      />
      <input
        type="color"
        value={hex}
        onChange={(e) => onChange(s.set(g, e.target.value))}
        className="h-7 w-7 cursor-pointer rounded border border-black/15 bg-transparent p-0"
      />
    </label>
  );
}

export function GrainTuner() {
  const [on, setOn] = useState(false);
  const [open, setOpen] = useState(true);
  const [g, setG] = useState<Tune>(DEFAULT);
  const [copied, setCopied] = useState(false);
  // スマホで文字のパネル（TextTuner）を開いている間は引っ込む
  const [textOpen, setTextOpen] = useState(false);
  useEffect(() => {
    const f = (e: Event) =>
      setTextOpen(!!(e as CustomEvent).detail?.open && matchMedia("(max-width: 767px)").matches);
    window.addEventListener("text-tuner", f);
    return () => window.removeEventListener("text-tuner", f);
  }, []);

  useEffect(() => {
    if (!new URLSearchParams(location.search).has("tune")) return;
    let saved: Tune = DEFAULT;
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) saved = { ...DEFAULT, ...JSON.parse(raw) };
    } catch {}
    setG(saved);
    setOn(true);
    push(saved);
    paint(saved.ground);
    applyMotion(saved);
  }, []);

  const update = (next: Tune) => {
    setG(next);
    push(next);
    paint(next.ground);
    applyMotion(next);
    try {
      localStorage.setItem(STORE, JSON.stringify(diff(next)));
    } catch {}
  };

  if (!on || textOpen) return null;

  const text = JSON.stringify(diff(g));

  return createPortal(
    <div
      className="fixed bottom-3 right-3 z-[100] w-[min(20rem,calc(100vw-1.5rem))]
                 rounded-lg bg-white/90 text-[12px] leading-[1.4] text-black
                 shadow-[0_2px_16px_rgba(0,0,0,0.15)] backdrop-blur"
    >
      <div className="flex items-center justify-between px-3 py-2">
        <span className="font-medium">見た目の調整</span>
        <button type="button" onClick={() => setOpen(!open)} className="px-2 py-1">
          {open ? "たたむ" : "ひらく"}
        </button>
      </div>
      {open && (
        <div className="max-h-[32svh] overflow-y-auto md:max-h-[60svh] px-3 pb-2">
          <fieldset className="mb-2">
            <legend className="mb-1 text-black/50">色</legend>
            {SWATCHES.map((sw) => (
              <SwatchRow key={sw.label} s={sw} g={g} onChange={update} />
            ))}
          </fieldset>
          {/* スマホで開いたときは、スマホの配置とカードのつまみを先に出す（探さずに済むように） */}
          {(matchMedia("(max-width: 767px)").matches
            ? [...GROUPS].sort(
                (a, b) => +b.title.includes("スマホ") - +a.title.includes("スマホ"),
              )
            : GROUPS
          ).map((grp) => (
            <fieldset key={grp.title} className="mb-2">
              <legend className="mb-1 text-black/50">{grp.title}</legend>
              {grp.knobs.map((k) => {
                const v = k.get(g);
                return (
                  <label key={k.label} className="mb-1.5 block">
                    <span className="flex justify-between">
                      <span>
                        {k.label}
                        {k.hint && <span className="ml-1 text-black/40">{k.hint}</span>}
                      </span>
                      <span className="tabular-nums">{+v.toFixed(3)}</span>
                    </span>
                    <input
                      type="range"
                      min={k.min}
                      max={k.max}
                      step={k.step}
                      value={v}
                      onChange={(e) => update(k.set(g, +e.target.value))}
                      className="w-full accent-black"
                    />
                  </label>
                );
              })}
            </fieldset>
          ))}
        </div>
      )}
      <div className="flex gap-2 border-t border-black/10 px-3 py-2">
        <button
          type="button"
          className="flex-1 rounded bg-black px-2 py-2 text-white"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            } catch {}
          }}
        >
          {copied ? "コピーしました" : "値をコピー"}
        </button>
        <button
          type="button"
          className="rounded border border-black/20 px-2 py-2"
          onClick={() => update(DEFAULT)}
        >
          最初の値に戻す
        </button>
      </div>
      {/* コピーが効かない環境のために、送る文字をそのまま見せておく */}
      <p className="break-all px-3 pb-2 font-mono text-[10px] text-black/50 select-all">
        {text === "{}" ? "（まだ何も変えていません）" : text}
      </p>
    </div>,
    document.body,
  );
}
