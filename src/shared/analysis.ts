// 手牌の解析：アガリ形の判定、待ち、分解の列挙、向聴（あと何枚）
import { KIND_INDEX, KINDS, NUM_KINDS } from "./tiles";
import { keyOfKinds, Lexicon } from "./lexicon";

export function countsOf(chars: string[]): Int8Array {
  const c = new Int8Array(NUM_KINDS);
  for (const ch of chars) c[KIND_INDEX[ch]]++;
  return c;
}

function total(c: Int8Array): number {
  let t = 0;
  for (let k = 0; k < NUM_KINDS; k++) t += c[k];
  return t;
}

function firstKind(c: Int8Array, from = 0): number {
  for (let k = from; k < NUM_KINDS; k++) if (c[k] > 0) return k;
  return -1;
}

function take(c: Int8Array, g: number[]): boolean {
  let i = 0;
  for (; i < g.length; i++) {
    if (--c[g[i]] < 0) break;
  }
  if (i === g.length) return true;
  for (; i >= 0; i--) c[g[i]]++;
  return false;
}
function put(c: Int8Array, g: number[]) {
  for (const k of g) c[k]++;
}

/** 2文字×need2 + 3文字×need3 に分けられるか */
export function canStandard(c: Int8Array, need2: number, need3: number, lex: Lexicon): boolean {
  if (total(c) !== need2 * 2 + need3 * 3) return false;
  const rec = (n2: number, n3: number): boolean => {
    const k = firstKind(c);
    if (k < 0) return n2 === 0 && n3 === 0;
    if (n2 > 0) {
      for (const g of lex.b2[k]) {
        if (!take(c, g)) continue;
        const ok = rec(n2 - 1, n3);
        put(c, g);
        if (ok) return true;
      }
    }
    if (n3 > 0) {
      for (const g of lex.b3[k]) {
        if (!take(c, g)) continue;
        const ok = rec(n2, n3 - 1);
        put(c, g);
        if (ok) return true;
      }
    }
    return false;
  };
  return rec(need2, need3);
}

/** 七対子（異なる2文字の語×7）に分けられるか */
export function canChiitoi(c: Int8Array, lex: Lexicon): boolean {
  if (total(c) !== 14) return false;
  return enumerateChiitoi(c, lex, 1).length > 0;
}

