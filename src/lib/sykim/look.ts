// @ts-nocheck
/**
 * SYKIM ビューア（project-itm02/SYKIM_ビューア.html）の見た目を、そのまま持ってきたもの。
 *
 * 数値は元データ __LOOK__ の写し。塗装のラメ（金属フレーク）と細かな凹凸を出す
 * 自作シェーダーが本体で、これが無いと ただの灰色の金属になる。
 * 元ファイルからの移植なので、見た目を変えたいとき以外は触らないこと。
 */

export const LOOK = {
  "view": {
    "transform": "AgX",
    "look": "AgX - Base Contrast",
    "exposure": -1.475,
    "gamma": 1.5347
  },
  "lights": [
    {
      "name": "fill",
      "type": "AREA",
      "loc": [
        -5.51555,
        -1.68627,
        2.32882
      ],
      "dir": [
        0.91926,
        0.28105,
        -0.27564
      ],
      "energy": 104.0,
      "color": [
        0.93,
        0.96,
        1.0
      ],
      "size": 5.0,
      "size_y": 0.25,
      "shape": "SQUARE",
      "parent": "LIGHTRIG"
    },
    {
      "name": "key",
      "type": "AREA",
      "loc": [
        0.49812,
        4.05683,
        4.35522
      ],
      "dir": [
        -0.09057,
        -0.73761,
        -0.66913
      ],
      "energy": 1300.0,
      "color": [
        1.0,
        1.0,
        1.0
      ],
      "size": 6.0,
      "size_y": 0.25,
      "shape": "SQUARE",
      "parent": "LIGHTRIG"
    },
    {
      "name": "rim",
      "type": "AREA",
      "loc": [
        2.8531,
        -4.07465,
        4.03016
      ],
      "dir": [
        -0.47552,
        0.67911,
        -0.55919
      ],
      "energy": 130.0,
      "color": [
        0.95,
        0.97,
        1.0
      ],
      "size": 4.0,
      "size_y": 0.25,
      "shape": "SQUARE",
      "parent": "LIGHTRIG"
    }
  ],
  "lightrig": {
    "loc": [
      0.0,
      0.0,
      0.0
    ],
    "scale": [
      1.0,
      1.0,
      1.0
    ]
  },
  "world": {
    "strength": 0.1,
    "stops": [
      [
        0.42,
        [
          0.02,
          0.02,
          0.02,
          1.0
        ]
      ],
      [
        0.7,
        [
          1.0,
          1.0,
          1.0,
          1.0
        ]
      ]
    ]
  },
  "mat": {
    "base": [
      0.33843,
      0.34205,
      0.38765
    ],
    "metallic": 0.775,
    "rough_min": 0.1,
    "rough_max": 0.46,
    "rough_noise_scale": 8.0,
    "bump_strength": 0.18917,
    "bump_dist": 0.02,
    "bump_noise_scale": 3.2,
    "bump_noise_detail": 10.0,
    "flake_scale": 12.0,
    "flake_from_min": 0.8,
    "flake_from_max": 1.0,
    "flake_rough": 0.06,
    "flake_mul": 2.4,
    "flake_bump_dist": 0.05
  },
  "render": {
    "samples": 192,
    "res": [
      1600,
      1600
    ]
  }
};

