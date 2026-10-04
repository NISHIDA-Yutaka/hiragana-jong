// 役と点数の計算（ルールブック第6章）
import { firstChar, gyouOf, isSpecial, lastChar, vowelOf } from "./tiles";

export interface WordGroup {
  word: string;
  /** ポン・明カン・加カン以外（手牌の語と暗カン） */
  concealed: boolean;
  kan: boolean;
  head: boolean;
}

export interface YakuInput {
  form: "standard" | "chiitoi" | "sakubun";
  groups: WordGroup[];
  /** アガリに使った全ての牌の文字（カンの牌を含む） */
  tiles: string[];
  menzen: boolean;
  tsumo: boolean;
  riichi: null | { open: boolean; double: boolean };
  ippatsu: boolean;
  tenhou: boolean;
  chiihou: boolean;
  /** 承認された同種のテーマ宣言（pure=頭を含む＝純同種） */
  theme: null | { name: string; pure: boolean };
  /**
   * 濁音など＋30牌ありか（省略時はあり）。基本の牌は特殊文字が「ー」1枚だけなので、
   * 清文はほぼ必ず付き、特文・純特文・特殊文字ドラは作れない。そのため基本の牌ではこれらを数えない
   */
  extraTiles?: boolean;
}

export interface YakuItem {
  name: string;
  han: number;
  /** 副次役（和了条件にならない） */
  sub?: boolean;
  yakuman?: boolean;
  note?: string;
}

export interface YakuResult {
  items: YakuItem[];
  han: number;
  /** 副次役以外の翻数 */
  mainHan: number;
  yakuman: boolean;
  label: string;
}

const isPalindrome = (s: string) => s.length >= 2 && [...s].reverse().join("") === s;

function* permutations<T>(arr: T[], k: number, used: boolean[] = [], cur: T[] = []): Generator<T[]> {
  if (cur.length === k) {
    yield cur;
    return;
  }
  for (let i = 0; i < arr.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    cur.push(arr[i]);
    yield* permutations(arr, k, used, cur);
    cur.pop();
    used[i] = false;
  }
}

/** しりとりで最も長くつながる並び（words の添字の列） */
function longestChain(words: string[], idx: number[], startFrom?: number): number[] {
  let best: number[] = [];
  const used = new Set<number>();
  const dfs = (path: number[]) => {
    if (path.length > best.length) best = [...path];
    const last = words[path[path.length - 1]];
    const lc = lastChar(last);
    if (lc === "ん") return;
    for (const j of idx) {
      if (used.has(j)) continue;
      if (firstChar(words[j]) !== lc) continue;
      used.add(j);
      path.push(j);
      dfs(path);
      path.pop();
      used.delete(j);
    }
  };
  const starts = startFrom !== undefined ? [startFrom] : idx;
  for (const s of starts) {
    used.add(s);
    dfs([s]);
    used.delete(s);
  }
  return best;
}

/** 条件を満たす組のうち、両方門前の組があるか */
function pairInfo(groups: WordGroup[], keyFn: (w: string) => string) {
  const pairs: [number, number][] = [];
  for (let i = 0; i < groups.length; i++)
    for (let j = i + 1; j < groups.length; j++) if (keyFn(groups[i].word) === keyFn(groups[j].word)) pairs.push([i, j]);
  return pairs;
}

