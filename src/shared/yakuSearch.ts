// 14牌を辞書で並べ直したとき、どの役が作れるかを調べる（役のバランスの検証用）
//
// 並べ方（分解×語の選び方）は全辞書だと1手で100万通りを超えるので、全てを役計算にかけることはしない。
// 役ごとに、分解の各組で「選べる語の語頭・語尾・回文か・特殊文字を含むか」だけを見て、作れるかを直接調べる。
// 一番高い翻数（最高翻）だけは、並べ方を間引いて実際に役計算した目安。
import { countsOf, enumerateChiitoi, enumerateStandard } from "./analysis";
import type { Lexicon } from "./lexicon";
import type { MeldType } from "./protocol";
import { firstChar, gyouOf, isSpecial, lastChar, vowelOf } from "./tiles";
import { computeYaku, type WordGroup } from "./yaku";

/** 並べ方で変わる役（状況役・清文・副次役は並べ方に関係しないので除く） */
export const SHAPE_YAKU = ["七対子", "同頭", "同尾", "同頭同尾", "回文", "重回文", "二連", "三連", "四連", "五連", "五音", "純行", "特文", "純特文", "同言", "重言"] as const;
export type ShapeYaku = (typeof SHAPE_YAKU)[number];

/** 役の名前を系統にまとめる（金五連→五連、立直（一巡目）→立直 など） */
export function yakuFamily(name: string): string {
  if (name === "金五連") return "五連";
  if (name === "金重言") return "重言";
  return name.replace(/（一巡目）$/, "");
}

/**
 * 実際に付いた役から「その役以上を達成した」系統を出す。
 * 三連を作った人は二連も達成した、同頭同尾を作った人は同頭・同尾も達成した、と数える
 */
export function reachedFamilies(names: string[]): Set<string> {
  const f = new Set(names.map(yakuFamily));
  const out = new Set<string>();
  for (const x of f) if ((SHAPE_YAKU as readonly string[]).includes(x)) out.add(x);
  const chain = ["二連", "三連", "四連", "五連"];
  const top = Math.max(...chain.map((c, i) => (f.has(c) ? i : -1)));
  for (let i = 0; i <= top; i++) out.add(chain[i]);
  if (f.has("同頭同尾")) {
    out.add("同頭");
    out.add("同尾");
  }
  if (f.has("純特文")) out.add("特文");
  if (f.has("重言")) out.add("同言");
  if (f.has("純行")) out.add("五音");
  return out;
}

export interface SearchInput {
  /** 手牌側の14−3m枚の文字 */
  chars: string[];
  melds: { type: MeldType; word: string }[];
  tsumo: boolean;
  riichi: null | { open: boolean; double: boolean };
  ippatsu: boolean;
  tenhou: boolean;
  chiihou: boolean;
}

export interface SearchResult {
  /** 作れる役の系統（「その役以上」を作れるもの。三連が作れれば二連も入る） */
  achievable: Set<string>;
  /** 最高翻の目安と、その並べ方 */
  bestHan: number;
  best: { words: string[]; yaku: string[] } | null;
  decomps: number;
  /** 分解の数が上限に達したか */
  truncated: boolean;
}

/** 分解の1つの組：選べる語と、その性質 */
interface Slot {
  words: string[];
  F: Set<string>;
  L: Set<string>;
  /** (語頭, 語尾) の組 */
  FL: [string, string][];
  pal: boolean;
  sp: boolean;
  head: boolean;
}

const rev = (s: string) => [...s].reverse().join("");
const isPal = (s: string) => s.length >= 2 && rev(s) === s;

function slotOf(words: string[], head: boolean): Slot {
  const F = new Set<string>();
  const L = new Set<string>();
  const fl = new Map<string, [string, string]>();
  let pal = false;
  for (const w of words) {
    const a = firstChar(w);
    const b = lastChar(w);
    F.add(a);
    L.add(b);
    fl.set(a + b, [a, b]);
    if (isPal(w)) pal = true;
  }
  return { words, F, L, FL: [...fl.values()], pal, sp: [...(words[0] ?? "")].some(isSpecial), head };
}

const meets = (a: Set<string>, b: Set<string>) => {
  for (const x of a) if (b.has(x)) return true;
  return false;
};

function pairs(s: Slot[], pick: (x: Slot) => Set<string>): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) if (meets(pick(s[i]), pick(s[j]))) out.push([i, j]);
  return out;
}

/** 七対子用：同じ語は2組使えないので、異なる語どうしで条件を満たす組 */
function distinctPairs(s: Slot[], fn: (w: string) => string): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < s.length; i++)
    for (let j = i + 1; j < s.length; j++) {
      let ok = false;
      for (const a of s[i].words) {
        for (const b of s[j].words) {
          if (a !== b && fn(a) === fn(b)) {
            ok = true;
            break;
          }
        }
        if (ok) break;
      }
      if (ok) out.push([i, j]);
    }
  return out;
}

