// CPU（ボット）の打ち方。限られた語彙だけを知っている前提で手を作る
import type { Arrangement } from "../shared/arrange";
import { countsOf, distance, enumerateChiitoi, enumerateStandard, waitsOf } from "../shared/analysis";
import { Lexicon } from "../shared/lexicon";
import { KINDS, NUM_KINDS, Tile } from "../shared/tiles";

export class BotBrain {
  private lex: Lexicon;
  private seed: number;
  /** 種類ごとの「つながりやすさ」（その文字を含む語の数） */
  private conn: number[];
  /** 七対子でアガれるルールか */
  private chiitoi: boolean;

  constructor(lex: Lexicon, seed: number, chiitoi = true) {
    this.lex = lex;
    this.chiitoi = chiitoi;
    this.seed = seed || 1;
    this.conn = new Array(NUM_KINDS).fill(0);
    for (let k = 0; k < NUM_KINDS; k++) {
      for (const g of [...lex.b2[k], ...lex.b3[k]]) for (const x of new Set(g)) this.conn[x]++;
    }
  }

  private rnd() {
    let s = this.seed;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.seed = s >>> 0;
    return this.seed / 4294967296;
  }

  /** 分解（キーの列）を実際の牌の並びにする。missing の文字は1枚抜く */
  private toArrangement(keys: string[], hand: Tile[], chiitoi: boolean, missing?: string): Arrangement | null {
    const pool = [...hand];
    const order: number[] = [];
    const breaks: number[] = [];
    const usedWords = new Set<string>();
    let missingDone = missing === undefined;
    // 抜く文字を含む組は最後に置く（待ちの組）
    const sorted = [...keys].sort((a, b) => (missing && a.includes(missing) ? 1 : 0) - (missing && b.includes(missing) ? 1 : 0));
    for (const key of sorted) {
      const cands = this.lex.wordsForKey(key).filter((e) => !chiitoi || !usedWords.has(e.word));
      if (cands.length === 0) return null;
      const word = cands[Math.floor(this.rnd() * cands.length)].word;
      usedWords.add(word);
      const ids: number[] = [];
      for (const ch of word) {
        if (!missingDone && ch === missing) {
          missingDone = true;
          continue;
        }
        const i = pool.findIndex((t) => t.ch === ch);
        if (i < 0) return null;
        ids.push(pool[i].id);
        pool.splice(i, 1);
      }
      if (ids.length === 0) continue;
      order.push(...ids);
      breaks.push(ids[ids.length - 1]);
    }
    // 残り（捨てる牌など）は末尾に1枚ずつ
    for (const t of pool) {
      order.push(t.id);
      breaks.push(t.id);
    }
    if (order.length) breaks.pop();
    return { order, breaks };
  }

  /** 14-3m 枚でアガリ形を作れるならその並び */
  completeArrangement(hand: Tile[], meldCount: number): Arrangement | null {
    const c = countsOf(hand.map((t) => t.ch));
    const std = enumerateStandard(c, 1, 4 - meldCount, this.lex, 1);
    if (std.length) return this.toArrangement(std[0], hand, false);
    if (this.chiitoi && meldCount === 0) {
      const ch = enumerateChiitoi(c, this.lex, 1);
      if (ch.length) return this.toArrangement(ch[0], hand, true);
    }
    return null;
  }

  /** 13-3m 枚のテンパイの並び（待ちが一番多く残っている形） */
  private tenpaiArrangement(hand: Tile[], meldCount: number, visible: Int8Array): Arrangement | null {
    const c = countsOf(hand.map((t) => t.ch));
    const waits = waitsOf(c, meldCount, this.lex, this.chiitoi);
    if (waits.length === 0) return null;
    waits.sort((a, b) => this.lex.supply[b] - visible[b] - (this.lex.supply[a] - visible[a]));
    for (const w of waits) {
      c[w]++;
      let keys = enumerateStandard(c, 1, 4 - meldCount, this.lex, 1)[0];
      let chiitoi = false;
      if (!keys && this.chiitoi && meldCount === 0) {
        keys = enumerateChiitoi(c, this.lex, 1)[0];
        chiitoi = true;
      }
      c[w]--;
      if (keys) {
        const arr = this.toArrangement(keys, hand, chiitoi, KINDS[w]);
        if (arr) return arr;
      }
    }
    return null;
  }

  chooseDiscard(hand: Tile[], meldCount: number, visible: Int8Array): { tileId: number; arrangement: Arrangement; tenpai: boolean } {
    const c = countsOf(hand.map((t) => t.ch));
    const kinds = [...new Set(hand.map((t) => KINDS.indexOf(t.ch)))];
    let best: { k: number; d: number; score: number }[] = [];
    let bestD = 99;
    for (const k of kinds) {
      c[k]--;
      const d = distance(c, meldCount, this.lex, this.chiitoi);
      c[k]++;
      // 同じ距離なら、つながりにくい文字・場に多く見えている文字を先に切る
      const score = this.conn[k] * 2 - visible[k] * 3 + c[k] * 4 + this.rnd() * 3;
      if (d < bestD) {
        bestD = d;
        best = [{ k, d, score }];
      } else if (d === bestD) best.push({ k, d, score });
    }
    best.sort((a, b) => a.score - b.score);
    const k = best[0].k;
    const tile = [...hand].reverse().find((t) => t.ch === KINDS[k])!;
    const rest = hand.filter((t) => t.id !== tile.id);
    const tarr = bestD <= 1 ? this.tenpaiArrangement(rest, meldCount, visible) : null;
    let arrangement: Arrangement;
    if (tarr) {
      arrangement = { order: [...tarr.order, tile.id], breaks: tarr.order.length ? [...tarr.breaks, tarr.order[tarr.order.length - 1]] : tarr.breaks };
    } else {
      arrangement = { order: hand.map((t) => t.id), breaks: [] };
    }
    return { tileId: tile.id, arrangement, tenpai: !!tarr };
  }
}