export function computeYaku(inp: YakuInput): YakuResult {
  const items: YakuItem[] = [];
  const add = (name: string, han: number, extra: Partial<YakuItem> = {}) => items.push({ name, han, ...extra });
  const g = inp.groups;
  const words = g.map((x) => x.word);
  const allConcealed = g.every((x) => x.concealed);

  // --- 状況役 ---
  if (inp.tenhou) add("天和", 4);
  if (inp.chiihou) add("地和", 4);
  if (inp.menzen && inp.tsumo) add("門前清自摸和", 1);
  if (inp.riichi) {
    if (inp.riichi.open) add(inp.riichi.double ? "オープンリーチ（一巡目）" : "オープンリーチ", inp.riichi.double ? 3 : 2);
    else add(inp.riichi.double ? "立直（一巡目）" : "立直", inp.riichi.double ? 2 : 1);
  }
  if (inp.ippatsu) add("一発", 1);
  const specialYaku = inp.extraTiles !== false;
  if (specialYaku && !inp.tiles.some(isSpecial)) add("清文", inp.menzen ? 2 : 1);

  if (inp.form === "sakubun") {
    add("作文", 4);
  } else if (inp.form === "chiitoi") {
    add("七対子", 2);
    let kaibun = 0;
    for (const w of words) if (isPalindrome(w)) kaibun++;
    if (kaibun) add("回文", kaibun, { note: kaibun > 1 ? `×${kaibun}` : undefined });
    const heads = pairInfo(g, firstChar);
    const tails = pairInfo(g, lastChar);
    const dis = heads.some(([a, b]) => tails.some(([c, d]) => new Set([a, b, c, d]).size === 4));
    if (dis) add("同頭同尾", 4);
    else {
      if (heads.length) add("同頭", 2);
      if (tails.length) add("同尾", 2);
    }
  } else {
    const headIdx = g.findIndex((x) => x.head);
    const body = g.map((_, i) => i).filter((i) => i !== headIdx);
    const bodyConcealed = body.every((i) => g[i].concealed);

    // 同頭・同尾・同頭同尾
    const heads = pairInfo(g, firstChar);
    const tails = pairInfo(g, lastChar);
    const both = heads.some(([a, b]) => tails.some(([c, d]) => new Set([a, b, c, d]).size === 4));
    if (both) add("同頭同尾", bodyConcealed ? 4 : 3);
    else {
      if (heads.length) add("同頭", heads.some(([a, b]) => g[a].concealed && g[b].concealed) ? 2 : 1);
      if (tails.length) add("同尾", tails.some(([a, b]) => g[a].concealed && g[b].concealed) ? 2 : 1);
    }

    // 三槓子・四槓子
    const kans = g.filter((x) => x.kan);
    if (kans.length === 4) add("四槓子", kans.every((x) => x.concealed) ? 4 : 2);
    else if (kans.length === 3) add("三槓子", kans.every((x) => x.concealed) ? 3 : 1);

    // 重回文と回文
    let bestJuu: { idx: number[]; len: number } | null = null;
    for (let k = 2; k <= g.length; k++) {
      for (const perm of permutations(
        g.map((_, i) => i),
        k,
      )) {
        const s = perm.map((i) => words[i]).join("");
        if (s.length >= 4 && isPalindrome(s)) {
          if (!bestJuu || s.length > bestJuu.len) bestJuu = { idx: [...perm], len: s.length };
        }
      }
    }
    const kaibunIdx = words.map((w, i) => (isPalindrome(w) ? i : -1)).filter((i) => i >= 0);
    // 重回文を採るか（含まれる面子の回文は数えない）を翻数で比べる
    if (bestJuu) {
      const juuHan = 3 + (bestJuu.len - 4);
      const lost = kaibunIdx.filter((i) => bestJuu!.idx.includes(i)).length;
      if (juuHan > lost) {
        add("重回文", juuHan, { note: `${bestJuu.idx.map((i) => words[i]).join("・")}` });
        const rest = kaibunIdx.filter((i) => !bestJuu!.idx.includes(i)).length;
        if (rest) add("回文", rest, { note: rest > 1 ? `×${rest}` : undefined });
      } else if (kaibunIdx.length) add("回文", kaibunIdx.length, { note: kaibunIdx.length > 1 ? `×${kaibunIdx.length}` : undefined });
    } else if (kaibunIdx.length) add("回文", kaibunIdx.length, { note: kaibunIdx.length > 1 ? `×${kaibunIdx.length}` : undefined });

    // しりとり（二連〜五連）
    const goren = headIdx >= 0 ? longestChain(words, g.map((_, i) => i), headIdx) : [];
    if (goren.length === 5) {
      if (allConcealed) add("金五連", 13, { yakuman: true });
      else add("五連", 8);
    } else {
      const chain = longestChain(words, body);
      const chainConcealed = chain.every((i) => g[i].concealed);
      if (chain.length >= 4) add("四連", bodyConcealed ? 8 : 6);
      else if (chain.length === 3) add("三連", chainConcealed ? 5 : 4);
      else if (chain.length === 2) {
        // 門前の二連があればそちらを採る
        let concealedPair = false;
        for (const i of body)
          for (const j of body)
            if (i !== j && g[i].concealed && g[j].concealed && lastChar(words[i]) !== "ん" && lastChar(words[i]) === firstChar(words[j])) concealedPair = true;
        add("二連", concealedPair ? 3 : 2);
      }
    }

    // 純行・五音
    if (g.length === 5) {
      const firsts = words.map(firstChar);
      const gy = firsts.map(gyouOf);
      const vs = new Set(firsts.map(vowelOf));
      const allVowels = vs.size === 5 && !vs.has(-1);
      if (allVowels && gy[0] >= 0 && gy.every((x) => x === gy[0])) add("純行", allConcealed ? 5 : 4);
      else if (allVowels) add("五音", allConcealed ? 4 : 2);
    }

    // 純特文・特文
    const hasSp = (w: string) => [...w].some(isSpecial);
    if (specialYaku && words.every(hasSp)) add("純特文", allConcealed ? 4 : 3);
    else if (specialYaku && body.every((i) => hasSp(words[i]))) add("特文", bodyConcealed ? 3 : 2);

    // 同種・純同種（宣言して承認されたとき）
    if (inp.theme) {
      if (inp.theme.pure) add("純同種", allConcealed ? 5 : 4, { note: inp.theme.name });
      else add("同種", bodyConcealed ? 4 : 3, { note: inp.theme.name });
    }

    // 重言・同言
    const same = new Map<string, number[]>();
    words.forEach((w, i) => same.set(w, [...(same.get(w) ?? []), i]));
    const dupGroups = [...same.values()].filter((v) => v.length >= 2);
    if (dupGroups.length >= 2) {
      const conc = dupGroups.every((v) => v.every((i) => g[i].concealed));
      if (conc && allConcealed) add("金重言", 13, { yakuman: true });
      else add("重言", 8);
    } else if (dupGroups.length === 1) {
      add("同言", dupGroups[0].every((i) => g[i].concealed) ? 4 : 3);
    }
  }

  // --- 副次役 ---
  let kanDora = 0;
  for (const x of g) if (x.kan) kanDora += [...x.word].length - 3;
  if (kanDora > 0) add("カンドラ", kanDora, { sub: true });
  const sp = inp.tiles.filter(isSpecial).length;
  if (specialYaku && sp >= 4) add("特殊文字ドラ", sp - 3, { sub: true });

  const mainHan = items.filter((x) => !x.sub && !x.yakuman).reduce((a, b) => a + b.han, 0) + (items.some((x) => x.yakuman) ? 13 : 0);
  const han = items.filter((x) => !x.yakuman).reduce((a, b) => a + b.han, 0);
  const yakuman = items.some((x) => x.yakuman) || han >= 13;
  let label = `${han}翻`;
  if (items.some((x) => x.yakuman)) label = "役満";
  else if (han >= 13) label = "数え役満";
  return { items, han, mainHan, yakuman, label };
}

