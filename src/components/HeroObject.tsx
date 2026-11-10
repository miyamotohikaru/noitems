"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
// 実体は動的に読み込む。型だけ静的に借りる
import type * as THREE_T from "three";
import { LOOK, applyLook } from "@/lib/sykim/look";
import {
  SILVER,
  addGrain,
  makeGrainUniforms,
  setSilver,
  type Silver,
} from "@/lib/sykim/silverGrain";
import { GrainTuner } from "@/components/GrainTuner";
import { TextTuner } from "@/components/TextTuner";
import { heroMotion, heroTurn, mobileLayout } from "@/lib/sykim/motion";
import { POSES } from "@/lib/sykim/poses";
import { makeHitTest } from "@/lib/sykim/collide";

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

/**
 * 「元の形へ戻す」の受け皿。
 *
 * ⚠️ window に1つだけ置かないこと。立体はデスクトップ用とスマホ用の
 * 2つが同時に生きていて（片方は CSS で隠れているだけ）、窓口が1つだと
 * あとから立ち上がったほう＝隠れているほうに上書きされ、
 * ボタンを押しても何も起きなくなる。ここでは全部に配って、まとめて呼ぶ。
 */
const resetters = new Set<() => void>();
const watchers = new Set<() => void>();
function addResetter(fn: () => void) {
  resetters.add(fn);
  watchers.forEach((w) => w());
  return () => {
    resetters.delete(fn);
    watchers.forEach((w) => w());
  };
}

