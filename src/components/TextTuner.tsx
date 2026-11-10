"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * 文字の手直しパネル（2026-11-10 ユーザー指定「文字の字間調整や、改行などの手直ししたい。あと配置も」）。
 * URL に ?tune を付けたときだけ、左下に「文字」のボタンが出る。
 *
 * 使い方:
 *   1.「文字」→「文字を選ぶ」を押してから、直したい文字を押す
 *   2. 大きさ・字間・行間・横と縦の位置をつまみで動かす。
 *      「改行・文字を直す」を押すと、その文字の中で直接改行を足したり消したりできる
 *   3.「値をコピー」→ その文字をそのまま Claude に送る（こちらでページに書き写して確定する）
 *
 * 値は PC（768px 以上）とスマホ（767px 以下）で別々に覚える。いま開いている幅のほうが変わる。
 * このブラウザに覚えておくので、再読み込みしても消えない。
 */

const STORE = "noitems-text-tune";
const PHONE = "(max-width: 767px)";

type Fix = {
  /** どの文字か（書き写すときの目印。元の文字の頭） */
  label: string;
  size?: number;
  ls?: number;
  lh?: number;
  x?: number;
  y?: number;
  text?: string;
};
type Store = { pc: Record<string, Fix>; sp: Record<string, Fix> };
const EMPTY: Store = { pc: {}, sp: {} };

const bp = () => (matchMedia(PHONE).matches ? "sp" : "pc") as "pc" | "sp";

/** body から順にたどった道筋。再読み込みしても同じ文字を指せる */
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

/** 押した所から、文字をじかに持っている要素を探す */
function textBlock(t: Element | null): HTMLElement | null {
  for (let n = t; n && n !== document.body; n = n.parentElement) {
    if (!(n instanceof HTMLElement)) continue;
    if (n.closest("[data-text-tuner]")) return null;
    for (const c of n.childNodes)
      if (c.nodeType === 3 && c.textContent!.trim()) return n;
  }
  return null;
}

const orig = new WeakMap<HTMLElement, string>();
const touched = new Set<HTMLElement>();

function clearAll() {
  for (const el of touched) {
    el.style.fontSize = "";
    el.style.letterSpacing = "";
    el.style.lineHeight = "";
    el.style.translate = "";
    const html = orig.get(el);
    if (html !== undefined && el.innerHTML !== html) el.innerHTML = html;
  }
  touched.clear();
}

function applyOne(el: HTMLElement, f: Fix) {
  touched.add(el);
  if (!orig.has(el)) orig.set(el, el.innerHTML);
  el.style.fontSize = f.size !== undefined ? `${f.size}px` : "";
  el.style.letterSpacing = f.ls !== undefined ? `${f.ls}em` : "";
  el.style.lineHeight = f.lh !== undefined ? String(f.lh) : "";
  el.style.translate = f.x || f.y ? `${f.x ?? 0}px ${f.y ?? 0}px` : "";
  if (f.text !== undefined && el.innerText !== f.text) el.innerText = f.text;
}

function applyAll(s: Store) {
  clearAll();
  for (const [path, f] of Object.entries(s[bp()])) {
    const el = document.querySelector(path);
    if (el instanceof HTMLElement) applyOne(el, f);
  }
}

/** いまの見た目の値（つまみの初期位置） */
function measure(el: HTMLElement) {
  const cs = getComputedStyle(el);
  const fs = parseFloat(cs.fontSize) || 16;
  const ls = cs.letterSpacing === "normal" ? 0 : (parseFloat(cs.letterSpacing) || 0) / fs;
  const lh = cs.lineHeight === "normal" ? 1.5 : (parseFloat(cs.lineHeight) || fs * 1.5) / fs;
  return { size: +fs.toFixed(2), ls: +ls.toFixed(3), lh: +lh.toFixed(2) };
}

type Knob = { key: "size" | "ls" | "lh" | "x" | "y"; label: string; hint: string; min: number; max: number; step: number };
const KNOBS: Knob[] = [
  { key: "size", label: "大きさ", hint: "px", min: 8, max: 120, step: 0.5 },
  { key: "ls", label: "字間", hint: "文字の大きさに対する割合", min: -0.1, max: 0.6, step: 0.005 },
  { key: "lh", label: "行間", hint: "文字の大きさに対する倍率", min: 0.8, max: 3, step: 0.01 },
  { key: "x", label: "横の位置", hint: "px。右が＋", min: -400, max: 400, step: 1 },
  { key: "y", label: "縦の位置", hint: "px。下が＋", min: -400, max: 400, step: 1 },
];