/* eslint-disable */
export function applyLook(THREE, mat, L) {
  const m=L.mat;
  mat.color.setRGB(m.base[0], m.base[1], m.base[2], THREE.LinearSRGBColorSpace);
  mat.metalness=m.metallic;
  mat.roughness=(m.rough_min+m.rough_max)/2;
  mat.onBeforeCompile=(sh)=>{
    sh.uniforms.uRoughMin={value:(0.03)};
    sh.uniforms.uRN={value:(1.0)};
    sh.uniforms.uMicro={value:(0.29)};
    sh.uniforms.uRoughMax={value:(m.rough_max)};
    sh.uniforms.uRoughScale={value:m.rough_noise_scale*0.45};
    sh.uniforms.uBumpScale={value:m.bump_noise_scale*(3.3)};
    sh.uniforms.uBumpStr={value:m.bump_strength*(0.02)};
    // ラメ：Blenderのフレーク層（ノイズの上位だけを、つるつるで明るい粒にする）
    sh.uniforms.uFlakeScale={value:(5)};
    sh.uniforms.uFlakeMin={value:(0.74)};      // Blender値0.8より少し多めに出す
    sh.uniforms.uFlakeMax={value:(m.flake_from_max)};
    sh.uniforms.uFlakeRough={value:(m.flake_rough)};
    sh.uniforms.uFlakeMul={value:(4)};         // Blender値2.4より強め（Web用）
    sh.uniforms.uFlakeBump={value:(0.35)};       // 粒ごとに向きを散らして影側でもキラつかせる
    sh.vertexShader='varying vec3 vObjPos;\nvarying mat3 vNM;\n'+sh.vertexShader.replace(
      '#include <begin_vertex>','#include <begin_vertex>\n  vObjPos = position;\n  vNM = normalMatrix;');
    const pre = `
      varying vec3 vObjPos;
      varying mat3 vNM;
      uniform float uRoughMin,uRoughMax,uRoughScale,uBumpScale,uBumpStr;
      uniform float uRN;
      uniform float uMicro;
      float h31(vec3 p){ return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453123); }
      float vnoise(vec3 p){
        vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        float n=0.0;
        for(int dx=0;dx<2;dx++)for(int dy=0;dy<2;dy++)for(int dz=0;dz<2;dz++){
          vec3 o=vec3(float(dx),float(dy),float(dz));
          vec3 w=mix(1.0-f,f,o);
          n+=h31(i+o)*w.x*w.y*w.z;
        }
        return n;
      }
      float fbmAA(vec3 p, float px){
        float a=0.5,s=0.0,n=0.0,fq=1.0;
        for(int k=0;k<4;k++){
          float fade=smoothstep(2.2,0.7, px*fq);
          n+=a*fade*vnoise(p*fq); s+=a*fade; fq*=2.0; a*=0.5;
        }
        return s>0.0 ? n/s : 0.5;
      }
      // ── ラメ（金属フレーク）: セルごとの乱数の上位だけを粒にする
      uniform float uFlakeScale,uFlakeMin,uFlakeMax,uFlakeRough,uFlakeMul,uFlakeBump;
      float gFlake=0.0;
      vec3  gFlakeDir=vec3(0.0,0.0,1.0);
      void calcFlake(){
        vec3 cell=floor(vObjPos*uFlakeScale);
        float k=smoothstep(uFlakeMin,uFlakeMax,h31(cell));
        // 1画素より細かくなったら弱める（チカチカ防止）
        float px=max(fwidth(vObjPos.x),max(fwidth(vObjPos.y),fwidth(vObjPos.z)))*uFlakeScale;
        gFlake=k*smoothstep(1.7,0.5,px);
        gFlakeDir=normalize(vec3(h31(cell+11.3),h31(cell+27.1),h31(cell+43.7))*2.0-1.0);
      }
    `;
    const rough = `
        #include <roughnessmap_fragment>
        {
          float pxs = max(fwidth(vObjPos.x), max(fwidth(vObjPos.y), fwidth(vObjPos.z)));
          float nr = fbmAA(vObjPos*uRoughScale, pxs*uRoughScale);
          roughnessFactor = mix(uRoughMin,uRoughMax,clamp(0.5+(nr-0.5)*0.55*uRN,0.0,1.0));
          // 1画素より細かい凹凸は法線では表せないので「粗さ」に足す
          float pxm = max(fwidth(vObjPos.x), max(fwidth(vObjPos.y), fwidth(vObjPos.z)))*uBumpScale;
          float micro = clamp(uMicro * smoothstep(0.25,1.4,pxm), 0.0, 1.0);
          roughnessFactor = clamp(sqrt(roughnessFactor*roughnessFactor + micro*micro), 0.0, 1.0);
          roughnessFactor = mix(roughnessFactor, uFlakeRough, gFlake);   // ラメはつるつる
        }
    `;
    const norm = `
        #include <normal_fragment_maps>
        {
          // 見える大きさの凹凸だけ法線で表現する
          vec3 p = vObjPos*uBumpScale;
          float pxb = max(fwidth(vObjPos.x), max(fwidth(vObjPos.y), fwidth(vObjPos.z)))*uBumpScale;
          float e = 0.35;
          float h0 = fbmAA(p, pxb);
          vec3 g = vec3(fbmAA(p+vec3(e,0.0,0.0),pxb)-h0,
                        fbmAA(p+vec3(0.0,e,0.0),pxb)-h0,
                        fbmAA(p+vec3(0.0,0.0,e),pxb)-h0)/e;
          vec3 gv = vNM * g;
          vec3 nn = normalize(normal);
          vec3 t  = gv - nn*dot(gv,nn);
          normal = normalize(nn - t*uBumpStr);
          normal = normalize(normal + gFlakeDir*uFlakeBump*gFlake);      // ラメの向きを散らす
        }
    `;
    const flake = `
        #include <color_fragment>
        calcFlake();
        diffuseColor.rgb *= mix(1.0, uFlakeMul, gFlake);
    `;
    sh.fragmentShader = pre + sh.fragmentShader
      .replace('#include <color_fragment>', flake)
      .replace('#include <roughnessmap_fragment>', rough)
      .replace('#include <normal_fragment_maps>', norm);
    mat.userData.shader=sh;
  };
  mat.needsUpdate=true;
}
