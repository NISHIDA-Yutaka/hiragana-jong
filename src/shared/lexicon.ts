// 辞書（語の集合）と、アガリ判定用の索引
import { KIND_INDEX, KINDS, NUM_KINDS, tileSupply, toSeion } from "./tiles";

export interface LexEntry {
  word: string;
  /** 共通辞書かルーム承認済みの語なら true。マイ単語のみの語は false（アガリ時に投票） */
  verified: boolean;
}

interface LongEntry extends LexEntry {
  len: number;
  kinds: number[];
  cnt: number[];
  m0: number;
  m1: number;
  m2: number;
}

export interface DictConfig {
  level: "common" | "full";
  seion: boolean;
  extraTiles: boolean;
}

/** 文字列→種類インデックスの昇順配列。使えない文字を含めば null */
export function kindsOfWord(word: string): number[] | null {
  const out: number[] = [];
  for (const ch of word) {
    const k = KIND_INDEX[ch];
    if (k === undefined) return null;
    out.push(k);
  }
  return out.sort((a, b) => a - b);
}

/** 並べ替えに依存しないキー（文字を種類順に並べた文字列） */
export const keyOfKinds = (ks: number[]) => ks.map((k) => KINDS[k]).join("");

function maskOf(kinds: number[]): [number, number, number] {
  const m: [number, number, number] = [0, 0, 0];
  for (const k of kinds) m[(k / 25) | 0] |= 1 << k % 25;
  return m;
}

export class Lexicon {
  readonly supply: Int8Array;
  /** b2[k] / b3[k]: 最小の種類が k である2文字・3文字の語の多重集合 */
  b2: number[][][];
  b3: number[][][];
  /** 3文字語の部分集合になる2牌の組（ターツ）。最小の種類ごと */
  p3: number[][][];
  private maps: Map<string, LexEntry[]>[];
  private wordSets: Map<string, LexEntry>[];
  private longChunks: LongEntry[][];

  private constructor(supply: Int8Array) {
    this.supply = supply;
    this.b2 = Array.from({ length: NUM_KINDS }, () => []);
    this.b3 = Array.from({ length: NUM_KINDS }, () => []);
    this.p3 = Array.from({ length: NUM_KINDS }, () => []);
    this.maps = [];
    this.wordSets = [];
    this.longChunks = [];
  }

  static build(entries: LexEntry[], supply: Int8Array): Lexicon {
    const lx = new Lexicon(supply);
    const map = new Map<string, LexEntry[]>();
    const set = new Map<string, LexEntry>();
    const long: LongEntry[] = [];
    const pairSeen = new Set<string>();
    for (const e of entries) {
      if (set.has(e.word)) continue;
      const ks = kindsOfWord(e.word);
      if (!ks || ks.length < 2) continue;
      // 牌の枚数を超える語は作れない
      const cnt = new Map<number, number>();
      let okSupply = true;
      for (const k of ks) {
        const v = (cnt.get(k) ?? 0) + 1;
        cnt.set(k, v);
        if (v > supply[k]) okSupply = false;
      }
      if (!okSupply) continue;
      set.set(e.word, e);
      if (ks.length <= 3) {
        const key = keyOfKinds(ks);
        let arr = map.get(key);
        if (!arr) {
          arr = [];
          map.set(key, arr);
          (ks.length === 2 ? lx.b2 : lx.b3)[ks[0]].push(ks);
          if (ks.length === 3) {
            for (const [a, b] of [
              [ks[0], ks[1]],
              [ks[0], ks[2]],
              [ks[1], ks[2]],
            ]) {
              const pk = a + "," + b;
              if (!pairSeen.has(pk)) {
                pairSeen.add(pk);
                lx.p3[a].push([a, b]);
              }
            }
          }
        }
        arr.push(e);
      } else {
        const kinds = [...cnt.keys()].sort((a, b) => a - b);
        const [m0, m1, m2] = maskOf(kinds);
        long.push({ ...e, len: ks.length, kinds, cnt: kinds.map((k) => cnt.get(k)!), m0, m1, m2 });
      }
    }
    lx.maps.push(map);
    lx.wordSets.push(set);
    lx.longChunks.push(long);
    return lx;
  }

