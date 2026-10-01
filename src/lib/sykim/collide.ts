import type * as THREE_T from "three";

/**
 * パーツ同士がめり込んでいないかを見る。
 *
 * 元のビューア（project-itm02/SYKIM_ビューア.html）の hits() をそのまま移したもの。
 * 丸棒を1本ずつカプセル（線分＋半径）に見立てて、線分同士の最短距離を測る。
 *
 * ⚠️ 隣り合うパーツは元から接しているので、2つ以上離れた組だけを見る。
 *    そのため meshes は「繋がっている順」で渡すこと。
 *    GLB を traverse した順がその並びになっている。
 */

/** 0.5mm（ワールド1.0 = 100mm）。これ以上めり込んだら当たり */
const HIT_TOL = 0.005;

type Cap = { a: THREE_T.Vector3; b: THREE_T.Vector3; r: number };
type CapW = {
  a: THREE_T.Vector3;
  b: THREE_T.Vector3;
  c: THREE_T.Vector3;
  r: number;
  h: number;
};

/** 線分と線分の最短距離 */
function segDist(
  p1: THREE_T.Vector3,
  q1: THREE_T.Vector3,
  p2: THREE_T.Vector3,
  q2: THREE_T.Vector3,
  tmp: { d1: THREE_T.Vector3; d2: THREE_T.Vector3; r: THREE_T.Vector3; x: THREE_T.Vector3; y: THREE_T.Vector3 },
) {
  const d1 = tmp.d1.copy(q1).sub(p1);
  const d2 = tmp.d2.copy(q2).sub(p2);
  const r = tmp.r.copy(p1).sub(p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  const EPS = 1e-12;
  let s: number;
  let t: number;
  if (a <= EPS && e <= EPS) return r.length();
  if (a <= EPS) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = d1.dot(r);
    if (e <= EPS) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = d1.dot(d2);
      const den = a * e - b * b;
      s = den !== 0 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  return tmp.x
    .copy(p1)
    .addScaledVector(d1, s)
    .distanceTo(tmp.y.copy(p2).addScaledVector(d2, t));
}

/**
 * めり込み判定を作る。
 * 返ってきた関数は「いまの姿勢でどこかがめり込んでいるか」を返す。
 */
export function makeHitTest(
  THREE: typeof THREE_T,
  model: THREE_T.Object3D,
  meshes: THREE_T.Mesh[],
) {
  const caps: Cap[] = meshes.map((mesh) => {
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox!;
    const sz = bb.getSize(new THREE.Vector3());
    const ct = bb.getCenter(new THREE.Vector3());
    const d = [sz.x, sz.y, sz.z];
    const ax = d.indexOf(Math.max(...d));
    const rest = [0, 1, 2].filter((k) => k !== ax);
    const r = Math.min(d[rest[0]], d[rest[1]]) / 2; // 丸棒の半径
    const half = Math.max(0, d[ax] / 2 - r); // 芯線の半分の長さ
    const dir = new THREE.Vector3(ax === 0 ? 1 : 0, ax === 1 ? 1 : 0, ax === 2 ? 1 : 0);
    return {
      a: ct.clone().addScaledVector(dir, -half),
      b: ct.clone().addScaledVector(dir, half),
      r,
    };
  });

  const capsW: CapW[] = meshes.map(() => ({
    a: new THREE.Vector3(),
    b: new THREE.Vector3(),
    c: new THREE.Vector3(),
    r: 0,
    h: 0,
  }));

  const pairs: number[][] = [];
  for (let i = 0; i < meshes.length; i++)
    for (let j = i + 2; j < meshes.length; j++) pairs.push([i, j]);

  const scale = new THREE.Vector3();
  const tmp = {
    d1: new THREE.Vector3(),
    d2: new THREE.Vector3(),
    r: new THREE.Vector3(),
    x: new THREE.Vector3(),
    y: new THREE.Vector3(),
  };

  return function hits() {
    if (!caps.length) return false;
    model.updateWorldMatrix(true, true);
    for (let i = 0; i < meshes.length; i++) {
      const mw = meshes[i].matrixWorld;
      const c = caps[i];
      const w = capsW[i];
      const sc = scale.setFromMatrixScale(mw).x;
      w.a.copy(c.a).applyMatrix4(mw);
      w.b.copy(c.b).applyMatrix4(mw);
      w.c.copy(w.a).add(w.b).multiplyScalar(0.5);
      w.r = c.r * sc;
      w.h = w.a.distanceTo(w.b) * 0.5;
    }
    for (let k = 0; k < pairs.length; k++) {
      const A = capsW[pairs[k][0]];
      const B = capsW[pairs[k][1]];
      // 遠い組は飛ばす
      if (A.c.distanceTo(B.c) > A.r + B.r + A.h + B.h) continue;
      if (segDist(A.a, A.b, B.a, B.b, tmp) < A.r + B.r - HIT_TOL) return true;
    }
    return false;
  };
}