/** しりとりで最も長くつながる数（idx の組を使い、start から始める） */
function longestChain(s: Slot[], idx: number[], start?: number): number {
  let best = 0;
  const used = new Array(s.length).fill(false);
  const dfs = (len: number, lc: string): boolean => {
    if (len > best) best = len;
    if (best === idx.length) return true;
    if (lc === "ん") return false;
    for (const j of idx) {
      if (used[j]) continue;
      for (const [a, b] of s[j].FL) {
        if (a !== lc) continue;
        used[j] = true;
        const done = dfs(len + 1, b);
        used[j] = false;
        if (done) return true;
      }
    }
    return false;
  };
  for (const i of start !== undefined ? [start] : idx) {
    for (const [, b] of s[i].FL) {
      used[i] = true;
      const done = dfs(1, b);
      used[i] = false;
      if (done) return best;
    }
  }
  return best;
}

/** 5つの組の語頭に、あいうえおを1つずつ割り当てられるか（gyou を指定すると、その行の文字だけ） */
function fiveVowels(s: Slot[], gyou?: number): boolean {
  if (s.length !== 5) return false;
  const opts = s.map((x) => {
    const v = new Set<number>();
    for (const ch of x.F) if (gyou === undefined || gyouOf(ch) === gyou) v.add(vowelOf(ch));
    v.delete(-1);
    return v;
  });
  const taken = new Array(5).fill(false);
  const rec = (i: number): boolean => {
    if (i === 5) return true;
    for (const v of opts[i]) {
      if (taken[v]) continue;
      taken[v] = true;
      if (rec(i + 1)) return true;
      taken[v] = false;
    }
    return false;
  };
  return rec(0);
}

/** 隣り合う2つ以上の組をつなげて4文字以上の回文にできるか（両端から語を足していく） */
function juukaibun(s: Slot[]): boolean {
  const used = new Array(s.length).fill(false);
  const agree = (a: string, b: string) => {
    const m = Math.min(a.length, b.length);
    return a.slice(0, m) === b.slice(0, m);
  };
  // L：左から読んだ文字列、R：右端から逆に読んだ文字列
  const dfs = (L: string, R: string, count: number): boolean => {
    const excess = L.length >= R.length ? L.slice(R.length) : R.slice(L.length);
    if (count >= 2 && L.length + R.length >= 4 && (excess === "" || isPal(excess) || excess.length === 1)) return true;
    const toLeft = L.length <= R.length;
    for (let i = 0; i < s.length; i++) {
      if (used[i]) continue;
      for (const w of s[i].words) {
        const nl = toLeft ? L + w : L;
        const nr = toLeft ? R : R + rev(w);
        if (!agree(nl, nr)) continue;
        used[i] = true;
        const ok = dfs(nl, nr, count + 1);
        used[i] = false;
        if (ok) return true;
      }
    }
    return false;
  };
  return dfs("", "", 0);
}

/** 同じ語を2つの組に置けるか。two=true なら異なる語で2組（重言） */
function sameWords(s: Slot[], two: boolean): boolean {
  const dup: { i: number; j: number; w: string }[] = [];
  for (let i = 0; i < s.length; i++)
    for (let j = i + 1; j < s.length; j++) {
      const wj = new Set(s[j].words);
      for (const w of s[i].words) if (wj.has(w)) dup.push({ i, j, w });
    }
  if (!two) return dup.length > 0;
  for (const a of dup) for (const b of dup) if (a.w !== b.w && new Set([a.i, a.j, b.i, b.j]).size === 4) return true;
  return false;
}

