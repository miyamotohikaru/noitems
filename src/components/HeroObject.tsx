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
      const MARGIN = 1.21; // 元ビューアの fit() と同じ
      const fitDistance = () => {
        box.setFromObject(model);
        box.getSize(size);
        box.getCenter(center);
        // 中心を原点に寄せて、いつも同じ場所で回るようにする
        model.position.sub(center.clone().applyQuaternion(model.quaternion));
        return (
          (size.length() / 2 / Math.sin((camera.fov * Math.PI) / 360)) * MARGIN
        );
      };
      let curDist = fitDistance();
      const place = () => {
        camera.position.copy(dir).multiplyScalar(curDist);
        camera.lookAt(0, 0, 0);
      };
      place();

      const resize = () => {
        const w = el.clientWidth || 1;
        const h = el.clientHeight || 1;
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
      // 部品どうしがぶつからないよう、関節を一つずつ順に回していく。
      // 同時に全部動かすと、途中の姿で必ずめり込む。
      let poseIndex = 0;
      let from = POSES[0].slice();
      let to = POSES[1 % POSES.length].slice();
      const step = TURN + GAP;
      const legTotal = joints.length * step + REST;
      const start = performance.now();
      const ease = (t: number) =>
        t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      /** −180〜180 の最短回り */
      const shortest = (a: number, bb: number) => {
        let d = bb - a;
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        return d;
      };

      renderer.setAnimationLoop(() => {
        const now = (performance.now() - start) / 1000;
        const legTime = now % legTotal;
        const leg = Math.floor(now / legTotal);

        if (leg !== poseIndex) {
          poseIndex = leg;
          from = to.slice();
          to = POSES[(leg + 1) % POSES.length].slice();
        }

        joints.forEach((_, i) => {
          const t0 = i * step;
          const k = ease(Math.min(1, Math.max(0, (legTime - t0) / TURN)));
          cur[i] = from[i] + shortest(from[i], to[i]) * k;
        });
        setPose();

        // 大きさが変わるので、距離をゆっくり追いかける
        const want = fitDistance();
        curDist += (want - curDist) * 0.04;
        place();

        // 見る角度もゆっくり。回しすぎると落ち着かない
        pivot.rotation.y = Math.sin(now * 0.06) * 0.3;
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
