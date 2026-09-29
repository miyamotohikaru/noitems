"use client";

import { useEffect, useRef, useState } from "react";
// 実体は動的に読み込む。型だけ静的に借りる
import type * as THREE_T from "three";
import { LOOK, applyLook } from "@/lib/sykim/look";
import { POSES } from "@/lib/sykim/poses";

/**
 * ヒーローの立体。
 *
 * 元は project-itm02 の SYKIM ビューア。見た目（AgX・環境・ライト・ラメ）は
 * lib/sykim/look.ts に、そのまま移植してある。ここは組み立てと動きだけ。
 *
 * 関節は J00〜J29 の30個で、それぞれZ軸に回すと形が変わる。
 * ただし適当な角度に回すと部品どうしがめり込むので、
 * 当たり判定を通ったポーズ（lib/sykim/poses.ts）だけを使い、
 * さらに「一関節ずつ順に回す」ことで途中の重なりも避ける。
 */

/** 1つの関節を回しきる時間と、次の関節に移るまでの間（秒） */
const TURN = 1.15;
const GAP = 0.12;
/** ポーズが決まってから、次のポーズへ動き出すまで */
const REST = 2.6;

export function HeroObject({ className = "" }: { className?: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      const THREE = await import("three");
      const { GLTFLoader } = await import(
        "three/examples/jsm/loaders/GLTFLoader.js"
      );
      const { RectAreaLightUniformsLib } = await import(
        "three/examples/jsm/lights/RectAreaLightUniformsLib.js"
      );
      if (disposed) return;

      const L = LOOK;

      const renderer = new THREE.WebGLRenderer({
        alpha: true, // 紙の地と粒子を透かす
        antialias: true,
        powerPreference: "high-performance",
      });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      // ── トーン（元ファイルと同じ AgX + Exposure）
      renderer.toneMapping = THREE.AgXToneMapping;
      renderer.toneMappingExposure = Math.pow(2, L.view.exposure);
      el.appendChild(renderer.domElement);
      Object.assign(renderer.domElement.style, {
        width: "100%",
        height: "100%",
        display: "block",
      });

      const scene = new THREE.Scene();

      // ── 環境（Blenderのワールド：下が暗く上が明るい縦グラデ）
      //    金属に映り込むので、粗いと格子が出る。高解像度で作る。
      const W = 1024;
      const H = 512;
      const cv = document.createElement("canvas");
      cv.width = W;
      cv.height = H;
      const ctx = cv.getContext("2d")!;
      const st = L.world.stops;
      const c0 = st[0][1] as unknown as number[];
      const c1 = st[1][1] as unknown as number[];
      const to255 = (v: number) =>
        Math.round(Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2) * 255);
      const g = ctx.createLinearGradient(0, 0, 0, H);
      const rgb = (c: number[]) =>
        `rgb(${to255(c[0])},${to255(c[1])},${to255(c[2])})`;
      g.addColorStop(0, rgb(c1));
      g.addColorStop(Math.min(1, Math.max(0, 1 - Number(st[1][0]))), rgb(c1));
      g.addColorStop(Math.min(1, Math.max(0, 1 - Number(st[0][0]))), rgb(c0));
      g.addColorStop(1, rgb(c0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      const tex = new THREE.CanvasTexture(cv);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      const pm = new THREE.PMREMGenerator(renderer);
      pm.compileEquirectangularShader();
      scene.environment = pm.fromEquirectangular(tex).texture;
      scene.environmentIntensity = 1.4 * L.world.strength;

      // ── ライト（Blenderのエリアライトを RectAreaLight で再現）
      RectAreaLightUniformsLib.init();
      const K = 1.25; // W → three の強さ の換算係数
      L.lights.forEach((li) => {
        const w = li.size;
        const h = li.shape === "SQUARE" ? li.size : li.size_y;
        const la = new THREE.RectAreaLight(
          new THREE.Color(li.color[0], li.color[1], li.color[2]),
          (li.energy * K) / (w * h),
          w,
          h,
        );
        // Blender: Z-up / three: Y-up
        la.position.set(li.loc[0], li.loc[2], -li.loc[1]);
        la.lookAt(0, 0, 0);
        scene.add(la);
      });

      const camera = new THREE.PerspectiveCamera(14, 1, 0.1, 100);
      const pivot = new THREE.Group();
      scene.add(pivot);

      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync("/models/sykim.glb");
      if (disposed) {
        renderer.dispose();
        return;
      }
      const model = gltf.scene;

      // ── 素材（元ファイルの見た目をそのまま当てる）
      let baseMat: THREE_T.MeshStandardMaterial | null = null;
      model.traverse((o) => {
        const m = o as THREE_T.Mesh;
        if (!m.isMesh || !m.material || m.name.startsWith("seam")) return;
        if (!baseMat) {
          baseMat = m.material as THREE_T.MeshStandardMaterial;
          applyLook(THREE, baseMat, L);
        }
        m.material = baseMat!;
        (m.material as THREE_T.Material).side = THREE.FrontSide;
      });
      // 繋ぎ目は本体と同じ金属味で、色だけ少し暗く
      const sd = 0.55;
      const b = L.mat.base;
      const done = new Set<string>();
      model.traverse((o) => {
        const m = o as THREE_T.Mesh;
        if (!(m.isMesh && m.name.startsWith("seam"))) return;
        const sm = m.material as THREE_T.MeshStandardMaterial;
        if (done.has(sm.uuid)) return;
        done.add(sm.uuid);
        sm.color.setRGB(b[0] * sd, b[1] * sd, b[2] * sd, THREE.LinearSRGBColorSpace);
        sm.metalness = L.mat.metallic;
        sm.roughness = (L.mat.rough_min + L.mat.rough_max) / 2;
        sm.needsUpdate = true;
      });

      // 関節を J00〜J29 の順に集める
      const found = new Map<string, THREE_T.Object3D>();
      model.traverse((o) => {
        if (/^J\d\d$/.test(o.name)) found.set(o.name, o);
      });
      const joints = [...found.keys()].sort().map((k) => found.get(k)!);

      pivot.add(model);

      // 画面に収める。
      // 形が変わると大きさも中心も動くので、毎フレーム測り直して
      // カメラの距離をゆっくり合わせる。固定だと、ほどけた姿がはみ出す。
      const box = new THREE.Box3();
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      const dir = new THREE.Vector3(0.6194, 0.1998, 0.7592).normalize();
      // 元ビューアの fit() は 1.21。ヒーローでは枠いっぱいまで寄せて、
      // 塗装の粒子が見える大きさで描く（小さいと粒が1画素を切って消える）
      const MARGIN = 1.15;
      // ほどけた姿は縦横に伸びるが、そのたび全部を収めようとすると
      // 細い線が画面の隅で小さくなってしまう。畳まれた姿の大きさを基準に、
      // 引きすぎない上限を設けて、常に見応えのある大きさを保つ。
      let baseRadius = 0;
      const MAX_ZOOM_OUT = 3.4; // 畳まれた姿の何倍まで引いてよいか
      const aim = new THREE.Vector3();
      const fitDistance = () => {
        // ⚠️ 中心は「回転を外した姿」で測る。
        // 回ったままの世界座標で測ると、回るたびに中心が動いて軸がぶれる。
        // また位置は足し引きせず代入する（引き算だと誤差が積み上がり、
        // 少しずつ横へ流れて画面の外に出てしまう）。
        const ry = pivot.rotation.y;
        const rx = pivot.rotation.x;
        pivot.rotation.set(0, 0, 0);
        model.position.set(0, 0, 0);
        pivot.updateMatrixWorld(true);
        box.setFromObject(model);
        box.getSize(size);
        box.getCenter(center);
        pivot.rotation.x = rx;
        pivot.rotation.y = ry;

        // 形が変わると中心も動く。そのまま当てると跳ねるので、ゆっくり寄せる
        aim.lerp(center, 0.08);
        model.position.set(-aim.x, -aim.y, -aim.z);

        let r = size.length() / 2;
        if (!baseRadius) baseRadius = r;
        r = Math.min(r, baseRadius * MAX_ZOOM_OUT);
        return (r / Math.sin((camera.fov * Math.PI) / 360)) * MARGIN;
      };
      let curDist = fitDistance();
      const place = () => {
        camera.position.copy(dir).multiplyScalar(curDist);
        camera.lookAt(0, 0, 0);
      };
      place();

      // 表示を大きくすると画素数が一気に増えて描画が追いつかなくなる。
      // 見た目の大きさはそのままに、中で持つ画素数だけ上限をかける。
      const MAX_PIXELS = 1500;
      const resize = () => {
        const w = el.clientWidth || 1;
        const h = el.clientHeight || 1;
        const dpr = Math.min(
          devicePixelRatio,
          2,
          MAX_PIXELS / Math.max(w, h),
        );
        renderer.setPixelRatio(Math.max(1, dpr));
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(el);

      const cur = POSES[0].slice();
      const setPose = () => {
        joints.forEach((j, i) => {
          j.rotation.z = ((cur[i] ?? 0) * Math.PI) / 180;
        });
      };
      setPose();

      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) {
        renderer.render(scene, camera);
        setReady(true);
        cleanup = () => {
          ro.disconnect();
          pm.dispose();
          renderer.dispose();
          if (renderer.domElement.parentNode === el)
            el.removeChild(renderer.domElement);
        };
        return;
      }

      // ── 動き
      // 人が手で関節を回しているように見せる。機械的にならないよう、
      //   ・回す順番、速さ、間合いを毎回ばらす
      //   ・勢いよく回して行き過ぎ、少し戻って落ち着く（オーバーシュート）
      //   ・ときどき数関節をまとめて動かし、ときどき手を止める
      // 部品どうしのめり込みを避けるため、行き先は当たり判定を通ったポーズのみ。
      type Move = { at: number; dur: number; over: number };
      type Plan = {
        from: number[];
        to: number[];
        mv: Move[];
        /** 関節が動き終わる時刻 */
        settled: number;
        /** 見せる回転を終えて、次の形へ移る時刻 */
        total: number;

      };

      const rnd = (a: number, b: number) => a + Math.random() * (b - a);
      const shuffle = <T,>(a: T[]) => {
        const x = a.slice();
        for (let i = x.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [x[i], x[j]] = [x[j], x[i]];
        }
        return x;
      };

      let planFrom = POSES[0].slice();
      let planIndex = 0;

      const makePlan = (): Plan => {
        // 畳まれた塊（0番）は作品の顔なので、3回に1回はそこへ戻す。
        // 完全な乱数だと、ほどけた形ばかりが続いて塊が出てこない。
        let next: number;
        if (planIndex !== 0 && Math.random() < 0.34) {
          next = 0;
        } else {
          next = planIndex;
          while (next === planIndex && POSES.length > 1)
            next = Math.floor(Math.random() * POSES.length);
        }
        planIndex = next;

        const order = shuffle(joints.map((_, i) => i));
        const mv: Move[] = new Array(joints.length);
        let t = 0;
        let k = 0;
        while (k < order.length) {
          // 手でまとめて掴むように、1〜4関節を一度に動かすことがある
          const group = Math.random() < 0.45 ? Math.ceil(rnd(2, 4.99)) : 1;
          const dur = rnd(0.22, 0.6);
          for (let n = 0; n < group && k < order.length; n++, k++) {
            mv[order[k]] = {
              at: t + rnd(0, 0.09), // 同時でも、わずかにずれる
              dur: dur * rnd(0.85, 1.2),
              over: Math.random() < 0.7 ? rnd(0.04, 0.16) : 0, // 行き過ぎ量
            };
          }
          // 手を止める間。たまに長めに考える
          t += dur + (Math.random() < 0.18 ? rnd(0.25, 0.7) : rnd(0.02, 0.14));
        }
        // 形が決まったら、そのまま止めずに、ぐるりと回して見せる
        const show = rnd(2.6, 4.4);
        const settled = t + rnd(0.15, 0.5);
        return {
          from: planFrom.slice(),
          to: POSES[planIndex].slice(),
          mv,
          settled,
          total: settled + show,
        };
      };

      let plan = makePlan();
      let legStart = performance.now() / 1000;
      let spinAngle = 0; // 回した角度。積み上げるだけで巻き戻さない
      const SPIN_SPEED = (Math.PI * 2) / 14; // 1周14秒。速さも向きも変えない
      let lastT = performance.now() / 1000;
      const start = performance.now();

      /** 勢いよく出て、行き過ぎてから落ち着く */
      const settle = (t: number, over: number) => {
        if (t <= 0) return 0;
        if (t >= 1) return 1;
        const e = 1 - Math.pow(1 - t, 3); // 速く出て、ゆっくり収まる
        return e + over * Math.sin(t * Math.PI * 2) * (1 - t);
      };
      /** −180〜180 の最短回り */
      const shortest = (a: number, bb: number) => {
        let d = bb - a;
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        return d;
      };

      renderer.setAnimationLoop(() => {
        const nowSec = performance.now() / 1000;
        const now = (performance.now() - start) / 1000;
        const dt = Math.min(0.05, nowSec - lastT);
        lastT = nowSec;
        let legTime = nowSec - legStart;

        if (legTime >= plan.total) {
          planFrom = plan.to.slice();
          plan = makePlan();
          legStart = nowSec;
          legTime = 0;
        }

        joints.forEach((_, i) => {
          const m = plan.mv[i];
          const k = settle((legTime - m.at) / m.dur, m.over);
          cur[i] = plan.from[i] + shortest(plan.from[i], plan.to[i]) * k;
        });
        setPose();

        // 大きさが変わるので、距離を追いかける
        const want = fitDistance();
        curDist += (want - curDist) * 0.13;
        place();

        // 真ん中を軸に、一定の速さで回し続ける。
        // 揺らぎは入れない（軸がぶれて見えるため）。
        spinAngle += SPIN_SPEED * dt;
        pivot.rotation.y = spinAngle;
        pivot.rotation.x = 0;
        renderer.render(scene, camera);
      });

      setReady(true);
      cleanup = () => {
        renderer.setAnimationLoop(null);
        ro.disconnect();
        pm.dispose();
        tex.dispose();
        renderer.dispose();
        if (renderer.domElement.parentNode === el)
          el.removeChild(renderer.domElement);
      };
    })().catch((error) => {
      // 3Dが出せなくても静止画が残るので、致命的ではない
      console.error("[hero] 3D の読み込みに失敗しました", error);
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  // 外側は渡された配置をそのまま使う。ここに relative を足すと
  // absolute と競合して配置が丸ごと壊れる
  return (
    <div className={className}>
      <div className="relative">
        {/* 準備ができるまでは静止画。できたら静かに入れ替える */}
        <img
          src="/img/form-hero.webp"
          alt="つや消しの銀色をした、用途の定まらないかたち"
          decoding="async"
          data-ready={ready}
          className="cutout w-full transition-opacity duration-1000 data-[ready=true]:opacity-0"
        />
        <div
          ref={holder}
          data-ready={ready}
          aria-hidden
          className="absolute inset-0 opacity-0 transition-opacity duration-1000 data-[ready=true]:opacity-100"
        />
      </div>
    </div>
  );
}
