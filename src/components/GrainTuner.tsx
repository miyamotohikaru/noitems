"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { GRAIN, type Grain } from "@/lib/sykim/grain";

/**
 * 立体の質感を、その場で動かして確かめる調整パネル。
 * URL に ?tune を付けたときだけ出る（例: https://noitems01.vercel.app/?tune）。
 *
 * 使い方: つまみを動かす →「値をコピー」→ その文字をそのまま Claude に送る。
 * 送られた値を lib/sykim/grain.ts の GRAIN に書き写して確定する。
 * 動かした値はこのブラウザに覚えておくので、再読み込みしても消えない。
 */

const STORE = "noitems-grain-tune";

type Knob = {
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  get: (g: Grain) => number;
  set: (g: Grain, v: number) => Grain;
};

const gray = (v: number) => [v, v, +(v + 0.005).toFixed(3)];
const vec = (i: number) => ({
  get: (g: Grain) => g.keyDir[i],
  set: (g: Grain, v: number) => {
    const d = [...g.keyDir];
    d[i] = v;
    return { ...g, keyDir: d };
  },
});

const GROUPS: { title: string; knobs: Knob[] }[] = [
  {
    title: "色",
    knobs: [
      { label: "地の黒", hint: "暗い面の明るさ", min: 0, max: 0.4, step: 0.005,
        get: (g) => g.dark[0], set: (g, v) => ({ ...g, dark: gray(v) }) },
      { label: "白", hint: "光った所の明るさ", min: 0.4, max: 1, step: 0.005,
        get: (g) => g.light[0], set: (g, v) => ({ ...g, light: gray(v) }) },
    ],
  },
  {
    title: "ざらつき",
    knobs: [
      { label: "粒の量", hint: "0でなめらか、1で粒だけ", min: 0, max: 1, step: 0.01,
        get: (g) => g.smooth, set: (g, v) => ({ ...g, smooth: v }) },
      { label: "細かな揺れ", hint: "画素ごとのざらざら", min: 0, max: 0.1, step: 0.001,
        get: (g) => g.noise, set: (g, v) => ({ ...g, noise: v }) },
      { label: "粒の大きさ", hint: "画素数", min: 1, max: 4, step: 1,
        get: (g) => g.grainPx, set: (g, v) => ({ ...g, grainPx: v }) },
      { label: "明るい所の埋まり", hint: "1で白一色", min: 0.5, max: 1, step: 0.01,
        get: (g) => g.cap, set: (g, v) => ({ ...g, cap: v }) },
      { label: "暗い所の粒", hint: "暗い面に散らす白い点", min: 0, max: 0.3, step: 0.005,
        get: (g) => g.floor, set: (g, v) => ({ ...g, floor: v }) },
    ],
  },
  {
    title: "光沢",
    knobs: [
      { label: "照りの強さ", hint: "つるっとした照り返し", min: 0, max: 1.5, step: 0.01,
        get: (g) => g.spec, set: (g, v) => ({ ...g, spec: v }) },
      { label: "照りの鋭さ", hint: "大きいほど小さく鋭い", min: 2, max: 200, step: 1,
        get: (g) => g.shine, set: (g, v) => ({ ...g, shine: v }) },
    ],
  },
  {
    title: "光",
    knobs: [
      { label: "主光の強さ", hint: "", min: 0, max: 1.5, step: 0.01,
        get: (g) => g.key, set: (g, v) => ({ ...g, key: v }) },
      { label: "主光 左右", hint: "−左 ／ ＋右", min: -1, max: 1, step: 0.01, ...vec(0) },
      { label: "主光 上下", hint: "−下 ／ ＋上", min: -1, max: 1, step: 0.01, ...vec(1) },
      { label: "主光 前後", hint: "＋手前から", min: -1, max: 1, step: 0.01, ...vec(2) },
      { label: "補助光", hint: "左からの弱い光", min: 0, max: 0.6, step: 0.01,
        get: (g) => g.fill, set: (g, v) => ({ ...g, fill: v }) },
      { label: "縁の光", hint: "下側の輪郭の白", min: 0, max: 2.5, step: 0.01,
        get: (g) => g.rim, set: (g, v) => ({ ...g, rim: v }) },
      { label: "全体の底上げ", hint: "光の当たらない面", min: 0, max: 0.4, step: 0.005,
        get: (g) => g.ambient, set: (g, v) => ({ ...g, ambient: v }) },
    ],
  },
];

type W = { __heroGrain__?: (g: Grain) => void; __heroGrainLast__?: Grain };

/** 立体へ値を送る。立体がまだ読み込み中なら、読み込み後に立体の側が拾う */
function push(g: Grain) {
  const w = window as unknown as W;
  w.__heroGrainLast__ = g;
  w.__heroGrain__?.(g);
}

/** 既定値から変えたところだけを書き出す */
function diff(g: Grain) {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(GRAIN) as (keyof Grain)[]) {
    if (JSON.stringify(g[k]) !== JSON.stringify(GRAIN[k])) out[k] = g[k];
  }
  return out;
}

export function GrainTuner() {
  const [on, setOn] = useState(false);
  const [open, setOpen] = useState(true);
  const [g, setG] = useState<Grain>(GRAIN);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!new URLSearchParams(location.search).has("tune")) return;
    let saved: Grain = GRAIN;
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) saved = { ...GRAIN, ...JSON.parse(raw) };
    } catch {}
    setG(saved);
    setOn(true);
    push(saved);
  }, []);

  const update = (next: Grain) => {
    setG(next);
    push(next);
    try {
      localStorage.setItem(STORE, JSON.stringify(diff(next)));
    } catch {}
  };

  if (!on) return null;

  const text = JSON.stringify(diff(g));

  return createPortal(
    <div
      className="fixed bottom-3 right-3 z-[100] w-[min(20rem,calc(100vw-1.5rem))]
                 rounded-lg bg-white/90 text-[12px] leading-[1.4] text-black
                 shadow-[0_2px_16px_rgba(0,0,0,0.15)] backdrop-blur"
    >
      <div className="flex items-center justify-between px-3 py-2">
        <span className="font-medium">質感の調整</span>
        <button type="button" onClick={() => setOpen(!open)} className="px-2 py-1">
          {open ? "たたむ" : "ひらく"}
        </button>
      </div>
      {open && (
        <div className="max-h-[32svh] overflow-y-auto md:max-h-[60svh] px-3 pb-2">
          {GROUPS.map((grp) => (
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
          onClick={() => update(GRAIN)}
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