export function TextTuner() {
  const [on, setOn] = useState(false);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [store, setStore] = useState<Store>(EMPTY);
  const [sel, setSel] = useState<HTMLElement | null>(null);
  const [base, setBase] = useState({ size: 16, ls: 0, lh: 1.5 });
  const [copied, setCopied] = useState(false);
  const [, setTick] = useState(0);
  const storeRef = useRef(store);
  storeRef.current = store;

  const save = useCallback((s: Store) => {
    setStore(s);
    try {
      localStorage.setItem(STORE, JSON.stringify(s));
    } catch {}
  }, []);

  // 起動。覚えている値を当て、幅が PC/スマホをまたいだら当て直す
  useEffect(() => {
    if (!new URLSearchParams(location.search).has("tune")) return;
    let s = EMPTY;
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) s = { ...EMPTY, ...JSON.parse(raw) };
    } catch {}
    setStore(s);
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

  // スマホは画面が狭いので、文字のパネルを開いている間は「見た目の調整」パネルを引っ込める（GrainTuner が聞く）
  useEffect(() => {
    if (!on) return;
    window.dispatchEvent(new CustomEvent("text-tuner", { detail: { open } }));
  }, [on, open]);

  // 選ぶとき: ページの文字を押すとそれを選ぶ（リンクやボタンは働かせない）
  useEffect(() => {
    if (!picking) return;
    const over = (e: PointerEvent) => {
      const el = textBlock(e.target as Element);
      document.querySelectorAll("[data-text-hover]").forEach((n) => {
        (n as HTMLElement).style.outline = "";
        n.removeAttribute("data-text-hover");
      });
      if (el) {
        el.style.outline = "1px dashed rgba(0,0,0,.5)";
        el.setAttribute("data-text-hover", "");
      }
    };
    const click = (e: MouseEvent) => {
      const t = e.target as Element;
      if (t.closest("[data-text-tuner]")) return;
      e.preventDefault();
      e.stopPropagation();
      const el = textBlock(t);
      if (!el) return;
      choose(el);
      setPicking(false);
    };
    document.addEventListener("pointerover", over, true);
    document.addEventListener("click", click, true);
    return () => {
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("click", click, true);
      document.querySelectorAll("[data-text-hover]").forEach((n) => {
        (n as HTMLElement).style.outline = "";
        n.removeAttribute("data-text-hover");
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking]);

  // 選んでいる文字に印をつける
  useEffect(() => {
    if (!sel) return;
    sel.style.outline = "1px solid rgba(200,40,40,.7)";
    sel.style.outlineOffset = "2px";
    return () => {
      sel.style.outline = "";
      sel.style.outlineOffset = "";
    };
  }, [sel]);

  // 改行・文字を直す: その文字の中で、じかに打てるようにする
  useEffect(() => {
    if (!sel || !editing) return;
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

  const path = sel ? pathOf(sel) : "";
  const fix: Fix | undefined = sel ? store[bp()][path] : undefined;

  const choose = (el: HTMLElement) => {
    setEditing(false);
    // 覚えている値を一度外して、元の見た目を測る
    const p = pathOf(el);
    const had = storeRef.current[bp()][p];
    if (had) {
      el.style.fontSize = el.style.letterSpacing = el.style.lineHeight = "";
    }
    setBase(measure(el));
    if (had) applyOne(el, had);
    setSel(el);
    setOpen(true);
  };

  const change = (patch: Partial<Fix>) => {
    if (!sel) return;
    const b = bp();
    const label = fix?.label ?? sel.innerText.trim().slice(0, 24);
    const next: Fix = { ...fix, label, ...patch };
    applyOne(sel, next);
    save({ ...store, [b]: { ...store[b], [path]: next } });
  };

  const resetSel = () => {
    if (!sel) return;
    const b = bp();
    const rest = { ...store[b] };
    delete rest[path];
    const next = { ...store, [b]: rest };
    save(next);
    setEditing(false);
    applyAll(next);
    setTick((t) => t + 1);
  };

  if (!on) return null;

  const out = JSON.stringify(store);
  const count = Object.keys(store.pc).length + Object.keys(store.sp).length;
  const where = bp() === "sp" ? "スマホ" : "PC";

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
        文字を直す{count > 0 && <span className="ml-1 text-black/50">（{count}か所）</span>}
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
        <span className="flex-1">直したい文字を押してください</span>
        <button type="button" className="rounded border border-white/60 px-2 py-1" onClick={() => setPicking(false)}>
          やめる
        </button>
      </div>,
      document.body,
    );

  return createPortal(
    <div
      data-text-tuner
      className="fixed bottom-3 left-3 z-[101] w-[min(20rem,calc(100vw-1.5rem))]
                 rounded-lg bg-white/90 text-[12px] leading-[1.4] text-black
                 shadow-[0_2px_16px_rgba(0,0,0,0.15)] backdrop-blur"
      style={{ letterSpacing: 0 }}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="font-medium">
          文字<span className="ml-1 font-normal text-black/50">（{where}の値を直しています）</span>
        </span>
        <button type="button" onClick={() => setOpen(!open)} className="px-2 py-1">
          とじる
        </button>
      </div>
      {open && (
        <div className="max-h-[30svh] overflow-y-auto px-3 pb-2 md:max-h-[60svh]">
          <div className="mb-2 flex gap-2">
            <button
              type="button"
              className={`flex-1 rounded px-2 py-2 ${picking ? "bg-[#c82828] text-white" : "border border-black/20"}`}
              onClick={() => setPicking(!picking)}
            >
              {sel ? "別の文字を選ぶ" : "文字を選ぶ"}
            </button>
            {sel?.parentElement && sel.parentElement !== document.body && (
              <button
                type="button"
                className="rounded border border-black/20 px-2 py-2"
                onClick={() => choose(sel.parentElement!)}
              >
                ひとつ外側
              </button>
            )}
          </div>
          {sel && (
            <>
              <p className="mb-2 line-clamp-2 text-black/60">「{(fix?.label ?? sel.innerText).trim().slice(0, 40)}」</p>
              {KNOBS.map((k) => {
                const v = fix?.[k.key] ?? (k.key === "x" || k.key === "y" ? 0 : base[k.key]);
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
                <button type="button" className="rounded border border-black/20 px-2 py-2" onClick={resetSel}>
                  この文字を戻す
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
        </div>
      )}
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
          className="rounded border border-black/20 px-2 py-2"
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
      {open && (
        <p className="hidden max-h-20 overflow-y-auto break-all px-3 pb-2 font-mono text-[10px] text-black/50 select-all md:block">
          {count === 0 ? "（まだ何も変えていません）" : out}
        </p>
      )}
    </div>,
    document.body,
  );
}
