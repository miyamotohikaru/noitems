import type * as THREE_T from "three";

/**
 * 銀色の金属（look.ts）に、細かな粒を重ねる（2026-11-08 ユーザー指定）。
 *
 * 「最初の銀色がいちばん近い。そこに少し粒子を入れたい」という指示で、
 * 黒い粒子の素材（grain.ts）から銀色へ戻した。
 * 粒は画面の画素ごとに、色を作り終えた最後に足す（立体が回っても粒は画面に張り付いたまま）。
 *
 * 値は調整パネル（URL に ?tune）で動かせる。ユーザーから送られた値をここに書き写して確定する。
 * 今の値は 2026-11-08 にユーザーがパネルで決めたもの。
 */
export const SILVER = {
  /** 本体の色（画面の色。#rrggbb） */
  base: "#9d9ea7",
  /** 継ぎ目の暗さ（本体の色に掛ける） */
  seam: 0.5,
  /** 金属っぽさ。0 で塗装、1 で鏡のような金属 */
  metalness: 0.76,
  /** 全体の明るさ（露出。2 の何乗か） */
  exposure: -1.475,
  /** まわりの景色の映り込み */
  env: 0.18,
  /** 粒の濃さ（画素ごとの明るさの揺れ） */
  noise: 0,
  /** 白い粒の量 */
  dots: 0,
  /** 白い粒が出はじめる明るさ（0〜1。小さいほど暗い所にも出る） */
  dotsFrom: 1,
  /** 黒い粒の量（影に散らす） */
  darkDots: 0.0,
  /** 粒の大きさ（画面の画素数） */
  grainPx: 1,
  /** 銀色に元から入っているラメ（金属の粒）の量。1 で元のまま、0 で無し */
  flake: 0.06,
  /** 表面の細かな凹凸。1 で元のまま、0 でつるつる */
  bump: 0.39,
  /** 光り方のムラ（場所ごとの粗さの違い）。1 で元のまま、0 で均一 */
  mottle: 0.51,

  // ── 引き（スクロールで立体が縮んだとき）の値。
  // 縮むとラメや凹凸が画面の1点より小さくなって均され、つるつるのCGに見える。
  // 縮み具合に合わせて、上の値からここの値へ少しずつ移す。
  // 粒の大きさは縮んだ分だけ自動で大きくする（画面で見た大きさを保つ）
  /** 引きのラメの量 */
  farFlake: 0.6,
  /** 引きのラメの大きさ（1 で近くと同じ。大きいほど粗い粒） */
  farFlakeSize: 1.5,
  /** 引きの表面の凹凸 */
  farBump: 0.8,
  /** 引きの凹凸の大きさ */
  farBumpSize: 1.5,
  /** 引きの光り方のムラ */
  farMottle: 0.4,
  /** 引きのざらつき */
  farNoise: 0.01,
  /** 引きの白い粒の量 */
  farDots: 0.01,
  /** 引きの継ぎ目の暗さ（縮むと継ぎ目が白い線として浮くので、暗めにする） */
  farSeam: 0.3,
  /** 引きの明るさ（近くとの差） */
  farExposure: 0,
  /** ラメと凹凸の粗さの上限（近くの何倍まで粗くしてよいか）。大きすぎると粒が目立って嫌な感じになる */
  farSizeMax: 2.6,
};

// look.ts（元の銀色）の値。ラメと凹凸はこれに掛けて弱める
const FLAKE_MIN = 0.74;
const FLAKE_MUL = 4;
const FLAKE_BUMP = 0.35;
const BUMP_STR = 0.18917 * 0.02;
const MICRO = 0.29;
const FLAKE_SCALE = 5;
const BUMP_SCALE = 3.2 * 3.3;
const ROUGH_SCALE = 8.0 * 0.45;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 縮み具合 f（0=近く、1=いちばん引き）で、近くの値と引きの値を混ぜる */
function atZoom(s: Silver, f: number) {
  return {
    flake: lerp(s.flake, s.farFlake, f),
    flakeSize: lerp(1, s.farFlakeSize, f),
    bump: lerp(s.bump, s.farBump, f),
    bumpSize: lerp(1, s.farBumpSize, f),
    mottle: lerp(s.mottle, s.farMottle, f),
    noise: lerp(s.noise, s.farNoise, f),
    dots: lerp(s.dots, s.farDots, f),
    seam: lerp(s.seam, s.farSeam, f),
    exposure: s.exposure + s.farExposure * f,
  };
}

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
    uFlakeScale: { value: FLAKE_SCALE },
    uBumpScale: { value: BUMP_SCALE },
    uRoughScale: { value: ROUGH_SCALE },
  };
  setFlakeBump(u, atZoom(s, 0));
  return u;
}

