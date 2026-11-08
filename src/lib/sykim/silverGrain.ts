import type * as THREE_T from "three";

/**
 * 銀色の金属（look.ts）に、細かな粒を重ねる（2026-11-08 ユーザー指定）。
 *
 * 「最初の銀色がいちばん近い。そこに少し粒子を入れたい」という指示で、
 * 黒い粒子の素材（grain.ts）から銀色へ戻した。
 * 粒は画面の画素ごとに、色を作り終えた最後に足す（立体が回っても粒は画面に張り付いたまま）。
 *
 * 値は調整パネル（URL に ?tune）で動かせる。ユーザーから送られた値をここに書き写して確定する。
 */
export const SILVER = {
  /** 本体の色（画面の色。#rrggbb） */
  base: "#9d9ea7",
  /** 継ぎ目の暗さ（本体の色に掛ける） */
  seam: 0.55,
  /** 金属っぽさ。0 で塗装、1 で鏡のような金属 */
  metalness: 0.775,
  /** 全体の明るさ（露出。2 の何乗か） */
  exposure: -1.475,
  /** まわりの景色の映り込み */
  env: 0.14,
  /** 粒の濃さ（画素ごとの明るさの揺れ） */
  noise: 0.015,
  /** 白い粒の量 */
  dots: 0.05,
  /** 白い粒が出はじめる明るさ（0〜1。小さいほど暗い所にも出る） */
  dotsFrom: 0.45,
  /** 黒い粒の量（影に散らす） */
  darkDots: 0.0,
  /** 粒の大きさ（画面の画素数） */
  grainPx: 1,
  /** 銀色に元から入っているラメ（金属の粒）の量。1 で元のまま、0 で無し */
  flake: 0.5,
  /** 表面の細かな凹凸。1 で元のまま、0 でつるつる */
  bump: 0.6,
  /** 光り方のムラ（場所ごとの粗さの違い）。1 で元のまま、0 で均一 */
  mottle: 0.6,
};

// look.ts（元の銀色）の値。ラメと凹凸はこれに掛けて弱める
const FLAKE_MIN = 0.74;
const FLAKE_MUL = 4;
const FLAKE_BUMP = 0.35;
const BUMP_STR = 0.18917 * 0.02;
const MICRO = 0.29;

export type Silver = typeof SILVER;

/** 粒の値はすべての素材で同じものを指す。1 か所を書き換えれば全部に効く */
export function makeGrainUniforms(s: Silver = SILVER) {
  const u = {
    uNoise: { value: s.noise },
    uDots: { value: s.dots },
    uDotsFrom: { value: s.dotsFrom },
    uDarkDots: { value: s.darkDots },
    uGrainPx: { value: s.grainPx },
    // 以下は look.ts の同じ名前の値を上書きする（ラメと凹凸の強さ）
    uFlakeMin: { value: 0 },
    uFlakeMul: { value: 0 },
    uFlakeBump: { value: 0 },
    uBumpStr: { value: 0 },
    uMicro: { value: 0 },
    uRN: { value: 0 },
  };
  setFlakeBump(u, s);
  return u;
}

function setFlakeBump(u: GrainUniforms, s: Silver) {
  const a = Math.min(1, Math.max(0, s.flake));
  // 0 に近づくほど、粒になるセルが減り、明るさと向きの散らばりも弱まる
  u.uFlakeMin.value = FLAKE_MIN + (0.999 - FLAKE_MIN) * (1 - a);
  u.uFlakeMul.value = 1 + (FLAKE_MUL - 1) * a;
  u.uFlakeBump.value = FLAKE_BUMP * a;
  u.uBumpStr.value = BUMP_STR * s.bump;
  u.uMicro.value = MICRO * s.bump;
  u.uRN.value = s.mottle;
}
export type GrainUniforms = {
  [K in "uNoise" | "uDots" | "uDotsFrom" | "uDarkDots" | "uGrainPx" | "uFlakeMin"
    | "uFlakeMul" | "uFlakeBump" | "uBumpStr" | "uMicro" | "uRN"]: { value: number };
};

/** 素材に粒を足す。applyLook のあとに呼ぶ（元の書き換えはそのまま生かす） */
export function addGrain(mat: THREE_T.Material, u: GrainUniforms) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    // applyLook が作った値を、共有の値で差し替える（パネルから動かせるように）
    Object.assign(sh.uniforms, u);
    sh.fragmentShader =
      /* glsl */ `
      uniform float uNoise, uDots, uDotsFrom, uDarkDots, uGrainPx;
      // 画素ごとの乱数。粗い式だと粒が格子状に並んで見えるので、偏りの少ない式を使う
      float grainHash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
    ` +
      sh.fragmentShader.replace(
        "#include <dithering_fragment>",
        /* glsl */ `
        {
          vec2 cell = floor(gl_FragCoord.xy / uGrainPx);
          vec3 c = gl_FragColor.rgb;
          float lum = dot(c, vec3(0.299, 0.587, 0.114));
          // 明るい所ほど白い粒が増える（点描のように）
          float w = smoothstep(uDotsFrom, 1.0, lum) * uDots;
          // step() だと乱数がちょうど 0 の画素で量 0 でも点が出るので、< で比べる
          c = mix(c, vec3(1.0), float(grainHash(cell) < w) * 0.85);
          // 暗い所ほど黒い粒が増える
          float b = (1.0 - smoothstep(0.0, uDotsFrom, lum)) * uDarkDots;
          c = mix(c, vec3(0.0), float(grainHash(cell + 17.7) < b) * 0.85);
          // 全体の細かなざらつき
          c += (grainHash(cell + 71.3) - 0.5) * uNoise * 2.0;
          gl_FragColor.rgb = clamp(c, 0.0, 1.0);
        }
        #include <dithering_fragment>
      `,
      );
  };
  mat.needsUpdate = true;
}

/** 調整パネルから来た値を当てる */
export function setSilver(
  s: Silver,
  t: {
    body: THREE_T.MeshStandardMaterial;
    seams: THREE_T.MeshStandardMaterial[];
    u: GrainUniforms;
    renderer: THREE_T.WebGLRenderer;
    scene: THREE_T.Scene;
  },
) {
  t.body.color.set(s.base);
  t.body.metalness = s.metalness;
  for (const m of t.seams) {
    m.color.copy(t.body.color).multiplyScalar(s.seam);
    m.metalness = s.metalness;
  }
  t.renderer.toneMappingExposure = Math.pow(2, s.exposure);
  t.scene.environmentIntensity = s.env;
  t.u.uNoise.value = s.noise;
  t.u.uDots.value = s.dots;
  t.u.uDotsFrom.value = s.dotsFrom;
  t.u.uDarkDots.value = s.darkDots;
  t.u.uGrainPx.value = s.grainPx;
  setFlakeBump(t.u, s);
}
