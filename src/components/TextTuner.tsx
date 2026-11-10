"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * 配置と文字の手直しパネル（2026-11-10 ユーザー指定）。
 *   「文字の字間調整や、改行などの手直ししたい。あと配置も」
 *   「もっと動かしやすくしてほしい。形を変えるのところ構成とか写真の配置変えたい」
 * URL に ?tune を付けたときだけ、左下に「配置と文字を直す」のボタンが出る。
 *
 * 使い方:
 *   1.「選ぶ」を押してから、直したい文字や写真を押す（「ひとつ外側」でまとまりごと選べる）
 *   2. 選んだものは、ページの上でそのままつかんで動かせる。右下の四角をつかむと大きさが変わる。
 *      PC は矢印キーで 1px（Shift で 10px）ずつ動く
 *   3. 並びの中では「前へ」「後ろへ」で順番を、「隠す」で消したときの見え方を試せる
 *   4. 文字は字間・行間・大きさをつまみで、「改行・文字を直す」でその場で改行を打てる
 *   5.「値をコピー」→ その文字をそのまま Claude に送る（こちらでページに書き写して確定する）
 *
 * 値は PC（768px 以上）とスマホ（767px 以下）で別々に覚える。いま開いている幅のほうが変わる。
 * このブラウザに覚えておくので、再読み込みしても消えない。
 */

const STORE = "noitems-text-tune";
const PHONE = "(max-width: 767px)";

type Fix = {
  /** どれか（書き写すときの目印。元の文字の頭か、写真の説明） */
  label: string;
  size?: number;
  ls?: number;
  lh?: number;
  x?: number;
  y?: number;
  scale?: number;
  order?: number;
  hide?: boolean;
  text?: string;
};
type Store = { pc: Record<string, Fix>; sp: Record<string, Fix> };
const EMPTY: Store = { pc: {}, sp: {} };

const bp = () => (matchMedia(PHONE).matches ? "sp" : "pc") as "pc" | "sp";

/** body から順にたどった道筋。再読み込みしても同じものを指せる */
function pathOf(el: Element) {
  const seg: string[] = [];
  let n: Element | null = el;
  while (n && n !== document.body) {
    const tag = n.tagName.toLowerCase();
    let i = 1;
    for (let s = n.previousElementSibling; s; s = s.previousElementSibling)
      if (s.tagName === n.tagName) i++;
    seg.unshift(`${tag}:nth-of-type(${i})`);
    n = n.parentElement;
  }
  return "body > " + seg.join(" > ");
}

const ownText = (n: Element) =>
  [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent!.trim());

/** 押した所から、選ぶものを決める（文字ならそれを持つ要素、写真なら写真） */
function pickable(t: Element | null): HTMLElement | null {
  if (!t || t.closest("[data-text-tuner]")) return null;
  const img = t.closest("img,picture,video,svg");
  if (img instanceof HTMLElement) return img;
  for (let n: Element | null = t; n && n !== document.body; n = n.parentElement)
    if (n instanceof HTMLElement && ownText(n)) return n;
  return null;
}

const labelOf = (el: HTMLElement) =>
  (el.getAttribute("alt") || el.querySelector("img")?.getAttribute("alt") || el.innerText || el.tagName)
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 24);

/** 改行・文字を直したものだけ、元の中身を控えておく（戻すときに使う） */
const orig = new WeakMap<HTMLElement, string>();
const touched = new Set<HTMLElement>();

function clearOne(el: HTMLElement) {
  for (const k of ["fontSize", "letterSpacing", "lineHeight", "translate", "scale", "order", "display"] as const)
    el.style[k] = "";
  const html = orig.get(el);
  if (html !== undefined && el.innerHTML !== html) el.innerHTML = html;
  orig.delete(el);
}
function clearAll() {
  for (const el of touched) clearOne(el);
  touched.clear();
}