function setFlakeBump(u: GrainUniforms, s: ReturnType<typeof atZoom>) {
  const a = Math.min(1, Math.max(0, s.flake));
  // 0 に近づくほど、粒になるセルが減り、明るさと向きの散らばりも弱まる
  u.uFlakeMin.value = FLAKE_MIN + (0.999 - FLAKE_MIN) * (1 - a);
  u.uFlakeMul.value = 1 + (FLAKE_MUL - 1) * a;
  u.uFlakeBump.value = FLAKE_BUMP * a;
  u.uBumpStr.value = BUMP_STR * s.bump;
  u.uMicro.value = MICRO * s.bump;
  u.uRN.value = s.mottle;
  u.uFlakeScale.value = FLAKE_SCALE / s.flakeSize;
  u.uBumpScale.value = BUMP_SCALE / s.bumpSize;
  u.uRoughScale.value = ROUGH_SCALE / s.bumpSize;
}
export type GrainUniforms = {
  [K in "uNoise" | "uDots" | "uDotsFrom" | "uDarkDots" | "uGrainPx" | "uFlakeMin"
    | "uFlakeMul" | "uFlakeBump" | "uBumpStr" | "uMicro" | "uRN"
    | "uFlakeScale" | "uBumpScale" | "uRoughScale"]: { value: number };
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
          // 両端が同じ値だと smoothstep の結果は決まらないので、少しだけ離す
          float w = smoothstep(min(uDotsFrom, 0.999), 1.0, lum) * uDots;
          // step() だと乱数がちょうど 0 の画素で量 0 でも点が出るので、< で比べる
          c = mix(c, vec3(1.0), float(grainHash(cell) < w) * 0.85);
          // 暗い所ほど黒い粒が増える
          float b = (1.0 - smoothstep(0.0, max(uDotsFrom, 0.001), lum)) * uDarkDots;
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

/**
 * 値を当てる。
 * zoom = 外側の CSS で縮められている割合（スクロールで引くと小さくなる）。
 * cam  = カメラの寄り具合（畳まれた姿のときを 1 とし、ほどけて伸びた姿を収めようと
 *        カメラが下がるほど小さくなる）。
 * どちらでも立体は画面の中で小さくなり、ラメや凹凸が1点より細かくなって均される。
 * 2つを掛けた「画面で見た大きさ」で値を決める。
 */
export function setSilver(
  s: Silver,
  t: {
    body: THREE_T.MeshStandardMaterial;
    seams: THREE_T.MeshStandardMaterial[];
    u: GrainUniforms;
    renderer: THREE_T.WebGLRenderer;
    scene: THREE_T.Scene;
  },
  zoom = 1,
  cam = 1,
) {
  const eff = Math.max(zoom * cam, 0.05);
  // 0.55 倍まで小さくなったら「いちばん引き」とみなす（PC の引きの大きさがこのくらい）
  const f = Math.min(1, Math.max(0, (1 - eff) / 0.45));
  const z = atZoom(s, f);
  // それより小さくなったら、ラメと凹凸を粗くして、画面で見た大きさを保つ。
  // 小さくなった分そのままだと粗すぎるので、少し控えめにする（0.75 乗）
  const extra = Math.pow(Math.max(1, 0.55 / eff), 0.75);
  // ただし上限を超えて粗くしない（ほどけて伸びた姿でカメラが大きく下がると、粒が大きく見えすぎる）
  z.flakeSize = Math.min(z.flakeSize * extra, Math.max(1, s.farSizeMax));
  z.bumpSize = Math.min(z.bumpSize * extra, Math.max(1, s.farSizeMax));
  t.body.color.set(s.base);
  t.body.metalness = s.metalness;
  for (const m of t.seams) {
    m.color.copy(t.body.color).multiplyScalar(z.seam);
    m.metalness = s.metalness;
  }
  t.renderer.toneMappingExposure = Math.pow(2, z.exposure);
  t.scene.environmentIntensity = s.env;
  t.u.uNoise.value = z.noise;
  t.u.uDots.value = z.dots;
  t.u.uDotsFrom.value = s.dotsFrom;
  t.u.uDarkDots.value = s.darkDots;
  // 粒は画面に描く点。canvas は舞台いっぱいで縮められていないので、そのままの大きさで描く
  t.u.uGrainPx.value = s.grainPx;
  setFlakeBump(t.u, z);
}
