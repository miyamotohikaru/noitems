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
  /** 主光: 下手前から少し右寄り（カメラから見た向き。x=右, y=上, z=手前）。上の面は暗く残す */
  keyDir: [0.3, -0.78, 0.55],
  key: 0.6,
  /** 補助光: 左から弱く */
  fillDir: [-0.85, -0.1, 0.35],
  fill: 0.12,
  /** 縁の光（下向きの輪郭だけ白く抜ける） */
  rim: 1.25,
  /** どこにも光が当たらない面の明るさ */
  ambient: 0.0,
  /** 粒の大きさ（画面の画素数） */
  grainPx: 1,
  /** 粒の混ぜ具合。0 でなめらかな濃淡だけ、1 で粒だけ */
  smooth: 0.5,
  /** 暗い面にも残す粒の割合（炭のような手触り） */
  floor: 0.0,
  /** 一番明るいところでも粒にならずに残す割合（白一色の板にしない） */
  cap: 0.96,
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
      uFloor: { value: g.floor },
      uCap: { value: g.cap },
    },
    // 裏面も描く。部品のすき間から地が透けて白い点になるのを、暗い内側で埋める
    side: THREE.DoubleSide,
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
      uniform float uKey, uFill, uRim, uAmb, uGrainPx, uSmooth, uFloor, uCap;
      varying vec3 vN;
      varying vec3 vP;
      // 画素ごとの乱数。粗い式だと粒が格子状に並んで見えるので、偏りの少ない式を使う
      float hash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      void main() {
        // 裏面（すき間から見える内側）は暗く塗るだけ
        if (!gl_FrontFacing) {
          gl_FragColor = vec4(uDark * 0.6, 1.0);
          return;
        }
        vec3 n = normalize(vN);
        vec3 v = normalize(-vP);
        // やわらかく回り込む光（真横でもわずかに残す）
        float key = clamp((dot(n, uKeyDir) + 0.15) / 1.15, 0.0, 1.0);
        float fill = clamp((dot(n, uFillDir) + 0.1) / 1.1, 0.0, 1.0);
        // 白い光は輪郭に沿って出す。下向きの輪郭ほど強く、上の縁には出さない
        // （上や横の縁に当てると、部品の端が明るい輪になる）
        float rim = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.2)
                  * clamp(-n.y * 1.2 + 0.35, 0.0, 1.0);
        float I = uAmb + uKey * key * key + uFill * fill + uRim * rim;
        I = clamp(I, 0.0, 1.0);

        vec2 cell = floor(gl_FragCoord.xy / uGrainPx);
        float r = hash(cell);
        float p = smoothstep(0.0, 1.0, I);
        // なめらかな濃淡
        vec3 shade = mix(uDark, uLight, p);
        // 同じ明るさを、白い粒の出る確率に置き換えたもの（明るいところも埋めきらない）
        float dotOn = step(r, uFloor + (uCap - uFloor) * p);
        vec3 dither = mix(uDark, uLight, dotOn);
        // 2つを混ぜる。粒だけだと塩をまいたように粗く、濃淡だけだとただのCGになる
        vec3 col = mix(shade, dither, uSmooth);
        // 炭のような手触り。暗い面にも細かなざらつきを薄く乗せる
        col += (hash(cell + 71.3) - 0.5) * 0.07;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