export interface Payment {
  /** ロン：放銃者の支払い */
  ron: number;
  /** 子のツモ：子それぞれ／親の支払い。親のツモ：子それぞれの支払い */
  tsumoChild: number;
  tsumoDealer: number;
}

/** 翻数→本数（1本=1000点）。ルールブックの【補完】換算表 */
export function paymentFor(han: number, yakuman: boolean, dealer: boolean): Payment {
  const rows: [number, number, number, number, number, number][] = [
    // maxHan, 子ロン, 子ツモ(子), 子ツモ(親), 親ロン, 親ツモ(各)
    [1, 1, 1, 1, 2, 1],
    [2, 2, 1, 1, 3, 1],
    [3, 4, 1, 2, 6, 2],
    [5, 8, 2, 4, 12, 4],
    [7, 12, 3, 6, 18, 6],
    [10, 16, 4, 8, 24, 8],
    [12, 24, 6, 12, 36, 12],
  ];
  let r: [number, number, number, number, number, number] = [99, 32, 8, 16, 48, 16];
  if (!yakuman) r = rows.find((x) => han <= x[0]) ?? r;
  if (dealer) return { ron: r[4], tsumoChild: r[5], tsumoDealer: r[5] };
  return { ron: r[1], tsumoChild: r[2], tsumoDealer: r[3] };
}

export const THEMES = ["生き物", "自然（植物含む）", "人間", "地名", "歴史", "飲食物", "機械／道具", "ファンタジー", "生活", "政治", "経済", "春", "夏", "秋", "冬"];
