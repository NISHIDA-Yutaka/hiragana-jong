// カンの連鎖のシミュレーション：N文字の暗カンから、補充牌だけで（他の人に手番を渡さずに）三槓子・四槓子でアガれる確率
//
// モデル：
//  - 手番の初め（14枚）に、N文字の語を暗カンできる状態から始める。残りの 14−N 枚はでたらめな牌
//  - カンするたびに（文字数−3）枚を補充する。補充牌の並びは山の並びで決まっている
//  - 補充のあと、手牌がアガリの形なら嶺上でアガリ。さらに暗カンできる語があればカンを続けてよい
//  - カンする語の選び方は、山の並びを知っている前提で一番よいものを選ぶ（＝上限の見積もり）
//  - 語は辞書（広い／常用語のみ）にあるものだけ。役は三槓子（カン3つ）で必ず付く
//
// 使い方：npx tsx scripts/sim-kan-chain.ts [試行回数]
import { canStandard } from "../src/shared/analysis";
import { kindsOfWord } from "../src/shared/lexicon";
import { NUM_KINDS, tileSupply } from "../src/shared/tiles";
import { getBaseLexicon, getWordList } from "../src/server/dict";

const TRIALS = Number(process.argv[2] ?? 3000);
const supply = tileSupply(false);

let seed = 12345;
const rnd = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
};

interface KanWord {
  word: string;
  kinds: number[];
  /** 種類ごとの枚数 */
  need: [number, number][];
  mask: [number, number, number];
}

function maskOf(kinds: number[]): [number, number, number] {
  const m: [number, number, number] = [0, 0, 0];
  for (const k of kinds) m[k >> 5] |= 1 << (k & 31);
  return m;
}

function run(level: "full" | "common") {
  const lex = getBaseLexicon({ level, seion: false, extraTiles: false });
  const kanWords: KanWord[] = [];
  for (const e of getWordList()) {
    const n = [...e.word].length;
    if (n < 4 || n > 8 || !lex.lookup(e.word)) continue;
    const kinds = kindsOfWord(e.word);
    if (!kinds) continue;
    const cnt = new Map<number, number>();
    for (const k of kinds) cnt.set(k, (cnt.get(k) ?? 0) + 1);
    if ([...cnt].some(([k, v]) => v > supply[k])) continue;
    kanWords.push({ word: e.word, kinds, need: [...cnt], mask: maskOf(kinds) });
  }
  const byLen = new Map<number, KanWord[]>();
  for (const w of kanWords) {
    const n = w.kinds.length;
    if (!byLen.has(n)) byLen.set(n, []);
    byLen.get(n)!.push(w);
  }

  const formable = (c: Int8Array) => {
    const m: [number, number, number] = [0, 0, 0];
    for (let k = 0; k < NUM_KINDS; k++) if (c[k] > 0) m[k >> 5] |= 1 << (k & 31);
    return kanWords.filter((w) => (w.mask[0] & ~m[0]) === 0 && (w.mask[1] & ~m[1]) === 0 && (w.mask[2] & ~m[2]) === 0 && w.need.every(([k, v]) => c[k] >= v));
  };

  const out: Record<number, { kan3: number; kan4: number; early: number; chain2: number }> = {};
  for (const N of [4, 5, 6, 7]) {
    const first = byLen.get(N)!;
    const r = { kan3: 0, kan4: 0, early: 0, chain2: 0 };
    for (let t = 0; t < TRIALS; t++) {
      // 山：全ての牌
      const pool: number[] = [];
      for (let k = 0; k < NUM_KINDS; k++) for (let i = 0; i < supply[k]; i++) pool.push(k);
      const w0 = first[Math.floor(rnd() * first.length)];
      for (const k of w0.kinds) pool.splice(pool.indexOf(k), 1);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const c = new Int8Array(NUM_KINDS);
      let p = 0;
      for (let i = 0; i < 14 - N; i++) c[pool[p++]]++;
      // 1つ目のカンの補充
      for (let i = 0; i < N - 3; i++) c[pool[p++]]++;

      // best：0=アガれない、1=カン1〜2つでアガリ、3=三槓子、4=四槓子
      const memo = new Map<string, number>();
      let reached2 = false;
      const dfs = (kans: number, at: number): number => {
        const key = c.join(",") + "|" + kans + "|" + at;
        const m = memo.get(key);
        if (m !== undefined) return m;
        let best = 0;
        if (canStandard(c, 1, 4 - kans, lex)) best = kans >= 3 ? kans : 1;
        if (kans >= 2) reached2 = true;
        if (best < 4 && kans < 4) {
          for (const w of formable(c)) {
            for (const [k, v] of w.need) c[k] -= v;
            const draw = w.kinds.length - 3;
            for (let i = 0; i < draw; i++) c[pool[at + i]]++;
            const v = dfs(kans + 1, at + draw);
            for (let i = 0; i < draw; i++) c[pool[at + i]]--;
            for (const [k, n] of w.need) c[k] += n;
            if (v > best) best = v;
            if (best === 4) break;
          }
        }
        memo.set(key, best);
        return best;
      };
      const best = dfs(1, p);
      if (best === 4) r.kan4++;
      else if (best === 3) r.kan3++;
      else if (best === 1) r.early++;
      if (reached2) r.chain2++;
    }
    out[N] = r;
  }
  return out;
}

const pct = (n: number) => `${((n / TRIALS) * 100).toFixed(2)}%`;
for (const level of ["full", "common"] as const) {
  const t = Date.now();
  const res = run(level);
  console.log(`\n=== 辞書：${level === "full" ? "広い（約20万語）" : "常用語のみ"}　試行 ${TRIALS} 回ずつ（${((Date.now() - t) / 1000).toFixed(1)}秒）`);
  console.log("最初のカン | 2つ目のカンまで行ける | 三槓子でアガリ | 四槓子でアガリ | 三槓子以上の合計 | カン1〜2つで嶺上アガリ");
  for (const [n, r] of Object.entries(res)) {
    console.log(`${n}文字 | ${pct(r.chain2)} | ${pct(r.kan3)} | ${pct(r.kan4)} | ${pct(r.kan3 + r.kan4)} | ${pct(r.early)}`);
  }
}