function applyOne(el: HTMLElement, f: Fix) {
  touched.add(el);
  if (f.text !== undefined && !orig.has(el)) orig.set(el, el.innerHTML);
  el.style.fontSize = f.size !== undefined ? `${f.size}px` : "";
  el.style.letterSpacing = f.ls !== undefined ? `${f.ls}em` : "";
  el.style.lineHeight = f.lh !== undefined ? String(f.lh) : "";
  el.style.translate = f.x || f.y ? `${f.x ?? 0}px ${f.y ?? 0}px` : "";
  el.style.scale = f.scale !== undefined && f.scale !== 1 ? String(f.scale) : "";
  el.style.order = f.order !== undefined ? String(f.order) : "";
  el.style.display = f.hide ? "none" : "";
  if (f.text !== undefined && el.innerText !== f.text) el.innerText = f.text;
}

function applyAll(s: Store) {
  clearAll();
  for (const [path, f] of Object.entries(s[bp()])) {
    const el = document.querySelector(path);
    if (el instanceof HTMLElement) applyOne(el, f);
  }
}

/** いまの文字の値（つまみの初期位置） */
function measure(el: HTMLElement) {
  const cs = getComputedStyle(el);
  const fs = parseFloat(cs.fontSize) || 16;
  const ls = cs.letterSpacing === "normal" ? 0 : (parseFloat(cs.letterSpacing) || 0) / fs;
  const lh = cs.lineHeight === "normal" ? 1.5 : (parseFloat(cs.lineHeight) || fs * 1.5) / fs;
  return { size: +fs.toFixed(2), ls: +ls.toFixed(3), lh: +lh.toFixed(2) };
}