export function HeroObject({
  className = "",
  showReset = true,
  stage,
}: {
  className?: string;
  /**
   * 描画を広げる先（ヒーローの舞台全体）。
   * 渡すと、canvas を舞台いっぱいに敷き、立体はこのコンポーネントの正方形の枠の位置・大きさに
   * 合わせて描く（カメラの側で寄せる）。正方形の canvas のままだと、ほどけて伸びた形が
   * 枠の縁でまっすぐ切れて、本文の後ろへ隠れたように見えていた（2026-11-08）。
   */
  stage?: HTMLElement | null;
  // （stage に null を渡したら「舞台がまだ無い」の意味。用意できるまで 3D を始めない）
  /** 立体の中にボタンを重ねるか。デスクトップは本文側に別途置くので false */
  showReset?: boolean;
}) {
  const holder = useRef<HTMLDivElement>(null);
  /** 立体を収める正方形の枠（外側の CSS で縮められ、動かされる） */
  const frame = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  /** ボタンから「元の形へ戻す」を呼ぶための受け皿 */
  const resetRef = useRef<(() => void) | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    // 舞台を待っているあいだは始めない（二度読み込むのを避ける）
    if (stage === null) return;
    const el = holder.current;
    const fr = frame.current;
    if (!el || !fr) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;
    let unregister: (() => void) | undefined;

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

      // ── 素材: 銀色の金属（lib/sykim/look.ts）に細かな粒を重ねる（lib/sykim/silverGrain.ts）。
      // 2026-11-06 に黒い粒子（grain.ts）へ替えたが、11-08 に「最初の銀色がいちばん近い。
      // そこに少し粒子を」と言われて戻した。
      // あわせて丸棒を「繋がっている順」に集める。めり込み判定がこの並びを使う
      const grainU = makeGrainUniforms();
      let baseMat: THREE_T.MeshStandardMaterial | null = null;
      const meshes: THREE_T.Mesh[] = [];
      model.traverse((o) => {
        const m = o as THREE_T.Mesh;
        if (!m.isMesh || !m.material || m.name.startsWith("seam")) return;
        if (!baseMat) {
          baseMat = m.material as THREE_T.MeshStandardMaterial;
          applyLook(THREE, baseMat, L);
          addGrain(baseMat, grainU);
        }
        m.material = baseMat!;
        (m.material as THREE_T.Material).side = THREE.FrontSide;
        meshes.push(m);
      });
      // 繋ぎ目は本体と同じ金属味で、色だけ少し暗く。粒も同じものを重ねる
      const seamMats: THREE_T.MeshStandardMaterial[] = [];
      model.traverse((o) => {
        const m = o as THREE_T.Mesh;
        if (!(m.isMesh && m.name.startsWith("seam"))) return;
        const sm = m.material as THREE_T.MeshStandardMaterial;
        if (seamMats.includes(sm)) return;
        seamMats.push(sm);
        sm.roughness = (L.mat.rough_min + L.mat.rough_max) / 2;
        addGrain(sm, grainU);
      });
      const silverTarget = {
        body: baseMat! as THREE_T.MeshStandardMaterial,
        seams: seamMats,
        u: grainU,
        renderer,
        scene,
      };
      // 今の値と、立体の縮み具合。縮むと質感の値を「引き」の値へ寄せる（silverGrain.ts）
      let silver: Silver = SILVER;
      let zoom = 1;
      let cam = 1;
      setSilver(silver, silverTarget, zoom, cam);
      // 調整パネル（URL に ?tune）から値を流し込む口
      {
        const w = window as unknown as {
          __heroSilver__?: (s: Silver) => void;
          __heroSilverLast__?: Silver;
        };
        w.__heroSilver__ = (v) => {
          silver = v;
          setSilver(silver, silverTarget, zoom, cam);
        };
        if (w.__heroSilverLast__) w.__heroSilver__(w.__heroSilverLast__);
      }

      // 関節を J00〜J29 の順に集める
      const found = new Map<string, THREE_T.Object3D>();
      model.traverse((o) => {
        if (/^J\d\d$/.test(o.name)) found.set(o.name, o);
      });
      const joints = [...found.keys()].sort().map((k) => found.get(k)!);
      const hits = makeHitTest(THREE, model, meshes);
      // 開発時だけ、外からめり込みを確かめられるようにする（本番ビルドには入らない）
      if (process.env.NODE_ENV !== "production") {
        const w = window as unknown as { __heroHits__?: (() => boolean)[] };
        (w.__heroHits__ ||= []).push(hits);
      }

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

        // 形が変わると中心も動く。そのまま当てると跳ねるので、ゆっくり寄せる。
        // ただし一枚目だけは即座に合わせる。ゆっくり寄せると、場つなぎの
        // 静止画から切り替わったあと数コマ位置が動いて、それが段差に見える
        if (!baseRadius) aim.copy(center);
        else aim.lerp(center, 0.08);
        model.position.set(-aim.x, -aim.y, -aim.z);

        let r = size.length() / 2;
        if (!baseRadius) baseRadius = r;
        r = Math.min(r, baseRadius * MAX_ZOOM_OUT);
        return (r / Math.sin((camera.fov * Math.PI) / 360)) * MARGIN;
      };
      let curDist = fitDistance();
      // 畳まれた姿のときのカメラの距離。質感の粗さを決める基準にする
      const dist0 = curDist;
      const place = () => {
        camera.position.copy(dir).multiplyScalar(curDist);
        camera.lookAt(0, 0, 0);
      };
      place();

      // 表示を大きくすると画素数が一気に増えて描画が追いつかなくなる。
      // 見た目の大きさはそのままに、中で持つ画素数だけ上限をかける。
      // canvas を舞台いっぱいに広げたので、上限も画面の幅に合わせて上げた（元は正方形で 1500）
      const MAX_PIXELS = 2000;
      let viewKey = "";
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
        // 縦横比は正方形の枠のもの（1）。canvas のどこを映すかは frameView() で決める
        camera.aspect = 1;
        viewKey = "";
        frameView();
      };
      /**
       * 正方形の枠が、canvas（舞台）のどこにどの大きさで見えているかを測り、
       * カメラの映す範囲をそこに合わせる。枠の外にはみ出した部分も、canvas の中なら描ける
       */
      const frameView = () => {
        const a = fr.getBoundingClientRect();
        const b = el.getBoundingClientRect();
        const sq = a.width || 1;
        const x = b.left - a.left;
        const y = b.top - a.top;
        const key = `${sq.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)} ${b.width} ${b.height}`;
        if (key === viewKey) return;
        viewKey = key;
        camera.setViewOffset(sq, sq, x, y, b.width || 1, b.height || 1);
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

      /** delta は「どちら回りに何度回すか」。近道が塞がっていれば遠回りを選ぶ */
      type Move = { at: number; dur: number; over: number; delta: number };
      type Plan = {
        from: number[];
        to: number[];
        mv: Move[];
        /** 関節が動き終わる時刻 */
        settled: number;
        /** 間をあけ終えて、次の形へ移る時刻 */
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

      /** index とは別のポーズを選ぶ */
      const pickOther = (index: number) => {
        // 畳まれた塊（0番）は作品の顔なので、3回に1回はそこへ戻す。
        // 完全な乱数だと、ほどけた形ばかりが続いて塊が出てこない。
        if (index !== 0 && Math.random() < 0.34) return 0;
        let next = index;
        while (next === index && POSES.length > 1)
          next = Math.floor(Math.random() * POSES.length);
        return next;
      };

      /**
       * めり込みを見るきざみ（度）。
       * これより粗いと、速く回したときに丸棒が互いをすり抜ける。
       */
      const SWEEP = 0.7;
      /** 1回の組み立てで判定を呼ぶ上限。重くなりすぎないための歯止め */
      const MAX_CHECKS = 260000;
      let checks = 0;

      const applyState = (st: number[]) => {
        for (let i = 0; i < cur.length; i++) cur[i] = st[i];
        setPose();
      };

      /**
       * 関節 i だけを delta 度ぶん回す。その途中でめり込まないか。
       * 他の関節は st のまま。
       */
      const sweepClean = (st: number[], i: number, delta: number) => {
        const steps = Math.max(1, Math.ceil(Math.abs(delta) / SWEEP));
        applyState(st);
        for (let n = 1; n <= steps; n++) {
          cur[i] = st[i] + (delta * n) / steps;
          setPose();
          if (++checks > MAX_CHECKS) return false;
          if (hits()) return false;
        }
        return true;
      };

      /**
       * 「どの関節を、どちら回りに、どの順で回すか」を見つける。
       *
       * ⚠️ 行き先のポーズが当たり判定を通っていても、そこへ至る“途中”は別物。
       *    混ざって見えていたのは、ここを見ていなかったため。
       *    一本ずつ順に回し、その一本ぶんの軌跡が通るものだけを採る。
       *    近道が塞がっていれば、反対回りも試す。
       *    順番に回すかぎり、この道筋は必ず安全。
       */
      const findRoute = (from: number[], to: number[]) => {
        const st = from.slice();
        const left: number[] = [];
        for (let i = 0; i < to.length; i++)
          if (Math.abs(shortest(st[i], to[i])) > 0.01) left.push(i);
        const route: { i: number; delta: number }[] = [];
        while (left.length) {
          let moved = false;
          for (const i of shuffle(left)) {
            const d = shortest(st[i], to[i]);
            const back = d > 0 ? d - 360 : d + 360; // 反対回り
            for (const delta of [d, back]) {
              if (!sweepClean(st, i, delta)) continue;
              st[i] += delta;
              route.push({ i, delta });
              left.splice(left.indexOf(i), 1);
              moved = true;
              break;
            }
            if (moved) break;
          }
          if (!moved) return null; // どの一本も動かせない
        }
        return route;
      };

      /**
       * 見つけた道筋に、見せ方（重なり・速さ・行き過ぎ）を付ける。
       * style が小さいほど重ねて速く、大きいほど順番に慎重に。
       * style 3 は完全に順番どおりで、道筋の安全がそのまま効く。
       */
      const schedule = (
        route: { i: number; delta: number }[],
        from: number[],
        to: number[],
        calm: boolean,
        style: number,
      ): Plan => {
        const mv: Move[] = joints.map(() => ({
          at: 0,
          dur: 0.001,
          over: 0,
          delta: 0,
        }));
        let t = 0;
        for (const r of route) {
          const dur = calm
            ? [0.3, 0.3, 0.26, 0.12][style]
            : [rnd(0.26, 0.55), rnd(0.24, 0.45), rnd(0.2, 0.36), 0.16][style];
          mv[r.i] = {
            at: t,
            dur,
            // 戻すときは行き過ぎさせない。すっと収める
            over:
              calm || style === 3
                ? 0
                : Math.random() < 0.6
                  ? rnd(0.04, 0.14)
                  : 0,
            delta: r.delta,
          };
          // 次の一本へ移るまで。負の重なりで「まとめて掴んだ」ように見せる
          const lead = calm
            ? [0.024, 0.05, 0.1, dur + 0.02][style]
            : [dur * 0.35, dur * 0.6, dur * 0.85, dur + 0.02][style];
          t += lead;
          // たまに手を止めて考える
          if (!calm && style < 2 && Math.random() < 0.1) t += rnd(0.2, 0.5);
        }
        let end = 0;
        for (const m of mv) end = Math.max(end, m.at + m.dur);
        // 形が決まったら、次の形へ移るまで少し間をあける（そのあいだは回転だけ）。
        // 単位はスクロールで進む「動きの秒数」
        const show = calm ? 0 : rnd(0.5, 1.1);
        const settled = end + (calm ? 0.05 : rnd(0.15, 0.5));
        return { from: from.slice(), to: to.slice(), mv, settled, total: settled + show };
      };

      /**
       * 重ねた動かし方が、途中で一度でもめり込まないかを通しで確かめる。
       * いちばん速い関節が SWEEP 度進むごとに見る。
       */
      const planIsClean = (p: Plan): boolean => {
        let maxSpeed = 0; // 度/秒
        let end = 0;
        for (const m of p.mv) {
          // settle の立ち上がりは平均の3倍。行き過ぎの揺り戻しもそのぶん速い
          const peak = 3 + m.over * Math.PI * 2;
          maxSpeed = Math.max(maxSpeed, (Math.abs(m.delta) / m.dur) * peak);
          end = Math.max(end, m.at + m.dur);
        }
        if (maxSpeed <= 0) return true;
        const steps = Math.min(
          9000,
          Math.ceil(end / (SWEEP / maxSpeed)) + 1,
        );
        for (let n = 0; n <= steps; n++) {
          const t = (end * n) / steps;
          for (let i = 0; i < p.mv.length; i++) {
            const m = p.mv[i];
            cur[i] = p.from[i] + m.delta * settle((t - m.at) / m.dur, m.over);
          }
          setPose();
          if (++checks > MAX_CHECKS) return false;
          if (hits()) return false;
        }
        return true;
      };

      /**
       * 動かないでいる区間。
       *
       * ⚠️ ここに cur をそのまま渡さないこと。
       *    道筋を探すあいだ cur は素振りで動かしている途中の姿になっている。
       *    それを掴むと、中途半端な（＝めり込んだ）姿で固まってしまい、
       *    次に動こうにも出発点がもう当たっているので二度と動けなくなる。
       *    必ず「素振りに入る前の姿」か、決まったポーズを渡す。
       */
      const holdPlan = (at: number[], len: number): Plan => ({
        from: at.slice(),
        to: at.slice(),
        mv: joints.map(() => ({ at: 0, dur: 0.001, over: 0, delta: 0 })),
        settled: 0.001,
        total: len,
      });

      /**
       * from → to の、めり込まない動かし方を作る。作れなければ null。
       * 重ねた案がめり込むなら、だんだん順番どおりに落としていく。
       * 最後の段（完全に順番どおり）は道筋そのものなので、まず通る。
       */
      const planBetween = (
        from: number[],
        to: number[],
        calm = false,
      ): Plan | null => {
        const keep = cur.slice();
        checks = 0;
        try {
          const route = findRoute(from, to);
          if (!route) return null;
          for (let style = 0; style < 4; style++) {
            const p = schedule(route, from, to, calm, style);
            // 最後の段は道筋そのものだが、ここも素通りさせずに確かめる
            if (planIsClean(p)) return p;
          }
          return null;
        } finally {
          applyState(keep);
        }
      };

      /**
       * 関節の動きは、時間ではなくスクロールで進める。
       *
       * スクロール量から「動きの時刻」motion（秒）を出し、
       * 形の移り変わりを一本の帯（legs）として並べておいて、
       * motion が帯のどこにいるかで姿を決める。
       *   ・スクロールを止めれば motion も止まる＝何も動かない
       *   ・上へ戻れば同じ帯を逆にたどる＝同じ動きの逆再生
       *     （行きでめり込まないと確かめた道筋を戻るだけなので、戻りも安全）
       * 帯は、必要になる少し手前で前にも後ろにも継ぎ足す。
       */
      type Leg = { start: number; plan: Plan; fromIndex: number; toIndex: number };
      const MOTION_PER_SCREEN = 0.6; // 画面の高さ1つぶんで進む「動きの秒数」（2では速すぎた）
      // 引ききったあと、ひとりでに進んだぶん（画面の高さ何個ぶんのスクロールに当たるか）。
      // スクロールで進んだぶんに足す。巻き戻すと、ここから逆再生になる
      let autoScreens = 0;
      // 手で曲げた手順を帯に織り込んだぶん、帯の上で先へ進める量（回転には足さない）
      let motionOffset = 0;
      const motionTarget = () =>
        (window.scrollY / Math.max(1, window.innerHeight) + autoScreens) *
          MOTION_PER_SCREEN +
        motionOffset;
      const legEnd = (l: Leg) => l.start + l.plan.total;
      const legs: Leg[] = [];
      /** 畳まれた塊を置いた motion の位置（「戻す」で巻き戻す先） */
      let anchorAt = 0;
      /** motion の位置に、畳まれた塊を置く */
      const anchor = (v: number) => {
        anchorAt = v;
        legs.length = 0;
        // 待ちは手前側にだけ置く。下へのスクロールでは、最初のひと送りから関節も動く
        legs.push({ start: v - 0.6, plan: holdPlan(POSES[0], 0.6), fromIndex: 0, toIndex: 0 });
      };
      const extendForward = () => {
        const last = legs[legs.length - 1];
        for (let n = 0; n < 3; n++) {
          const t = pickOther(last.toIndex);
          const p = planBetween(last.plan.to, POSES[t]);
          if (p) {
            legs.push({ start: legEnd(last), plan: p, fromIndex: last.toIndex, toIndex: t });
            return;
          }
        }
        legs.push({
          start: legEnd(last),
          plan: holdPlan(last.plan.to, 1),
          fromIndex: last.toIndex,
          toIndex: last.toIndex,
        });
      };
      /** 先頭の手前に「どこかの形 → 先頭の形」を足す。逆にたどれば先頭からそこへほどける */
      const extendBackward = () => {
        const first = legs[0];
        for (let n = 0; n < 3; n++) {
          const s = pickOther(first.fromIndex);
          const p = planBetween(POSES[s], first.plan.from);
          if (p) {
            legs.unshift({ start: first.start - p.total, plan: p, fromIndex: s, toIndex: first.fromIndex });
            return;
          }
        }
        legs.unshift({
          start: first.start - 1,
          plan: holdPlan(first.plan.from, 1),
          fromIndex: first.fromIndex,
          toIndex: first.fromIndex,
        });
      };
      const playPlan = (p: Plan, lt: number) => {
        joints.forEach((_, i) => {
          const m = p.mv[i];
          cur[i] = p.from[i] + m.delta * settle((lt - m.at) / m.dur, m.over);
        });
        setPose();
      };
      const poseAt = (v: number) => {
        // 帯の継ぎ足しは重いので、1フレームに1本まで。
        // 上端（スクロール0）より手前は見られないので、そこまでは足さない
        if (legEnd(legs[legs.length - 1]) < v + 3) extendForward();
        else if (legs[0].start > Math.max(v - 3, 0)) extendBackward();
        let leg = legs[0];
        for (const l of legs) {
          if (l.start <= v) leg = l;
          else break;
        }
        // 用意が追いつかないときは、帯の端の姿で待つ
        playPlan(leg.plan, Math.min(Math.max(v - leg.start, 0), leg.plan.total));
      };

      let motion = motionTarget();
      anchor(motion);

      /**
       * 「戻す」だけは、スクロールを待たずに時間で動かす。
       *   plan   … いまの姿から畳まれた塊へ、新しく道筋を作って戻す
       *   rewind … 道筋が作れなかったとき。これまでたどってきた帯を、畳まれた塊の位置まで
       *            早回しで巻き戻す（どれもめり込まないと確かめた動きなので、必ず戻れる）
       */
      type ResetLeg =
        | { kind: "plan"; plan: Plan; t0: number; total: number }
        | { kind: "rewind"; from: number; to: number; t0: number; total: number };
      let resetLeg: ResetLeg | null = null;
      /** 巻き戻しの長さ。帯が長くても、この秒数に収める */
      const REWIND_MAX = 2.4;

      // ボタンから呼ばれる。いまの姿を起点に、畳まれた塊へ戻す。
      // 戻し終わったら、その位置を新しい起点にして帯を張り直す
      const doReset = () => {
        if (resetLeg) return;
        // 触っている途中なら、そこまでを確定してから戻す
        endTouch();
        const t0 = performance.now() / 1000;
        // 形によっては、ぶつからずに畳む道筋が見つからない（以前はそのとき何も起きなかった）。
        // 静かな戻し方 → ふつうの戻し方 → 巻き戻し、の順に試す
        const p =
          planBetween(cur.slice(), POSES[0], true) ??
          planBetween(cur.slice(), POSES[0]);
        let settledIn: number;
        if (p) {
          resetLeg = { kind: "plan", plan: p, t0, total: p.total };
          settledIn = p.settled;
        } else {
          const dist = Math.abs(motion - anchorAt);
          const total = Math.min(REWIND_MAX, Math.max(0.8, dist));
          resetLeg = { kind: "rewind", from: motion, to: anchorAt, t0, total };
          settledIn = total;
        }
        autoHoldAt = window.scrollY;
        autoResumeAt = null; // 2秒待ちの途中でもう一度押されたら、数え直す
        spinVel = 0;
        // いちばん近い正面へ。行きすぎず戻りすぎず、最短で合わせる。
        // 見えている向きは「戻しの角度＋スクロールぶん」なので、その合計が正面に来るようにする
        spinFrom = spinAngle;
        spinTo = Math.round((spinAngle + scrollAngle) / TAU) * TAU - scrollAngle;
        spinStart = t0;
        spinDur = settledIn;
      };
      resetRef.current = doReset;
      unregister = addResetter(doReset);
      let spinAngle = 0; // 「戻す」で向きを合わせたぶん。ふだんは動かさない
      const TAU = Math.PI * 2;
      /**
       * 「戻す」のあいだだけ、向きも立ち上がりの角度へ寄せる。
       *
       * 塊は立方体に近いので、同じ形でも向きしだいで見かけの幅が17%変わる。
       * 形だけ戻して向きを放っておくと「大きくなった」ように見える。
       * 戻り終わりでちょうど正面（2πの倍数）に来るようにする。
       */
      let spinFrom = 0;
      let spinTo = 0;
      let spinStart = 0;
      let spinDur = 0;

      /**
       * スクロールした量だけ回す（isnome.com の背景を参考に）。
       * 画面の高さぶん下へ送ると、0.15周。上へ戻せば逆に回って戻る。
       * （1周、0.4周と試して、どちらもスクロールに対して速すぎた）
       * スクロールしていないときは回さない（自転はしない）。
       */
      // 画面の高さ1つぶんで回る角度。スマホは最初の場面が短いので、別の速さにできる（motion.ts）
      const phone = matchMedia("(max-width: 767px)");
      const turnPerScreen = () => TAU * (phone.matches ? mobileLayout.turn : heroTurn.pc);
      const scrollTarget = () =>
        (window.scrollY / Math.max(1, window.innerHeight) + autoScreens) *
        turnPerScreen();
      // 「はじめのかたちに戻す」を押したら、戻り終わってから2秒は、ひとりでには動かさない
      // （押した直後にまたほどけ出すと、戻した意味がなくなる）。
      // 2秒たつか、その前にスクロールしたら、また動き出す（2026-11-09 ユーザー指定。最初は3秒）
      const AUTO_RESUME_AFTER = 2;
      let autoHoldAt: number | null = null;
      let autoResumeAt: number | null = null;
      let scrollAngle = scrollTarget();
      let lastT = performance.now() / 1000;

      /**
       * 触って動かす（2026-11-09「自分で触ったら動かすこともできるようにしたい」）。
       *   ふだん   … つかんだ部品を、そのすぐ手前の関節で曲げる。ぶつかる手前で止まる
       *              （2案を見比べて、ユーザーがこちらに決めた）
       *   ?touch=1 … 見比べ用に残した案。つかんで回す。離すと惰性で少し回って止まる
       *   ?touch=0 … 触っても動かない
       * スマホでは縦の指の動きはスクロールに残し、横に動かしたときだけ受け取る。
       * ボタンやリンクの上で押したときは、そちらを優先する。
       */
      const touchMode = new URLSearchParams(location.search).get("touch");
      const SPIN = touchMode === "1";
      const BEND = touchMode !== "1" && touchMode !== "0";
      // 立体はページ全体の後ろに敷いた層にいて、指やマウスはその上の本文に当たる。
      // そのため窓全体で受け、立体が見えている所で押されたときだけ掴む
      const root = document.documentElement;
      /**
       * そこで押しても立体を掴まない所。
       *   ・ボタン、リンク、入力欄（そちらの操作を優先する）
       *   ・文字の上（文字を選べるように残す）
       *   ・色の付いた面や写真の上（その後ろの立体は隠れていて見えない）
       */
      const blocked = (tg: Element | null) => {
        if (!tg) return true;
        if (tg.closest("button,a,input,select,textarea,label,summary,dialog,img,video,svg"))
          return true;
        for (const n of tg.childNodes)
          if (n.nodeType === 3 && n.textContent?.trim()) return true;
        // スマホの重なってくるカード（地は疑似要素なので、下の色の判定では拾えない）
        const card = tg.closest(".card-m");
        if (card && getComputedStyle(card).position === "sticky") return true;
        // 地のある所（立体は影としてしか見えていない）
        const shade = tg.closest(".sheet,.shade-sheet,.shade-lift");
        if (shade && getComputedStyle(shade, "::before").content !== "none") return true;
        for (let x: Element | null = tg; x && x !== document.body && x !== root; x = x.parentElement) {
          const cs = getComputedStyle(x);
          const bg = cs.backgroundColor;
          if (bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") return true;
          if (cs.backgroundImage !== "none") return true;
        }
        return false;
      };
      const ray = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      const pick = (cx: number, cy: number) => {
        const r = el.getBoundingClientRect();
        ndc.set(
          ((cx - r.left) / (r.width || 1)) * 2 - 1,
          -((cy - r.top) / (r.height || 1)) * 2 + 1,
        );
        pivot.updateMatrixWorld(true);
        ray.setFromCamera(ndc, camera);
        return ray.intersectObject(model, true)[0] ?? null;
      };
      /** 画面上の位置（canvas の左上から何px） */
      const toScreen = (v: THREE_T.Vector3, out: THREE_T.Vector2) => {
        const r = el.getBoundingClientRect();
        const p = v.clone().project(camera);
        return out.set(((p.x + 1) / 2) * r.width, ((1 - p.y) / 2) * r.height);
      };

      // ── 回す
      let spinVel = 0; // 離したあとの惰性（ラジアン/秒）
      let tilt = 0; // 上下の傾き。離すとゆっくり水平へ戻る
      let spinDrag: { x: number; y: number; t: number; touch: boolean } | null = null;
      const spinPerPx = () => (Math.PI * 2) / Math.max(600, el.clientWidth);

      // ── 曲げる
      type BendMove = { i: number; delta: number };
      /** 曲げ始めた帯の位置・そのときの姿・曲げた手順（どれもぶつからないと確かめた動き） */
      let bend: { v0: number; from: number[]; log: BendMove[] } | null = null;
      let bendGrab: { i: number; local: THREE_T.Vector3; x: number; y: number } | null = null;
      /** 離したあと、45度の刻みへ収める動き */
      let snap: { i: number; from: number; to: number; t0: number } | null = null;
      const SNAP_DUR = 0.22;
      const axisW = new THREE.Vector3();
      const jointW = new THREE.Vector3();
      const grabW = new THREE.Vector3();
      const sa = new THREE.Vector2();
      const sb = new THREE.Vector2();
      /** 関節 i を、いまの角度から delta 度ぶん回す。ぶつかる手前で止め、実際に回せた量を返す */
      const turnJoint = (i: number, delta: number) => {
        const start = cur[i];
        const steps = Math.max(1, Math.ceil(Math.abs(delta) / SWEEP));
        let ok = 0;
        for (let n = 1; n <= steps; n++) {
          cur[i] = start + (delta * n) / steps;
          setPose();
          if (hits()) break;
          ok = n;
        }
        cur[i] = start + (delta * ok) / steps;
        setPose();
        return cur[i] - start;
      };
      /** 曲げた手順を帯に織り込む。曲げ始めた位置から先を「曲げた手順 → その先」に張り替える */
      const commitBend = () => {
        if (!bend) return;
        if (snap) {
          bend.log.push({ i: snap.i, delta: cur[snap.i] - snap.from });
          snap = null;
        }
        const { v0, from, log } = bend;
        bend = null;
        bendGrab = null;
        // 同じ関節が続いた分はまとめる（行って戻った範囲は確かめ済みなので、まとめても安全）
        const moves: BendMove[] = [];
        for (const m of log) {
          const last = moves[moves.length - 1];
          if (last && last.i === m.i) last.delta += m.delta;
          else moves.push({ ...m });
        }
        const real = moves.filter((m) => Math.abs(m.delta) > 0.01);
        if (!real.length) return;
        // 曲げ始めた位置で帯を切る
        let k = 0;
        for (let n = 0; n < legs.length; n++) if (legs[n].start <= v0) k = n;
        legs.length = k + 1;
        const leg = legs[k];
        const lt0 = Math.min(Math.max(v0 - leg.start, 0), leg.plan.total);
        leg.plan = {
          ...leg.plan,
          to: from.slice(),
          settled: Math.min(leg.plan.settled, lt0),
          total: lt0,
        };
        leg.toIndex = -1;
        // 1つの区間に同じ関節は1回まで（schedule の作り）。重なったら区間を分ける
        let t = legEnd(leg);
        let st = from.slice();
        let chunk: BendMove[] = [];
        const flush = () => {
          if (!chunk.length) return;
          const to = st.slice();
          for (const m of chunk) to[m.i] += m.delta;
          const p = schedule(chunk, st, to, true, 3);
          legs.push({ start: t, plan: p, fromIndex: -1, toIndex: -1 });
          t += p.total;
          st = to;
          chunk = [];
        };
        for (const m of real) {
          if (chunk.some((c) => c.i === m.i)) flush();
          chunk.push(m);
        }
        flush();
        // 帯の上で、いまの姿（曲げ終わり）の位置へ移る
        motionOffset += t - motionTarget();
        motion = t;
        // 離してから少し待って、またひとりでに動き出す
        autoHoldAt = window.scrollY;
        autoResumeAt = performance.now() / 1000 + AUTO_RESUME_AFTER;
      };
      /** 触っているのを終える（「戻す」を押されたときなど） */
      const endTouch = () => {
        spinDrag = null;
        commitBend();
      };

      const onDown = (e: PointerEvent) => {
        if (!SPIN && !BEND) return;
        if (resetLeg || spinDur > 0 || snap) return;
        if (e.button !== 0) return;
        const tg = e.target as Element | null;
        if (blocked(tg)) return;
        const hit = pick(e.clientX, e.clientY);
        if (!hit) return;
        e.preventDefault();
        try {
          tg?.setPointerCapture(e.pointerId);
        } catch {}
        const touch = e.pointerType !== "mouse";
        if (SPIN) {
          spinDrag = { x: e.clientX, y: e.clientY, t: performance.now(), touch };
          spinVel = 0;
        } else {
          // つかんだ部品を動かす関節＝部品のすぐ親の関節
          let o: THREE_T.Object3D | null = hit.object;
          while (o && !/^J\d\d$/.test(o.name)) o = o.parent;
          const i = o ? joints.indexOf(o) : -1;
          if (i < 0) return;
          if (!bend) bend = { v0: motion, from: cur.slice(), log: [] };
          bendGrab = { i, local: o!.worldToLocal(hit.point.clone()), x: e.clientX, y: e.clientY };
        }
        root.style.cursor = "grabbing";
      };
      let hoverQueued = false;
      const onMove = (e: PointerEvent) => {
        if (spinDrag) {
          const now = performance.now();
          const dx = e.clientX - spinDrag.x;
          const dy = spinDrag.touch ? 0 : e.clientY - spinDrag.y;
          const k = spinPerPx();
          spinAngle += dx * k;
          tilt = Math.min(0.8, Math.max(-0.8, tilt + dy * k));
          const dts = Math.max(1, now - spinDrag.t) / 1000;
          spinVel = spinVel * 0.5 + ((dx * k) / dts) * 0.5;
          spinDrag.x = e.clientX;
          spinDrag.y = e.clientY;
          spinDrag.t = now;
          return;
        }
        if (bendGrab && bend) {
          const g = bendGrab;
          const j = joints[g.i];
          pivot.updateMatrixWorld(true);
          j.getWorldPosition(jointW);
          axisW.setFromMatrixColumn(j.matrixWorld, 2).normalize();
          grabW.copy(g.local);
          j.localToWorld(grabW);
          // つかんだ点が、関節を 1 ラジアン回すと画面でどちらへ何px動くか
          const tan = axisW.clone().cross(grabW.clone().sub(jointW));
          toScreen(grabW, sa);
          toScreen(grabW.clone().addScaledVector(tan, 0.01), sb);
          const tx = (sb.x - sa.x) / 0.01;
          const ty = (sb.y - sa.y) / 0.01;
          const len2 = tx * tx + ty * ty;
          const dx = e.clientX - g.x;
          const dy = e.clientY - g.y;
          g.x = e.clientX;
          g.y = e.clientY;
          if (len2 < 16) return; // 軸を真上から見ている所。どちらへ回すか決まらない
          const rad = (dx * tx + dy * ty) / len2;
          const deg = Math.max(-30, Math.min(30, (rad * 180) / Math.PI));
          const done = turnJoint(g.i, deg);
          if (done) bend.log.push({ i: g.i, delta: done });
          return;
        }
        // 立体の上では、つかめる手の形に
        // （当たりを調べるのは重いので、1フレームに1回まで）
        if (e.pointerType === "mouse" && (SPIN || BEND) && !snap && !hoverQueued) {
          hoverQueued = true;
          const x = e.clientX;
          const y = e.clientY;
          requestAnimationFrame(() => {
            hoverQueued = false;
            if (spinDrag || bendGrab) return;
            const over = document.elementFromPoint(x, y);
            root.style.cursor = !blocked(over) && pick(x, y) ? "grab" : "";
          });
        }
      };
      const onUp = () => {
        if (spinDrag) {
          // 止めてから離したときは、惰性をつけない
          if (performance.now() - spinDrag.t > 80) spinVel = 0;
          spinDrag = null;
        }
        if (bendGrab && bend) {
          const i = bendGrab.i;
          bendGrab = null;
          // 45度の刻みへ収める（決まったポーズはどれもこの刻み）。近い側がぶつかるなら反対側
          const a = cur[i];
          const near = Math.round(a / 45) * 45;
          const far = near + (a > near ? 45 : -45);
          const keep = cur.slice();
          let to: number | null = null;
          for (const c of [near, far]) {
            const d = turnJoint(i, c - a);
            const reached = Math.abs(d - (c - a)) < 1e-6;
            applyState(keep);
            if (reached) {
              to = c;
              break;
            }
          }
          if (to !== null && Math.abs(to - a) > 0.01)
            snap = { i, from: a, to, t0: performance.now() / 1000 };
          else commitBend();
        }
        root.style.cursor = "";
      };
      if (SPIN || BEND) {
        // 縦の指の動きはスクロールに残す
        root.style.touchAction = "pan-y pinch-zoom";
        window.addEventListener("pointerdown", onDown);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
      }
      const removeTouch = () => {
        window.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        root.style.touchAction = "";
        root.style.cursor = "";
      };

      renderer.setAnimationLoop(() => {
        const nowSec = performance.now() / 1000;
        const dt = Math.min(0.05, nowSec - lastT);
        lastT = nowSec;

        // 回転も関節も、スクロールに少し遅れて追いつく（約0.4秒で8割）。
        // 指やホイールの刻みでカクつかず、止めたあとは惰性で落ち着いて止まる
        const k = 1 - Math.exp(-dt * 4);
        if (
          autoHoldAt !== null &&
          (Math.abs(window.scrollY - autoHoldAt) > 2 ||
            (autoResumeAt !== null && nowSec >= autoResumeAt))
        ) {
          autoHoldAt = null;
          autoResumeAt = null;
        }
        // 手で曲げているあいだは、帯の上で止めておく
        const bending = bend !== null;
        if (heroMotion.settled && !resetLeg && autoHoldAt === null && !bending)
          autoScreens += dt * heroMotion.autoSpeed;
        if (!bending) motion += (motionTarget() - motion) * k;
        scrollAngle += (scrollTarget() - scrollAngle) * k;

        if (resetLeg) {
          const lt = nowSec - resetLeg.t0;
          if (resetLeg.kind === "plan") playPlan(resetLeg.plan, lt);
          else {
            const u = Math.min(1, lt / resetLeg.total);
            // ゆっくり出て、ゆっくり止まる
            const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
            poseAt(resetLeg.from + (resetLeg.to - resetLeg.from) * e);
          }
          if (lt >= resetLeg.total) {
            resetLeg = null;
            anchor(motion);
            if (autoHoldAt !== null) autoResumeAt = nowSec + AUTO_RESUME_AFTER;
          }
        } else if (snap) {
          const u = Math.min(1, (nowSec - snap.t0) / SNAP_DUR);
          cur[snap.i] = snap.from + (snap.to - snap.from) * settle(u, 0);
          setPose();
          if (u >= 1) {
            cur[snap.i] = snap.to;
            setPose();
            commitBend();
          }
        } else if (!bending) {
          poseAt(motion);
        }

        // 大きさが変わるので、距離を追いかける。
        // 戻すあいだは速く寄る。ふだんの追いかけ方だと関節が畳み終わってからも
        // 1秒ほどカメラだけ動き続けて、「シュッと戻った」感じにならない
        const want = fitDistance();
        curDist += (want - curDist) * (spinDur > 0 ? 0.34 : 0.13);
        place();

        // 真ん中を軸に回す。揺らぎは入れない（軸がぶれて見えるため）。
        if (spinDur > 0) {
          const s = (nowSec - spinStart) / spinDur;
          if (s >= 1) {
            spinAngle = spinTo;
            spinDur = 0;
          } else {
            spinAngle = spinFrom + (spinTo - spinFrom) * settle(s, 0);
          }
        } else if (!spinDrag && spinVel !== 0) {
          // 離したあとの惰性。だんだん弱まって止まる
          spinAngle += spinVel * dt;
          spinVel *= Math.exp(-dt * 2.5);
          if (Math.abs(spinVel) < 0.01) spinVel = 0;
        }
        if (!spinDrag && tilt !== 0) {
          tilt *= Math.exp(-dt * 2);
          if (Math.abs(tilt) < 0.0005) tilt = 0;
        }
        pivot.rotation.y = spinAngle + scrollAngle;
        frameView();
        // 外側の CSS で枠が縮められている割合を測る
        {
          const zr = fr.offsetWidth
            ? fr.getBoundingClientRect().width / fr.offsetWidth
            : 1;
          const cr = Math.min(1, dist0 / curDist);
          if (Math.abs(zr - zoom) > 0.004 || Math.abs(cr - cam) > 0.004) {
            zoom = zr;
            cam = cr;
            setSilver(silver, silverTarget, zoom, cam);
          }
        }
        pivot.rotation.x = tilt;
        renderer.render(scene, camera);
      });

      // 開発時だけ、場つなぎの静止画（public/img/form-hero.webp）を焼き直す口を出す。
      // ページの一番上で呼ぶと、開いた瞬間と同じ姿・同じ向きの絵が透過PNGで返る
      if (process.env.NODE_ENV !== "production") {
        (window as unknown as { __heroSnap__?: () => string }).__heroSnap__ = () => {
          // 静止画は正方形の枠そのもの。いったん canvas を正方形にして撮り、元に戻す
          renderer.setPixelRatio(1);
          renderer.setSize(1530, 1530, false);
          camera.clearViewOffset();
          camera.updateProjectionMatrix();
          renderer.render(scene, camera);
          const url = renderer.domElement.toDataURL("image/png");
          resize();
          return url;
        };
        /**
         * ページの写真（形の5連・近くで見る・台座の一枚）を、いまの立体と同じ見た目で撮る口。
         * 2026-11-09「立体の色味が正解なので、写真をそれに合わせて」。
         *   pose … 30個の関節角度（度）
         *   dir  … カメラを置く向き（立体の中心から見て）
         *   fill … 形の外接球の半径に対する近さ（1 で収まる、大きいほど寄る）
         *   dist … カメラの距離をじかに決める（形ごとに大きさを変えず、同じ縮尺で並べたいとき）
         *   look … 画面の中心にする点を、外接球の半径の何倍ずらすか [x, y, z]
         *   zoom … 質感の粗さ（setSilver の画面で見た大きさ。1 で寄り、小さいほど引きの質感）
         *   bg   … 地の色。省くと透過
         */
        /** 撮る形を探す口。その姿でめり込むか・両端の離れ具合（外接球の半径に対して）・大きさを返す */
        (window as unknown as { __heroProbe__?: unknown }).__heroProbe__ = (pose: number[]) => {
          const keep = cur.slice();
          for (let i = 0; i < cur.length; i++) cur[i] = pose[i] ?? 0;
          setPose();
          const hit = hits();
          pivot.updateMatrixWorld(true);
          box.setFromObject(model);
          box.getSize(size);
          const a = joints[0].getWorldPosition(new THREE.Vector3());
          const b = meshes[meshes.length - 1].getWorldPosition(new THREE.Vector3());
          const r = size.length() / 2;
          for (let i = 0; i < cur.length; i++) cur[i] = keep[i];
          setPose();
          return { hit, r, gap: a.distanceTo(b) / r, size: [size.x / r, size.y / r, size.z / r] };
        };
        (window as unknown as { __heroShot__?: unknown }).__heroShot__ = (o: {
          pose: number[];
          dir: number[];
          w: number;
          h: number;
          fill?: number;
          dist?: number;
          fov?: number;
          look?: number[];
          zoom?: number;
          bg?: string;
        }) => {
          const keepCur = cur.slice();
          const keepPos = model.position.clone();
          const keepRot = pivot.rotation.clone();
          const keepCam = camera.position.clone();
          const keepFov = camera.fov;
          for (let i = 0; i < cur.length; i++) cur[i] = o.pose[i] ?? 0;
          setPose();
          pivot.rotation.set(0, 0, 0);
          model.position.set(0, 0, 0);
          pivot.updateMatrixWorld(true);
          box.setFromObject(model);
          box.getCenter(center);
          box.getSize(size);
          model.position.set(-center.x, -center.y, -center.z);
          const r = size.length() / 2;
          camera.fov = o.fov ?? keepFov;
          const d = o.dist ?? r / Math.sin((camera.fov * Math.PI) / 360) / (o.fill ?? 1);
          const v = new THREE.Vector3(o.dir[0], o.dir[1], o.dir[2]).normalize();
          const at = new THREE.Vector3(...(o.look ?? [0, 0, 0])).multiplyScalar(r);
          camera.position.copy(v).multiplyScalar(d).add(at);
          camera.lookAt(at);
          setSilver(silver, silverTarget, o.zoom ?? 1, 1);
          renderer.setPixelRatio(1);
          renderer.setSize(o.w, o.h, false);
          camera.aspect = o.w / o.h;
          camera.clearViewOffset();
          camera.updateProjectionMatrix();
          if (o.bg) renderer.setClearColor(o.bg, 1);
          renderer.render(scene, camera);
          const url = renderer.domElement.toDataURL("image/png");
          // 元に戻す
          renderer.setClearColor(0x000000, 0);
          camera.fov = keepFov;
          camera.position.copy(keepCam);
          model.position.copy(keepPos);
          pivot.rotation.copy(keepRot);
          for (let i = 0; i < cur.length; i++) cur[i] = keepCur[i];
          setPose();
          zoom = -1; // 次のコマで質感を当て直させる
          resize();
          return url;
        };
      }

      setReady(true);
      cleanup = () => {
        resetRef.current = null;
        delete (window as unknown as { __resetHeroForm__?: () => void })
          .__resetHeroForm__;
        delete (window as unknown as { __heroSilver__?: unknown }).__heroSilver__;
        renderer.setAnimationLoop(null);
        removeTouch();
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
      unregister?.();
      cleanup?.();
    };
  }, [stage]);

  // 外側は渡された配置をそのまま使う。ここに relative を足すと
  // absolute と競合して配置が丸ごと壊れる
  return (
    <div className={className}>
      <div className="relative">
        {/* 準備ができるまでの場つなぎ。
            この静止画は立体そのものを焼いたもの（同じ光・同じ角度・同じ姿）。
            別に作った絵を置くと、色も影も違うので「別のもの」が一瞬映る。
            差し替えるときは 3D を止めて焼き直すこと。
            重ねて薄めない（クロスフェードしない）。光の当たり方だけはわずかに
            違うので、重ねると二重写りに見える。ほぼ同じ絵なので、切り替えは一瞬でよい。
            枠は正方形で確保し、canvas と同じ場所・同じ大きさで重ねる。
            影（.cutout）は付けない。立体の側に影がないので、そこで差が出る。 */}
        <div ref={frame} aria-hidden className="aspect-square w-full" />
        <img
          src="/img/form-hero.webp"
          alt="つや消しの銀色をした、用途の定まらないかたち"
          decoding="async"
          data-ready={ready}
          className="absolute inset-0 h-full w-full data-[ready=true]:opacity-0"
        />
        {stage ? (
          createPortal(
            <div
              ref={holder}
              data-ready={ready}
              aria-hidden
              className="pointer-events-none absolute inset-0 z-0 opacity-0 data-[ready=true]:opacity-100"
            />,
            stage,
          )
        ) : (
          <div
            ref={holder}
            data-ready={ready}
            aria-hidden
            className="absolute inset-0 opacity-0 data-[ready=true]:opacity-100"
          />
        )}

        {/* 押すと畳まれた塊へ戻る。
            立体は画面いっぱいに大きいので、その「下」に置くと画面外へ出る。
            枠の内側、下端に重ねて置く。
            立体は pointer-events-none で敷いてあるので、ここだけ触れるようにする */}
        <GrainTuner />
        <TextTuner />

        {showReset && (
        <div className="pointer-events-auto absolute inset-x-0 bottom-[6%] z-10 flex justify-center">
        <button
          type="button"
          disabled={!ready}
          onClick={() => {
            resetRef.current?.();
            setResetting(true);
            window.setTimeout(() => setResetting(false), 1400);
          }}
          className="btn-line min-h-10 px-5 text-[0.6875rem] tracking-[0.16em]
                     disabled:pointer-events-none disabled:opacity-0
                     transition-opacity duration-700"
        >
            {resetting ? "もどしています" : "はじめのかたちに戻す"}
          </button>
        </div>
        )}
      </div>
    </div>
  );
}

/**
 * かたちを戻すボタン。
 * 立体が画面いっぱいに大きいので、その中に置くと画面外へ出てしまう。
 * デスクトップでは本文の下に置き、window 経由で立体へ伝える。
 */
export function ResetFormButton({ className = "" }: { className?: string }) {
  const [alive, setAlive] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    // 立体の準備ができるまでボタンを出さない
    const sync = () => setAlive(resetters.size > 0);
    sync();
    watchers.add(sync);
    return () => {
      watchers.delete(sync);
    };
  }, []);

  if (!alive) return null;

  return (
    <button
      type="button"
      onClick={() => {
        // 隠れているほうも一緒に戻す。どちらが見えているかはここでは決めない
        resetters.forEach((fn) => fn());
        setResetting(true);
        window.setTimeout(() => setResetting(false), 1400);
      }}
      className={`btn-line min-h-10 px-5 text-[0.6875rem] tracking-[0.16em] ${className}`}
    >
      {resetting ? "もどしています" : "はじめのかたちに戻す"}
    </button>
  );
}
