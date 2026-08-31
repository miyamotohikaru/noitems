"use client";

import { useEffect, useRef, useState } from "react";
// 実体は動的に読み込む。型だけ静的に借りる
import type * as THREE_T from "three";

/**
 * ヒーローの立体。
 *
 * 元データは project-itm02 の SYKIM ビューア（Blender のリグを three.js に載せたもの）。
 * 関節は J00〜J29 の30個で、それぞれ Z軸に回すだけで形が変わる。
 * ポーズは30個の角度の配列で表せるので、配列のあいだを補間して「かたちが変わる」を作る。
 *
 * 読み込みは重いので、出来上がるまでは静止画（form-hero.webp）を出しておき、
 * 準備ができたら静かに入れ替える。動きを嫌う設定の人には、止まった姿だけを見せる。
 */

/** 30個の関節の角度（度）。0 は畳まれた塊 */
const POSES: number[][] = [
  // 畳まれた状態。いまの静止画と同じ姿
  new Array(30).fill(0),
  // ゆるみはじめ
  [
    0, 12, -10, 14, -12, 16, -14, 12, -10, 14, -12, 16, -14, 12, -10, 14, -12,
    16, -14, 12, -10, 14, -12, 16, -14, 12, -10, 14, -12, 16,
  ],
  // ほどけた状態
  [
    0, 26, -22, 30, -26, 34, -30, 26, -22, 30, -26, 34, -30, 26, -22, 30, -26,
    34, -30, 26, -22, 30, -26, 34, -30, 26, -22, 30, -26, 34,
  ],
];

/** 1つの姿にとどまる時間と、移り変わりにかける時間（秒） */
const HOLD = 3.2;
const MORPH = 4.8;

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
      const { MeshoptDecoder } = await import(
        "three/examples/jsm/libs/meshopt_decoder.module.js"
      );
      const { RoomEnvironment } = await import(
        "three/examples/jsm/environments/RoomEnvironment.js"
      );
      if (disposed) return;

      const renderer = new THREE.WebGLRenderer({
        alpha: true, // 紙の地とテクスチャを透かす
        antialias: true,
        powerPreference: "high-performance",
      });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      // 静止画で合わせた実物の明るさ（輝度107）に寄せる。既定だと白飛びする
      renderer.toneMappingExposure = 0.40;
      el.appendChild(renderer.domElement);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.display = "block";

      const scene = new THREE.Scene();

      // 金属なので、映り込む環境が無いと質感が出ない
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(
        new RoomEnvironment(),
        0.04,
      ).texture;

      // Blender の key / fill / rim を大まかに写したもの
      const key = new THREE.DirectionalLight(0xffffff, 1.55);
      key.position.set(0.5, 4.1, 4.4);
      const fill = new THREE.DirectionalLight(0xdfe9ff, 0.5);
      fill.position.set(-5.5, -1.7, 2.3);
      const rim = new THREE.DirectionalLight(0xe6f0ff, 0.9);
      rim.position.set(2.9, -4.1, 4.0);
      scene.add(key, fill, rim);

      const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
      const pivot = new THREE.Group();
      scene.add(pivot);

      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);

      const gltf = await loader.loadAsync("/models/sykim.glb");
      if (disposed) {
        renderer.dispose();
        return;
      }
      const model = gltf.scene;

      // 実物に合わせた色。静止画と同じ、青みのあるガンメタル
      const body = new THREE.MeshStandardMaterial({
        // 実物は鏡ではない。つや消しに近い塗装なので roughness を上げる
        color: new THREE.Color(0.255, 0.285, 0.313),
        metalness: 0.85,
        roughness: 0.44,
      });
      const seam = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0.17, 0.19, 0.21),
        metalness: 0.85,
        roughness: 0.55,
      });
      model.traverse((o) => {
        const m = o as THREE_T.Mesh;
        if (!m.isMesh) return;
        m.material = m.name.startsWith("seam") ? seam : body;
        m.castShadow = false;
        m.receiveShadow = false;
      });

      // 関節を J00〜J29 の順に集める
      const joints: THREE_T.Object3D[] = [];
      const found = new Map<string, THREE_T.Object3D>();
      model.traverse((o) => {
        if (/^J\d\d$/.test(o.name)) found.set(o.name, o);
      });
      [...found.keys()].sort().forEach((k) => joints.push(found.get(k)!));

      pivot.add(model);

      // 画面に収める
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);
      const radius = size.length() / 2;
      const dist = radius / Math.sin((camera.fov * Math.PI) / 360) / 1.05;
      camera.position.set(dist * 0.62, dist * 0.2, dist * 0.76);
      camera.lookAt(0, 0, 0);

      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

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

      const setPose = (a: number[]) => {
        joints.forEach((j, i) => {
          j.rotation.z = ((a[i] ?? 0) * Math.PI) / 180;
        });
      };

      // 動きを嫌う設定なら、ほどけた姿で止める
      if (reduced) {
        setPose(POSES[1]);
        renderer.render(scene, camera);
        setReady(true);
        cleanup = () => {
          ro.disconnect();
          renderer.dispose();
          el.removeChild(renderer.domElement);
        };
        return;
      }

      const period = HOLD + MORPH;
      const start = performance.now();
      const ease = (t: number) =>
        t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      renderer.setAnimationLoop(() => {
        const now = (performance.now() - start) / 1000;

        // 姿から姿へ、行って戻ってを繰り返す
        const span = period * (POSES.length - 1) * 2;
        const p = now % span;
        const leg = Math.floor(p / period);
        const local = (p % period) / period;
        const seq = [...POSES, ...POSES.slice(0, -1).reverse()];
        const from = seq[leg] ?? POSES[0];
        const to = seq[leg + 1] ?? POSES[0];
        const k = ease(
          Math.min(1, Math.max(0, (local - HOLD / period) / (MORPH / period))),
        );
        setPose(from.map((v, i) => v + ((to[i] ?? 0) - v) * k));

        // 見る角度もゆっくり変える。回しすぎると落ち着かない
        pivot.rotation.y = Math.sin(now * 0.07) * 0.34;
        renderer.render(scene, camera);
      });

      setReady(true);
      cleanup = () => {
        renderer.setAnimationLoop(null);
        ro.disconnect();
        pmrem.dispose();
        body.dispose();
        seam.dispose();
        renderer.dispose();
        if (renderer.domElement.parentNode === el)
          el.removeChild(renderer.domElement);
      };
    })().catch((error) => {
      // 3Dが出せなくても、静止画が残るので致命的ではない
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