/** 並びの中での順番（兄弟の中で何番目に見えているか） */
function siblingsOf(el: HTMLElement) {
  const p = el.parentElement;
  if (!p) return [];
  return [...p.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
}
/**
 * 並べ替える単位。選んだもの自身か、その外側で「同じ種類が並んでいる」所まで上がる
 * （写真を選んで「前へ」を押したら、写真と番号のひと組＝li ごと入れ替える）
 */
function rowItem(el: HTMLElement): HTMLElement | null {
  for (let n: HTMLElement | null = el; n && n.parentElement && n !== document.body; n = n.parentElement) {
    const same = siblingsOf(n).filter((c) => c.tagName === n!.tagName);
    if (same.length > 1) return n;
  }
  return null;
}
const orderOf = (el: HTMLElement, i: number) => {
  const o = parseInt(el.style.order || getComputedStyle(el).order, 10);
  return Number.isFinite(o) && o !== 0 ? o : i;
};

type Knob = { key: "size" | "ls" | "lh" | "scale"; label: string; hint: string; min: number; max: number; step: number };
const TEXT_KNOBS: Knob[] = [
  { key: "size", label: "文字の大きさ", hint: "px", min: 8, max: 120, step: 0.5 },
  { key: "ls", label: "字間", hint: "文字の大きさに対する割合", min: -0.1, max: 0.6, step: 0.005 },
  { key: "lh", label: "行間", hint: "文字の大きさに対する倍率", min: 0.8, max: 3, step: 0.01 },
];
const SCALE: Knob = { key: "scale", label: "拡大・縮小", hint: "1で元のまま。右下の四角をつかんでも変わる", min: 0.2, max: 3, step: 0.01 };

export function TextTuner() {
  const [on, setOn] = useState(false);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [store, setStore] = useState<Store>(EMPTY);
  const [sel, setSel] = useState<HTMLElement | null>(null);
  const [base, setBase] = useState({ size: 16, ls: 0, lh: 1.5 });
  const [copied, setCopied] = useState(false);
  const [box, setBox] = useState<DOMRect | null>(null);
  // 選んだものが画面の下半分にあるときは、パネルを上に寄せて隠さないようにする
  const [dockTop, setDockTop] = useState(false);
  const storeRef = useRef(store);
  storeRef.current = store;
  const selRef = useRef(sel);
  selRef.current = sel;

  const save = useCallback((s: Store) => {
    setStore(s);
    storeRef.current = s;
    try {
      localStorage.setItem(STORE, JSON.stringify(s));
    } catch {}
  }, []);

  /** 選んでいるものの値を書き換えて、すぐ当てる */
  const change = useCallback(
    (patch: Partial<Fix>) => {
      const el = selRef.current;
      if (!el) return;
      const b = bp();
      const s = storeRef.current;
      const path = pathOf(el);
      const cur = s[b][path];
      const next: Fix = { ...cur, label: cur?.label ?? labelOf(el), ...patch };
      applyOne(el, next);
      save({ ...s, [b]: { ...s[b], [path]: next } });
    },
    [save],
  );

  // 起動。覚えている値を当て、幅が PC/スマホをまたいだら当て直す
  useEffect(() => {
    if (!new URLSearchParams(location.search).has("tune")) return;
    let s = EMPTY;
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) s = { ...EMPTY, ...JSON.parse(raw) };
    } catch {}
    setStore(s);
    storeRef.current = s;
    setOn(true);
    // 本文の一部は読み込みのあとで組まれるので、少し遅れても当てる
    const run = () => applyAll(storeRef.current);
    const ids = [0, 600, 1800].map((ms) => window.setTimeout(run, ms));
    const mq = matchMedia(PHONE);
    const onBp = () => {
      setSel(null);
      window.setTimeout(run, 100);
    };
    mq.addEventListener("change", onBp);
    return () => {
      ids.forEach(clearTimeout);
      mq.removeEventListener("change", onBp);
    };
  }, []);

  // スマホは画面が狭いので、このパネルを開いている間は「見た目の調整」パネルを引っ込める（GrainTuner が聞く）
  useEffect(() => {
    if (!on) return;
    window.dispatchEvent(new CustomEvent("text-tuner", { detail: { open } }));
  }, [on, open]);

  const choose = useCallback((el: HTMLElement) => {
    setEditing(false);
    // 覚えている文字の値を一度外して、元の見た目を測る
    const keep = [el.style.fontSize, el.style.letterSpacing, el.style.lineHeight];
    el.style.fontSize = el.style.letterSpacing = el.style.lineHeight = "";
    setBase(measure(el));
    [el.style.fontSize, el.style.letterSpacing, el.style.lineHeight] = keep;
    const r = el.getBoundingClientRect();
    setDockTop(r.top + r.height / 2 > window.innerHeight / 2);
    setSel(el);
    setOpen(true);
  }, []);

  // 選ぶとき: ページを押すとそれを選ぶ（リンクやボタンは働かせない）
  useEffect(() => {
    if (!picking) return;
    let hover: HTMLElement | null = null;
    const over = (e: PointerEvent) => {
      if (hover) hover.style.outline = "";
      hover = pickable(e.target as Element);
      if (hover) hover.style.outline = "1px dashed rgba(200,40,40,.8)";
    };
    const click = (e: MouseEvent) => {
      const t = e.target as Element;
      if (t.closest("[data-text-tuner]")) return;
      e.preventDefault();
      e.stopPropagation();
      const el = pickable(t);
      if (!el) return;
      choose(el);
      setPicking(false);
    };
    document.addEventListener("pointerover", over, true);
    document.addEventListener("click", click, true);
    return () => {
      if (hover) hover.style.outline = "";
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("click", click, true);
    };
  }, [picking, choose]);

  // 選んでいるものの枠（ページの上に、動かすための枠と大きさの四角を重ねる）
  useEffect(() => {
    if (!sel) {
      setBox(null);
      return;
    }
    let raf = 0;
    const loop = () => {
      setBox(sel.isConnected && sel.style.display !== "none" ? sel.getBoundingClientRect() : null);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [sel]);

  // 改行・文字を直す: その文字の中で、じかに打てるようにする
  useEffect(() => {
    if (!sel || !editing) return;
    if (!orig.has(sel)) orig.set(sel, sel.innerHTML);
    sel.setAttribute("contenteditable", "true");
    sel.focus();
    // Enter は段落を作らず、改行だけを入れる
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      document.execCommand("insertLineBreak");
    };
    sel.addEventListener("keydown", key);
    return () => {
      sel.removeEventListener("keydown", key);
      sel.removeAttribute("contenteditable");
    };
  }, [sel, editing]);

  // 矢印キーで少しずつ動かす（PC）
  useEffect(() => {
    if (!sel || editing) return;
    const key = (e: KeyboardEvent) => {
      const d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[e.key];
      if (!d) return;
      const t = e.target as Element;
      if (t.closest?.("input,textarea,[contenteditable]")) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const f = storeRef.current[bp()][pathOf(sel)];
      change({ x: (f?.x ?? 0) + d[0] * step, y: (f?.y ?? 0) + d[1] * step });
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [sel, editing, change]);

  /** 枠をつかんで動かす・四角をつかんで大きさを変える */
  const grab = (mode: "move" | "size") => (e: React.PointerEvent) => {
    const el = selRef.current;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    const f = storeRef.current[bp()][pathOf(el)];
    const x0 = f?.x ?? 0;
    const y0 = f?.y ?? 0;
    const s0 = f?.scale ?? 1;
    const w0 = el.getBoundingClientRect().width || 1;
    const sx = e.clientX;
    const sy = e.clientY;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (mode === "move") change({ x: Math.round(x0 + dx), y: Math.round(y0 + dy) });
      else change({ scale: +Math.max(0.1, s0 * (1 + dx / w0)).toFixed(3) });
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  /** 並びの中で前へ・後ろへ（flex の order を振り直す） */
  const shift = (dir: -1 | 1) => {
    const el = selRef.current && rowItem(selRef.current);
    if (!el) return;
    const sibs = siblingsOf(el)
      .map((n, i) => ({ n, o: orderOf(n, i) }))
      .sort((a, b) => a.o - b.o)
      .map((a) => a.n);
    const i = sibs.indexOf(el);
    const j = i + dir;
    if (j < 0 || j >= sibs.length) return;
    [sibs[i], sibs[j]] = [sibs[j], sibs[i]];
    // 兄弟みんなに 1, 2, 3… を振り直して覚える
    const b = bp();
    const s = storeRef.current;
    const map = { ...s[b] };
    sibs.forEach((n, k) => {
      const p = pathOf(n);
      const next: Fix = { ...map[p], label: map[p]?.label ?? labelOf(n), order: k + 1 };
      map[p] = next;
      applyOne(n, next);
    });
    save({ ...s, [b]: map });
  };

  const resetSel = () => {
    const el = selRef.current;
    if (!el) return;
    const b = bp();
    const rest = { ...storeRef.current[b] };
    delete rest[pathOf(el)];
    const next = { ...storeRef.current, [b]: rest };
    save(next);
    setEditing(false);
    applyAll(next);
  };

  /** 隠したものを戻す（隠すと押せなくなるので、一覧から戻す） */
  const unhide = (path: string) => {
    const b = bp();
    const s = storeRef.current;
    const f = { ...s[b][path], hide: false };
    const el = document.querySelector(path);
    if (el instanceof HTMLElement) applyOne(el, f);
    save({ ...s, [b]: { ...s[b], [path]: f } });
  };

  if (!on) return null;

  const out = JSON.stringify(store);
  const count = Object.keys(store.pc).length + Object.keys(store.sp).length;
  const where = bp() === "sp" ? "スマホ" : "PC";
  const fix: Fix | undefined = sel ? store[bp()][pathOf(sel)] : undefined;
  const isText = !!sel && ownText(sel);
  const inRow = !!sel && !!rowItem(sel);
  const hidden = Object.entries(store[bp()]).filter(([, f]) => f.hide);

  const overlay =
    sel && box && !picking && !editing ? (
      <>
        {/* 選んでいるものの上に重ねる枠。つかんで動かす */}
        <div
          data-text-tuner
          onPointerDown={grab("move")}
          className="fixed z-[100] cursor-move border border-[#c82828] bg-[#c82828]/5"
          style={{ left: box.left, top: box.top, width: box.width, height: box.height, touchAction: "none" }}
        />
        {/* 右下の四角。つかんで横に引くと大きさが変わる */}
        <div
          data-text-tuner
          onPointerDown={grab("size")}
          className="fixed z-[100] h-6 w-6 cursor-nwse-resize rounded-sm border-2 border-white bg-[#c82828] shadow"
          style={{ left: box.right - 12, top: box.bottom - 12, touchAction: "none" }}
        />
      </>
    ) : null;

  // 閉じているとき（スマホは画面の上、PC は左下に小さく）
  if (!open)
    return createPortal(
      <button
        type="button"
        data-text-tuner
        onClick={() => setOpen(true)}
        className="fixed left-3 top-[calc(var(--nav-h,4rem)+0.5rem)] z-[101] rounded-full bg-white/90 px-3 py-2
                   text-[12px] text-black shadow-[0_2px_16px_rgba(0,0,0,0.15)] backdrop-blur md:top-auto md:bottom-3"
        style={{ letterSpacing: 0 }}
      >
        配置と文字を直す{count > 0 && <span className="ml-1 text-black/50">（{count}か所）</span>}
      </button>,
      document.body,
    );

  // 選んでいるあいだは、ページが見えるように細い帯だけにする
  if (picking)
    return createPortal(
      <div
        data-text-tuner
        className="fixed inset-x-3 bottom-3 z-[101] flex items-center gap-2 rounded-lg bg-[#c82828] px-3 py-2
                   text-[12px] text-white shadow-[0_2px_16px_rgba(0,0,0,0.15)] md:right-auto md:w-[20rem]"
        style={{ letterSpacing: 0 }}
      >
        <span className="flex-1">直したい文字か写真を押してください</span>
        <button type="button" className="rounded border border-white/60 px-2 py-1" onClick={() => setPicking(false)}>
          やめる
        </button>
      </div>,
      document.body,
    );

  const btn = "rounded border border-black/20 px-2 py-2 disabled:opacity-30";

  return createPortal(
    <>
      {overlay}
      <div
        data-text-tuner
        className={`fixed left-3 z-[101] w-[min(20rem,calc(100vw-1.5rem))]
                    rounded-lg bg-white/90 text-[12px] leading-[1.4] text-black
                    shadow-[0_2px_16px_rgba(0,0,0,0.15)] backdrop-blur ${
                      dockTop ? "top-[calc(var(--nav-h,4rem)+0.5rem)]" : "bottom-3"
                    }`}
        style={{ letterSpacing: 0 }}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <span className="font-medium">
            配置と文字<span className="ml-1 font-normal text-black/50">（{where}の値）</span>
          </span>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setSel(null);
              setEditing(false);
            }}
            className="px-2 py-1"
          >
            とじる
          </button>
        </div>
        <div className="max-h-[30svh] overflow-y-auto px-3 pb-2 md:max-h-[60svh]">
          <div className="mb-2 flex gap-2">
            <button
              type="button"
              className="flex-1 rounded bg-[#c82828] px-2 py-2 text-white"
              onClick={() => {
                setEditing(false);
                setPicking(true);
              }}
            >
              {sel ? "別のものを選ぶ" : "選ぶ"}
            </button>
            {sel?.parentElement && sel.parentElement !== document.body && (
              <button type="button" className={btn} onClick={() => choose(sel.parentElement!)}>
                ひとつ外側
              </button>
            )}
          </div>
          {!sel && (
            <p className="mb-2 text-black/50">
              選んだものは、ページの上でそのままつかんで動かせます。
              右下の赤い四角をつかんで横に引くと、大きさが変わります。
            </p>
          )}
          {sel && (
            <>
              <p className="mb-2 line-clamp-2 text-black/60">「{fix?.label ?? labelOf(sel)}」</p>
              <div className="mb-2 grid grid-cols-3 gap-2">
                <button type="button" className={btn} disabled={!inRow} onClick={() => shift(-1)}>
                  ← 前へ
                </button>
                <button type="button" className={btn} disabled={!inRow} onClick={() => shift(1)}>
                  後ろへ →
                </button>
                <button
                  type="button"
                  className={btn}
                  onClick={() => {
                    change({ hide: true });
                    setSel(null);
                  }}
                >
                  隠す
                </button>
              </div>
              <p className="mb-2 text-black/50">
                位置 {fix?.x ?? 0}, {fix?.y ?? 0} px
                <span className="hidden md:inline">（矢印キーで1px、Shiftで10px）</span>
              </p>
              {[SCALE, ...(isText ? TEXT_KNOBS : [])].map((k) => {
                const v = fix?.[k.key] ?? (k.key === "scale" ? 1 : base[k.key]);
                return (
                  <label key={k.key} className="mb-1.5 block">
                    <span className="flex justify-between">
                      <span>
                        {k.label}
                        <span className="ml-1 text-black/40">{k.hint}</span>
                      </span>
                      <span className="tabular-nums">{+(+v).toFixed(3)}</span>
                    </span>
                    <input
                      type="range"
                      min={k.min}
                      max={k.max}
                      step={k.step}
                      value={v}
                      onChange={(e) => change({ [k.key]: +e.target.value })}
                      className="w-full accent-black"
                    />
                  </label>
                );
              })}
              <div className="mb-1 flex gap-2">
                {isText && (
                  <button
                    type="button"
                    className={`flex-1 rounded px-2 py-2 ${editing ? "bg-black text-white" : "border border-black/20"}`}
                    onClick={() => {
                      if (editing) change({ text: sel.innerText.replace(/\n+$/, "") });
                      setEditing(!editing);
                    }}
                  >
                    {editing ? "直し終わった" : "改行・文字を直す"}
                  </button>
                )}
                <button type="button" className={`${btn} ${isText ? "" : "flex-1"}`} onClick={resetSel}>
                  これを元に戻す
                </button>
              </div>
              {editing && (
                <p className="mb-1 text-black/50">
                  ページの文字を直接押して、改行（Enter）を足したり消したりしてください。
                  終わったら「直し終わった」を押します。
                </p>
              )}
            </>
          )}
          {hidden.length > 0 && (
            <div className="mt-2 border-t border-black/10 pt-2">
              <p className="mb-1 text-black/50">隠しているもの</p>
              {hidden.map(([p, f]) => (
                <div key={p} className="mb-1 flex items-center gap-2">
                  <span className="flex-1 truncate">{f.label}</span>
                  <button type="button" className="rounded border border-black/20 px-2 py-1" onClick={() => unhide(p)}>
                    戻す
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2 border-t border-black/10 px-3 py-2">
          <button
            type="button"
            className="flex-1 rounded bg-black px-2 py-2 text-white"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(out);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              } catch {}
            }}
          >
            {copied ? "コピーしました" : `値をコピー（${count}か所）`}
          </button>
          <button
            type="button"
            className={btn}
            onClick={() => {
              save(EMPTY);
              setSel(null);
              setEditing(false);
              applyAll(EMPTY);
            }}
          >
            全部戻す
          </button>
        </div>
        <p className="hidden max-h-20 overflow-y-auto break-all px-3 pb-2 font-mono text-[10px] text-black/50 select-all md:block">
          {count === 0 ? "（まだ何も変えていません）" : out}
        </p>
      </div>
    </>,
    document.body,
  );
}
