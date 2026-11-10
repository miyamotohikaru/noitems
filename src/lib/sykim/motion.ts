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

/**
 * スマホの配置（2026-11-09「携帯用のデザインや位置の配置を微調整できるようにして欲しい」）。
 * 調整パネルの「スマホの配置」から動かす。PC には効かない。
 */
export const MOBILE = {
  /** 立体だけが映る最初の場面の長さ（画面の高さの何%ぶんスクロールするか）。元は 340 */
  length: 200,
  /** はじめの大きさ（1 で画面の短い辺の 1.7 倍の枠） */
  startScale: 0.8,
  /** 引いたときの大きさ（1 で幅の132%） */
  endScale: 1,
  /** 引いたときの横の位置（0 で左端、0.5 で真ん中、1 で右端） */
  endX: 0.5,
  /** 引いたときの縦の位置（0 で上端、0.5 で真ん中、1 で下端） */
  endY: 0.5,
  /** スクロールで回る速さ（画面の高さ1つぶんで何周するか）。PC は 0.15 */
  turn: 0.3,
};
export const mobileLayout = { ...MOBILE };

/** PC のスクロールで回る速さ（画面の高さ1つぶんで何周するか） */
export const TURN = 0.15;
export const heroTurn = { pc: TURN };

/**
 * スマホで、項目を重なってくるカードにしたときの見た目（2026-11-09）。
 * カードの地は半透明にして、後ろの立体がうっすら透けるようにする（立体は最後まで背景にいる）。
 */
export const CARD = {
  /** 地の濃さ（1 で透けない） */
  alpha: 0.88,
  /** 後ろのぼかし（px） */
  blur: 14,
  /** 上の角の丸み（px）。キービジュアルに角丸が無いので 0 から */
  radius: 0,
  /** 上の縁の影の濃さ */
  shadow: 0.3,
  /**
   * カードが止まる高さ（カードの下端が、画面の上から何割の所に来たら止まるか）。
   * 1 だと下端が画面の下端に来た瞬間に次のカードが重なり始め、最後の行を読む前に隠れる
   * （2026-11-10「下まで読まないから、全部スクロール終わってから次の項目に行ってほしい」）。
   * 0.35 なら最後の行が画面の上の方まで上がり、読み終えてから次のカードが下から来る
   * （0.6 だと、最後の行が画面の真ん中あたりで次のカードに隠れた）。
   */
  stop: 0.35,
};
export const cardLayout = { stop: CARD.stop };

/**
 * 地のある所（入札の白い枠・PC の白い帯と明るい帯）で、後ろの立体を影として透かす（2026-11-10）。
 * 見た目は globals.css の .sheet / .shade-sheet / .shade-lift。
 */
export const SHADE = {
  /** 地の濃さ（1 で透けない＝影も見えない） */
  alpha: 0.84,
  /** 影のぼかし（px） */
  blur: 12,
};
export function applyShade(c: typeof SHADE) {
  const s = document.documentElement.style;
  s.setProperty("--shade-alpha", String(c.alpha));
  s.setProperty("--shade-blur", `${c.blur}px`);
}
export function applyCard(c: typeof CARD) {
  if (cardLayout.stop !== c.stop) {
    cardLayout.stop = c.stop;
    window.dispatchEvent(new Event("card-layout"));
  }
  const s = document.documentElement.style;
  s.setProperty("--card-alpha", String(c.alpha));
  s.setProperty("--card-blur", `${c.blur}px`);
  s.setProperty("--card-radius", `${c.radius}px`);
  s.setProperty("--card-shadow", String(c.shadow));
}