export function searchArrangements(inp: SearchInput, lex: Lexicon, opts: { decompLimit?: number; bestBudget?: number } = {}): SearchResult {
  const decompLimit = opts.decompLimit ?? 300000;
  const bestBudget = opts.bestBudget ?? 3000;
  const res: SearchResult = { achievable: new Set(), bestHan: -1, best: null, decomps: 0, truncated: false };
  const c = countsOf(inp.chars);
  const wordCache = new Map<string, string[]>();
  const wordsOf = (key: string) => {
    let w = wordCache.get(key);
    if (!w) {
      w = [...new Set(lex.wordsForKey(key).map((e) => e.word))];
      wordCache.set(key, w);
    }
    return w;
  };
  const meldSlots = inp.melds.map((m) => slotOf([m.word], false));
  const has = (y: ShapeYaku) => res.achievable.has(y);
  const add = (y: ShapeYaku) => res.achievable.add(y);

  const std = enumerateStandard(c, 1, 4 - inp.melds.length, lex, decompLimit);
  const chi = inp.melds.length === 0 ? enumerateChiitoi(c, lex, decompLimit) : [];
  res.truncated = std.length >= decompLimit || chi.length >= decompLimit;
  res.decomps = std.length + chi.length;

  for (const keys of std) {
    const s = [...keys.map((k) => slotOf(wordsOf(k), [...k].length === 2)), ...meldSlots];
    const headIdx = s.findIndex((x) => x.head);
    const body = s.map((_, i) => i).filter((i) => i !== headIdx);
    if (!has("同頭") || !has("同尾") || !has("同頭同尾")) {
      const hp = pairs(s, (x) => x.F);
      const tp = pairs(s, (x) => x.L);
      if (hp.length) add("同頭");
      if (tp.length) add("同尾");
      if (!has("同頭同尾") && hp.some(([a, b]) => tp.some(([c2, d]) => new Set([a, b, c2, d]).size === 4))) add("同頭同尾");
    }
    if (!has("回文") && s.some((x) => x.pal)) add("回文");
    if (!has("四連")) {
      const n = longestChain(s, body);
      if (n >= 2) add("二連");
      if (n >= 3) add("三連");
      if (n >= 4) add("四連");
    }
    if (!has("五連") && longestChain(s, s.map((_, i) => i), headIdx) === 5) {
      add("五連");
      add("四連");
      add("三連");
      add("二連");
    }
    if (!has("五音") && fiveVowels(s)) add("五音");
    if (!has("純行") && s.length === 5) {
      for (let gy = 0; gy < 13; gy++) {
        if (fiveVowels(s, gy)) {
          add("純行");
          add("五音");
          break;
        }
      }
    }
    if (!has("特文") && body.every((i) => s[i].sp)) add("特文");
    if (!has("純特文") && s.every((x) => x.sp)) add("純特文");
    if (!has("同言") && sameWords(s, false)) add("同言");
    if (!has("重言") && sameWords(s, true)) add("重言");
    if (!has("重回文") && juukaibun(s)) add("重回文");
  }
  for (const keys of chi) {
    add("七対子");
    if (has("同頭") && has("同尾") && has("同頭同尾") && has("回文")) break;
    const s = keys.map((k) => slotOf(wordsOf(k), false));
    const hp = distinctPairs(s, firstChar);
    const tp = distinctPairs(s, lastChar);
    if (hp.length) add("同頭");
    if (tp.length) add("同尾");
    if (hp.some(([a, b]) => tp.some(([c2, d]) => new Set([a, b, c2, d]).size === 4))) add("同頭同尾");
    if (s.some((x) => x.pal)) add("回文");
  }

  // 最高翻の目安：分解を均等に間引いて、語の選び方も含めて役計算する
  const meldGroups: WordGroup[] = inp.melds.map((m) => ({ word: m.word, concealed: m.type === "ankan", kan: m.type !== "pon", head: false }));
  const menzen = inp.melds.every((m) => m.type === "ankan");
  const tiles = [...inp.chars, ...inp.melds.flatMap((m) => [...m.word])];
  let budget = bestBudget;
  const evaluate = (words: string[], form: "standard" | "chiitoi") => {
    budget--;
    const groups: WordGroup[] = [...words.map((w) => ({ word: w, concealed: true, kan: false, head: form === "standard" && [...w].length === 2 })), ...meldGroups];
    const y = computeYaku({ form, groups, tiles, menzen, tsumo: inp.tsumo, riichi: inp.riichi, ippatsu: inp.ippatsu, tenhou: inp.tenhou, chiihou: inp.chiihou, theme: null });
    if (y.mainHan < 1) return;
    const han = y.yakuman ? Math.max(13, y.han) : y.han;
    if (han > res.bestHan) {
      res.bestHan = han;
      res.best = { words: [...words], yaku: y.items.map((i) => i.name) };
    }
  };
  const all: [string[], "standard" | "chiitoi"][] = [...std.map((k) => [k, "standard"] as [string[], "standard"]), ...chi.map((k) => [k, "chiitoi"] as [string[], "chiitoi"])];
  const perDecomp = Math.max(1, Math.floor(bestBudget / Math.max(1, all.length)));
  const step = Math.max(1, Math.floor(all.length / bestBudget));
  for (let i = 0; i < all.length && budget > 0; i += step) {
    const [keys, form] = all[i];
    const lists = keys.map(wordsOf);
    let left = perDecomp;
    const cur: string[] = [];
    const rec = (j: number) => {
      if (left <= 0 || budget <= 0) return;
      if (j === lists.length) {
        if (form === "chiitoi" && new Set(cur).size !== cur.length) return;
        left--;
        evaluate(cur, form);
        return;
      }
      for (const w of lists[j]) {
        cur.push(w);
        rec(j + 1);
        cur.pop();
      }
    };
    rec(0);
  }
  return res;
}