/** 七対子の分解（キーの配列）を列挙する。同じ語は2回使えない */
export function enumerateChiitoi(c: Int8Array, lex: Lexicon, limit = 50): string[][] {
  if (total(c) !== 14) return [];
  const out: string[][] = [];
  const used = new Map<string, number>();
  const path: string[] = [];
  const rec = (): boolean => {
    const k = firstKind(c);
    if (k < 0) {
      out.push([...path]);
      return out.length >= limit;
    }
    for (const g of lex.b2[k]) {
      const key = keyOfKinds(g);
      const u = used.get(key) ?? 0;
      if (u >= lex.wordsForKey(key).length) continue;
      if (!take(c, g)) continue;
      used.set(key, u + 1);
      path.push(key);
      const stop = rec();
      path.pop();
      used.set(key, u);
      put(c, g);
      if (stop) return true;
    }
    return false;
  };
  rec();
  // 同じ組み合わせを重複して列挙しないよう正規化
  const seen = new Set<string>();
  return out.filter((p) => {
    const s = [...p].sort().join("|");
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}

/** 基本形の分解を列挙する（各要素はキーの配列。先頭が2文字の頭とは限らない） */
export function enumerateStandard(c: Int8Array, need2: number, need3: number, lex: Lexicon, limit = 200): string[][] {
  if (total(c) !== need2 * 2 + need3 * 3) return [];
  const out: string[][] = [];
  const seen = new Set<string>();
  const path: string[] = [];
  const rec = (n2: number, n3: number): boolean => {
    const k = firstKind(c);
    if (k < 0) {
      if (n2 === 0 && n3 === 0) {
        const s = [...path].sort().join("|");
        if (!seen.has(s)) {
          seen.add(s);
          out.push([...path]);
        }
      }
      return out.length >= limit;
    }
    const tryList = (list: number[][], d2: number, d3: number): boolean => {
      for (const g of list) {
        if (!take(c, g)) continue;
        path.push(keyOfKinds(g));
        const stop = rec(n2 - d2, n3 - d3);
        path.pop();
        put(c, g);
        if (stop) return true;
      }
      return false;
    };
    if (n2 > 0 && tryList(lex.b2[k], 1, 0)) return true;
    if (n3 > 0 && tryList(lex.b3[k], 0, 1)) return true;
    return false;
  };
  rec(need2, need3);
  return out;
}

/** 鳴き（ポン・カン）の数 m のとき、手牌の文字だけでアガリ形か */
export function isAgariShape(c: Int8Array, meldCount: number, lex: Lexicon, chiitoi = true): boolean {
  if (canStandard(c, 1, 4 - meldCount, lex)) return true;
  return chiitoi && meldCount === 0 && canChiitoi(c, lex);
}

/** 待ち（加えるとアガリ形になる牌の種類）。c は 13-3m 枚 */
export function waitsOf(c: Int8Array, meldCount: number, lex: Lexicon, chiitoi = true): number[] {
  const out: number[] = [];
  for (let k = 0; k < NUM_KINDS; k++) {
    if (lex.supply[k] === 0 || c[k] >= lex.supply[k]) continue;
    c[k]++;
    if (isAgariShape(c, meldCount, lex, chiitoi)) out.push(k);
    c[k]--;
  }
  return out;
}

/**
 * アガリまでに必要な牌の数（向聴数+1 に相当）。0 ならアガリ、1 ならテンパイ。
 * 完成した語・3文字語の一部（2牌）・単独の牌を枠に当てはめ、使える牌の最大数を探す。
 */
export function distance(c: Int8Array, meldCount: number, lex: Lexicon, chiitoi = true): number {
  const need3 = 4 - meldCount;
  const required = 2 + 3 * need3;
  const memo = new Map<string, number>();
  const keyOf = (s2: number, s3: number, from: number) => {
    let s = `${s2}${s3}:`;
    for (let k = from; k < NUM_KINDS; k++) if (c[k] > 0) s += k + "." + c[k] + ",";
    return s;
  };
  // s2: 頭の空き枠、s3: 3文字語の空き枠。戻り値は使える牌の最大数
  const dfs = (s2: number, s3: number, from: number): number => {
    if (s2 === 0 && s3 === 0) return 0;
    const k = firstKind(c, from);
    if (k < 0) return 0;
    const key = keyOf(s2, s3, k);
    const m = memo.get(key);
    if (m !== undefined) return m;
    // この牌を使わない
    c[k]--;
    let best = dfs(s2, s3, k);
    c[k]++;
    const cap = 2 * s2 + 3 * s3;
    const tryG = (g: number[], ns2: number, ns3: number) => {
      if (best >= cap) return;
      if (!take(c, g)) return;
      const v = g.length + dfs(ns2, ns3, k);
      put(c, g);
      if (v > best) best = v;
    };
    if (s3 > 0) {
      for (const g of lex.b3[k]) tryG(g, s2, s3 - 1);
      for (const g of lex.p3[k]) tryG(g, s2, s3 - 1);
      tryG([k], s2, s3 - 1);
    }
    if (s2 > 0) {
      for (const g of lex.b2[k]) tryG(g, s2 - 1, s3);
      tryG([k], s2 - 1, s3);
    }
    memo.set(key, best);
    return best;
  };
  let d = required - dfs(1, need3, 0);
  if (chiitoi && meldCount === 0) d = Math.min(d, chiitoiDistance(c, lex));
  return d;
}

function chiitoiDistance(c: Int8Array, lex: Lexicon): number {
  const t = total(c);
  let bestPairs = 0;
  const used = new Set<string>();
  const memo = new Map<string, number>();
  const dfs = (from: number): number => {
    const k = firstKind(c, from);
    if (k < 0) return 0;
    let key = "";
    for (let i = k; i < NUM_KINDS; i++) if (c[i] > 0) key += i + "." + c[i] + ",";
    key += [...used].join("");
    const m = memo.get(key);
    if (m !== undefined) return m;
    c[k]--;
    let best = dfs(k);
    c[k]++;
    for (const g of lex.b2[k]) {
      if (best >= 7) break;
      const kk = keyOfKinds(g);
      if (used.has(kk)) continue;
      if (!take(c, g)) continue;
      used.add(kk);
      const v = 1 + dfs(k);
      used.delete(kk);
      put(c, g);
      if (v > best) best = v;
    }
    memo.set(key, best);
    return best;
  };
  bestPairs = Math.min(7, dfs(0));
  const singles = Math.min(7 - bestPairs, t - 2 * bestPairs);
  return 14 - (2 * bestPairs + singles);
}

export const kindChar = (k: number) => KINDS[k];