  /** 追加の語（ルーム辞書・マイ単語）を重ねた辞書を作る。元の辞書は変更しない */
  extend(extras: LexEntry[]): Lexicon {
    const fresh = extras.filter((e) => !this.lookup(e.word));
    if (fresh.length === 0) return this;
    const x = Lexicon.build(fresh, this.supply);
    const lx = new Lexicon(this.supply);
    const mergeKeys = (a: number[][][], b: number[][][], dedupe: boolean) =>
      a.map((list, k) => {
        if (b[k].length === 0) return list;
        if (!dedupe) return [...list, ...b[k]];
        const seen = new Set(list.map((g) => g.join(",")));
        return [...list, ...b[k].filter((g) => !seen.has(g.join(",")))];
      });
    lx.b2 = mergeKeys(this.b2, x.b2, true);
    lx.b3 = mergeKeys(this.b3, x.b3, true);
    lx.p3 = mergeKeys(this.p3, x.p3, true);
    lx.maps = [...this.maps, ...x.maps];
    lx.wordSets = [...this.wordSets, ...x.wordSets];
    lx.longChunks = [...this.longChunks, ...x.longChunks];
    return lx;
  }

  lookup(word: string): LexEntry | undefined {
    for (const s of this.wordSets) {
      const e = s.get(word);
      if (e) return e;
    }
    return undefined;
  }

  /** 多重集合キーに合う語の一覧 */
  wordsForKey(key: string): LexEntry[] {
    if (this.maps.length === 1) return this.maps[0].get(key) ?? [];
    const out: LexEntry[] = [];
    for (const m of this.maps) {
      const a = m.get(key);
      if (a) out.push(...a);
    }
    return out;
  }

  /**
   * 手牌（種類ごとの枚数）から作れる4文字以上の語。
   * mustKind を指定すると、その種類を含む語だけを返す（明カン用）。
   * minFromHand: 手牌から使う枚数の下限（mustKind 分を除く）
   */
  longWordsWithin(counts: Int8Array, opts: { mustKind?: number; base?: number[]; limit?: number } = {}): LexEntry[] {
    const present = [0, 0, 0];
    for (let k = 0; k < NUM_KINDS; k++) if (counts[k] > 0) present[(k / 25) | 0] |= 1 << k % 25;
    const out: LexEntry[] = [];
    const limit = opts.limit ?? 60;
    for (const chunk of this.longChunks) {
      for (const e of chunk) {
        if ((e.m0 & ~present[0]) | (e.m1 & ~present[1]) | (e.m2 & ~present[2])) continue;
        let ok = true;
        for (let i = 0; i < e.kinds.length; i++) {
          if (counts[e.kinds[i]] < e.cnt[i]) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        if (opts.mustKind !== undefined && !e.kinds.includes(opts.mustKind)) continue;
        if (opts.base) {
          // base（ポンした語の文字）をすべて含むこと
          const need = new Map<number, number>();
          for (const k of opts.base) need.set(k, (need.get(k) ?? 0) + 1);
          for (const [k, v] of need) {
            const i = e.kinds.indexOf(k);
            if (i < 0 || e.cnt[i] < v) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
        }
        out.push(e);
        if (out.length >= limit * 4) break;
      }
    }
    out.sort((a, b) => b.word.length - a.word.length || (a.word < b.word ? -1 : 1));
    return out.slice(0, limit);
  }
}

/** 辞書テキスト（1行1語。常用語は "語\t1"）を読む */
export function parseWordList(text: string): { word: string; common: boolean }[] {
  const out: { word: string; common: boolean }[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) out.push({ word: line, common: false });
    else out.push({ word: line.slice(0, tab), common: line.slice(tab + 1) === "1" });
  }
  return out;
}

export function buildBaseLexicon(list: { word: string; common: boolean }[], cfg: DictConfig): Lexicon {
  const entries: LexEntry[] = [];
  for (const { word, common } of list) {
    if (cfg.level === "common" && !common) continue;
    entries.push({ word, verified: true });
    if (cfg.seion) {
      const s = toSeion(word);
      if (s !== word) entries.push({ word: s, verified: true });
    }
  }
  return Lexicon.build(entries, tileSupply(cfg.extraTiles));
}
