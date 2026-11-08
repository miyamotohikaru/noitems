/**
 * ヒーローの立体の「ひとりでに動く」設定（2026-11-08 ユーザー指定）。
 *
 * 立体はふだんスクロールに合わせてだけ動き、止めれば止まる。
 * ただし、引ききって本文が出たところまで来たら、スクロールしていなくても
 * スクロールしているときと同じ速さで動き続ける。
 *
 * Hero が「引ききったか」を、調整パネルが速さを書き込み、HeroObject が読む。
 */

/** ひとりでに動く速さ。1 秒あたり「画面の高さ何個ぶんスクロールしたのと同じだけ」動くか */
export const AUTO_SPEED = 0.5;

export const heroMotion = {
  /** 引ききって本文が出たか（Hero が書く） */
  settled: false,
  /** 今の速さ（調整パネルが書き換える） */
  autoSpeed: AUTO_SPEED,
};

/**
 * 立体の大きさ（2026-11-08「始まりの物体が大きすぎる。自分で微調整したい」）。
 * 調整パネルが書き換え、"hero-layout" を投げると Hero が置き直す。
 */
/** はじめの大きさ。1 で画面の短い辺の 1.7 倍の枠（従来の大きさ） */
export const START_SCALE = 0.8;
/** 引いたときの大きさ。1 で従来どおり（PC は幅の64%・最大55rem、スマホは幅の132%） */
export const END_SCALE = 1;

export const heroLayout = {
  startScale: START_SCALE,
  endScale: END_SCALE,
};
