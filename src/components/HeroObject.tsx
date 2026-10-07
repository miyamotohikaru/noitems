"use client";

import { useEffect, useRef, useState } from "react";
// 実体は動的に読み込む。型だけ静的に借りる
import type * as THREE_T from "three";
import { LOOK, applyLook } from "@/lib/sykim/look";
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
}: {
  className?: string;
  /** 立体の中にボタンを重ねるか。デスクトップは本文側に別途置くので false */
  showReset?: boolean;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  /** ボタンから「元の形へ戻す」を呼ぶための受け皿 */
  const resetRef = useRef<(() => void) | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;

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

      // ── 素材（元ファイルの見た目をそのまま当てる）
      // あわせて丸棒を「繋がっている順」に集める。めり込み判定がこの並びを使う
      let baseMat: THREE_T.MeshStandardMaterial | null = null;
      const meshes: THREE_T.Mesh[] = [];
      model.traverse((o) => {
        const m = o as THREE_T.Mesh;
        if (!m.isMesh || !m.material || m.name.startsWith("seam")) return;
        if (!baseMat) {
          baseMat = m.material as THREE_T.MeshStandardMaterial;
          applyLook(THREE, baseMat, L);
        }
        m.material = baseMat!;
        (m.material as THREE_T.Material).side = THREE.FrontSide;
        meshes.push(m);
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

      /** 行き先のポーズを選ぶ。ここでは planIndex をまだ書き換えない */
      const pickNext = () => {
        // 畳まれた塊（0番）は作品の顔なので、3回に1回はそこへ戻す。
        // 完全な乱数だと、ほどけた形ばかりが続いて塊が出てこない。
        if (planIndex !== 0 && Math.random() < 0.34) return 0;
        let next = planIndex;
        while (next === planIndex && POSES.length > 1)
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
        // 形が決まったら、そのまま止めずに、ぐるりと回して見せる
        const show = calm ? 7.5 : rnd(2.6, 4.4);
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

      /** 動かないでいるときの中身 */
      const holdPlan = (calm: boolean): Plan => ({
        from: cur.slice(),
        to: cur.slice(),
        mv: joints.map(() => ({ at: 0, dur: 0.001, over: 0, delta: 0 })),
        settled: 0.001,
        total: calm ? 7.5 : 3,
      });

      /**
       * 行き先を決め、安全な道筋を見つけ、見せ方を付ける。
       * 重ねた案がめり込むなら、だんだん順番どおりに落としていく。
       * 最後の段（完全に順番どおり）は道筋そのものなので必ず通る。
       */
      const makePlan = (forceIndex?: number, calm = false): Plan => {
        const keep = cur.slice();
        checks = 0;
        try {
          const targets =
            forceIndex !== undefined
              ? [forceIndex]
              : [pickNext(), pickNext(), pickNext()];
          for (const target of targets) {
            const from = planFrom.slice();
            const to = POSES[target].slice();
            const route = findRoute(from, to);
            if (!route) continue;
            for (let style = 0; style < 4; style++) {
              const p = schedule(route, from, to, calm, style);
              // 最後の段は道筋そのものだが、ここも素通りさせずに確かめる
              if (planIsClean(p)) {
                planIndex = target;
                return p;
              }
            }
          }
          return holdPlan(calm);
        } finally {
          applyState(keep);
        }
      };

      let plan = makePlan();
      let legStart = performance.now() / 1000;

      // ボタンから呼ばれる。いまの姿を起点に、畳まれた塊へ戻す。
      // デスクトップはボタンが本文側にあるので、窓口を window にも出す
      const doReset = () => {
        planFrom = cur.slice();
        plan = makePlan(0, true);
        legStart = performance.now() / 1000;
        // いちばん近い正面へ。行きすぎず戻りすぎず、最短で合わせる
        spinFrom = spinAngle;
        spinTo = Math.round(spinAngle / TAU) * TAU;
        spinStart = legStart;
        spinDur = plan.settled;
      };
      resetRef.current = doReset;
      unregister = addResetter(doReset);
      let spinAngle = 0; // 回した角度。積み上げるだけで巻き戻さない
      const SPIN_SPEED = (Math.PI * 2) / 14; // 1周14秒。速さも向きも変えない
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
      let lastT = performance.now() / 1000;
      const start = performance.now();

      let frameNo = 0;
      let lastLegTime = 0;
      if (process.env.NODE_ENV !== "production") {
        const w = window as unknown as { __heroState__?: (() => unknown)[] };
        (w.__heroState__ ||= []).push(() => ({
          frameNo,
          legTime: lastLegTime,
          total: plan.total,
          settled: plan.settled,
          hold: plan.mv.every((m) => m.delta === 0),
          maxDelta: Math.max(...plan.mv.map((m) => Math.abs(m.delta))),
          cur: cur.slice(),
          planFrom: plan.from.slice(),
          planTo: plan.to.slice(),
        }));
      }
      renderer.setAnimationLoop(() => {
        frameNo++;
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

        lastLegTime = legTime;
        joints.forEach((_, i) => {
          const m = plan.mv[i];
          const k = settle((legTime - m.at) / m.dur, m.over);
          cur[i] = plan.from[i] + m.delta * k;
        });
        setPose();

        // 大きさが変わるので、距離を追いかける。
        // 戻すあいだは速く寄る。ふだんの追いかけ方だと関節が畳み終わってからも
        // 1秒ほどカメラだけ動き続けて、「シュッと戻った」感じにならない
        const want = fitDistance();
        curDist += (want - curDist) * (spinDur > 0 ? 0.34 : 0.13);
        place();

        // 真ん中を軸に、一定の速さで回し続ける。
        // 揺らぎは入れない（軸がぶれて見えるため）。
        if (spinDur > 0) {
          const k = (nowSec - spinStart) / spinDur;
          if (k >= 1) {
            spinAngle = spinTo;
            spinDur = 0;
          } else {
            spinAngle = spinFrom + (spinTo - spinFrom) * settle(k, 0);
          }
        } else {
          spinAngle += SPIN_SPEED * dt;
        }
        pivot.rotation.y = spinAngle;
        pivot.rotation.x = 0;
        renderer.render(scene, camera);
      });

      setReady(true);
      cleanup = () => {
        resetRef.current = null;
        delete (window as unknown as { __resetHeroForm__?: () => void })
          .__resetHeroForm__;
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
      unregister?.();
      cleanup?.();
    };
  }, []);

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
        <div aria-hidden className="aspect-square w-full" />
        <img
          src="/img/form-hero.webp"
          alt="つや消しの銀色をした、用途の定まらないかたち"
          decoding="async"
          data-ready={ready}
          className="absolute inset-0 h-full w-full data-[ready=true]:opacity-0"
        />
        <div
          ref={holder}
          data-ready={ready}
          aria-hidden
          className="absolute inset-0 opacity-0 data-[ready=true]:opacity-100"
        />

        {/* 押すと畳まれた塊へ戻る。
            立体は画面いっぱいに大きいので、その「下」に置くと画面外へ出る。
            枠の内側、下端に重ねて置く。
            立体は pointer-events-none で敷いてあるので、ここだけ触れるようにする */}
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
