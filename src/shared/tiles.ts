// 牌の種類・牌セット・文字の正規化

/** 本体の清音45音（「を」なし） */
export const BASE_CHARS = [..."あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわん"];
export const LONG_MARK = "ー";
/** 追加牌（濁音20・半濁音5・小書き4）。追加牌の「ー」は本体の「ー」と同じ種類として数える */
export const EXTRA_CHARS = [..."がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽゃゅょっ"];

/** 全ての牌の種類（インデックスで扱う） */
export const KINDS: string[] = [...BASE_CHARS, LONG_MARK, ...EXTRA_CHARS];
export const NUM_KINDS = KINDS.length;
export const KIND_INDEX: Record<string, number> = Object.fromEntries(KINDS.map((c, i) => [c, i]));

/** 特殊文字：濁音・半濁音・拗音・促音・長音 */
export const SPECIAL_CHARS = new Set<string>([LONG_MARK, ...EXTRA_CHARS, ..."ぁぃぅぇぉゎゔ"]);
export const isSpecial = (ch: string) => SPECIAL_CHARS.has(ch);

/** 牌の枚数（種類インデックス→枚数） */
export function tileSupply(extraTiles: boolean): Int8Array {
  const s = new Int8Array(NUM_KINDS);
  for (const c of BASE_CHARS) s[KIND_INDEX[c]] = 3;
  s[KIND_INDEX[LONG_MARK]] = extraTiles ? 2 : 1;
  if (extraTiles) for (const c of EXTRA_CHARS) s[KIND_INDEX[c]] = 1;
  return s;
}

/** 山に積む全ての牌の文字 */
export function buildTileChars(extraTiles: boolean): string[] {
  const s = tileSupply(extraTiles);
  const out: string[] = [];
  for (let k = 0; k < NUM_KINDS; k++) for (let i = 0; i < s[k]; i++) out.push(KINDS[k]);
  return out;
}

const SEION_MAP: Record<string, string> = {};
{
  const pairs: [string, string][] = [
    ["がぎぐげご", "かきくけこ"],
    ["ざじずぜぞ", "さしすせそ"],
    ["だぢづでど", "たちつてと"],
    ["ばびぶべぼ", "はひふへほ"],
    ["ぱぴぷぺぽ", "はひふへほ"],
    ["ぁぃぅぇぉ", "あいうえお"],
    ["ゃゅょっゎ", "やゆよつわ"],
    ["ゔゐゑを", "ういえお"],
  ];
  for (const [a, b] of pairs) [...a].forEach((c, i) => (SEION_MAP[c] = b[i]));
}
/** 清音代用：濁音・半濁音・小書き文字を清音に直す（「かぎ」→「かき」） */
export function toSeion(word: string): string {
  return [...word].map((c) => SEION_MAP[c] ?? c).join("");
}

/** カタカナ→ひらがな、空白除去 */
export function normalizeInput(s: string): string {
  return s
    .trim()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[ｰ－―‐-]/g, LONG_MARK)
    .replace(/\s+/g, "");
}

const SMALL_TO_LARGE: Record<string, string> = { ゃ: "や", ゅ: "ゆ", ょ: "よ", っ: "つ", ぁ: "あ", ぃ: "い", ぅ: "う", ぇ: "え", ぉ: "お", ゎ: "わ" };

/** 語頭の文字 */
export const firstChar = (w: string) => w[0];
/** 語尾の文字（しりとり・同尾用）。末尾の「ー」は直前の文字で、小書き文字は大きい文字で判定 */
export function lastChar(w: string): string {
  let i = w.length - 1;
  while (i > 0 && w[i] === LONG_MARK) i--;
  const c = w[i];
  return SMALL_TO_LARGE[c] ?? c;
}

const VOWEL_ROWS = ["あかがさざただなはばぱまやらわ", "いきぎしじちぢにひびぴみり", "うくぐすずつづぬふぶぷむゆる", "えけげせぜてでねへべぺめれ", "おこごそぞとどのほぼぽもよろ"];
/** 母音（0=あ…4=お）。ん・ー・小書きは -1 */
export function vowelOf(ch: string): number {
  for (let v = 0; v < 5; v++) if (VOWEL_ROWS[v].includes(ch)) return v;
  return -1;
}

const GYOU = ["あいうえお", "かきくけこ", "がぎぐげご", "さしすせそ", "ざじずぜぞ", "たちつてと", "だぢづでど", "なにぬねの", "はひふへほ", "ばびぶべぼ", "ぱぴぷぺぽ", "まみむめも", "らりるれろ"];
/** 行（純行の判定用）。5文字そろう行のみ */
export function gyouOf(ch: string): number {
  return GYOU.findIndex((g) => g.includes(ch));
}
export const GYOU_LIST = GYOU;

/** 五十音順の並び（手牌の整列用） */
const ORDER = [..."あいうえおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろわんー"];
const ORDER_INDEX: Record<string, number> = {};
ORDER.forEach((c, i) => {
  if (!(c in ORDER_INDEX)) ORDER_INDEX[c] = i;
});
export const charOrder = (c: string) => ORDER_INDEX[c] ?? 999;

export interface Tile {
  id: number;
  ch: string;
}
export const sortTiles = (tiles: Tile[]) => [...tiles].sort((a, b) => charOrder(a.ch) - charOrder(b.ch) || a.id - b.id);

export const WIND_NAMES = ["東", "南", "西", "北"];
