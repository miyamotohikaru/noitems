import type * as THREE_T from "three";

/**
 * 黒い粒子の質感（2026-11-06 ユーザー指定の参考画像に合わせたもの）。
 *
 * 炭のような黒い地に、光の当たるところだけ白い粒が密に浮かぶ。
 * 明るさを「その画素が白い粒になる確率」に置き換えて描く（点描の考え方）。
 *
 * 光はカメラに対して固定している。物体が回っても、いつも
 * 「上は暗く、手前の下側と縁が白く光る」見え方になる。
 *
 * 銀色の金属（look.ts）は残してある。戻すときは HeroObject で
 * makeGrainMaterial の代わりに applyLook を使う。
 */
export const GRAIN = {
  /** 地の黒（画面の色そのまま。0〜1） */
  dark: [0.12, 0.12, 0.125],
  /** 粒の白 */
  light: [0.93, 0.93, 0.94],
  /** 主光: 右下手前から（カメラから見た向き。x=右, y=上, z=手前） */
  keyDir: [0.55, -0.6, 0.6],
  key: 1.0,
  /** 補助光: 左から弱く */
  fillDir: [-0.85, -0.1, 0.35],
  fill: 0.2,
  /** 縁の光（輪郭が白く抜ける） */
  rim: 0.35,
  /** どこにも光が当たらない面の明るさ */
  ambient: 0.0,
  /** 粒の大きさ（画面の画素数） */
  grainPx: 1,
  /** 粒にならない、なめらかな明るさの割合。0 で粒だけ、1 で粒なし */
  smooth: 0.35,
};

export function makeGrainMaterial(
  THREE: typeof THREE_T,
  over: Partial<typeof GRAIN> = {},
) {
  const g = { ...GRAIN, ...over };
  const v3 = (a: number[]) => new THREE.Vector3(a[0], a[1], a[2]).normalize();
  const c3 = (a: number[]) => new THREE.Vector3(a[0], a[1], a[2]);
  return new THREE.ShaderMaterial({
    // 色は画面の色そのままで書く。トーンマッピングを通すと黒が浮く
    toneMapped: false,
    uniforms: {
      uDark: { value: c3(g.dark) },
      uLight: { value: c3(g.light) },
      uKeyDir: { value: v3(g.keyDir) },
      uFillDir: { value: v3(g.fillDir) },
      uKey: { value: g.key },
      uFill: { value: g.fill },
      uRim: { value: g.rim },
      uAmb: { value: g.ambient },
      uGrainPx: { value: g.grainPx },
      uSmooth: { value: g.smooth },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vP;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vP = mv.xyz;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uDark, uLight, uKeyDir, uFillDir;
      uniform float uKey, uFill, uRim, uAmb, uGrainPx, uSmooth;
      varying vec3 vN;
      varying vec3 vP;
      // 画素ごとの乱数。粗い式だと粒が格子状に並んで見えるので、偏りの少ない式を使う
      float hash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      void main() {
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        vec3 v = normalize(-vP);
        // やわらかく回り込む光（真横でもわずかに残す）
        float key = clamp((dot(n, uKeyDir) + 0.15) / 1.15, 0.0, 1.0);
        float fill = clamp((dot(n, uFillDir) + 0.1) / 1.1, 0.0, 1.0);
        float rim = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0);
        // 主光は狭く絞る。広く当てると白い面が地のベージュに溶ける
        float I = uAmb + uKey * key * key + uFill * fill + uRim * rim;
        I = clamp(I, 0.0, 1.0);

        // 明るさを、白い粒が出る確率にする。画素ごとに固定の乱数と比べる
        float r = hash(floor(gl_FragCoord.xy / uGrainPx));
        float p = smoothstep(0.1, 1.0, I);
        float dotOn = step(r, p * p * (3.0 - 2.0 * p));

        vec3 base = mix(uDark, uLight, I * uSmooth);
        vec3 col = mix(base, uLight, dotOn * (1.0 - uSmooth));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
