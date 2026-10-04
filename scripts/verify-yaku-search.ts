// 作れる役の判定（役ごとの直接探索）が、全通りの役計算と一致するか確かめる
// 使い方: npx tsx scripts/verify-yaku-search.ts [手の数=60] [extra]（extra で濁音など＋30牌あり）
import { getBaseLexicon, getWordList } from "../src/server/dict";
import { countsOf, enumerateChiitoi, enumerateStandard } from "../src/shared/analysis";
import { buildTileChars } from "../src/shared/tiles";
import { computeYaku } from "../src/shared/yaku";
import { reachedFamilies, searchArrangements } from "../src/shared/yakuSearch";
getWordList();
const lex = getBaseLexicon({ level: "common", seion: false, extraTiles: process.argv[3] === "extra" });
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
let checked = 0, mismatch = 0;
const famCount = new Map<string, number>();
for (let t = 0; t < 200000 && checked < Number(process.argv[2] ?? 60); t++) {
  const pool = buildTileChars(process.argv[3] === "extra");
  const hand: string[] = [];
  for (let i = 0; i < 14; i++) hand.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  const c = countsOf(hand);
  const std = enumerateStandard(c, 1, 4, lex, 3000);
  const chi = enumerateChiitoi(c, lex, 3000);
  if (!std.length && !chi.length) continue;
  if (std.length >= 3000 || chi.length >= 3000) continue;
  checked++;
  const exact = new Set<string>();
  const walk = (keys: string[], form: "standard" | "chiitoi") => {
    const lists = keys.map((k) => [...new Set(lex.wordsForKey(k).map((e) => e.word))]);
    const cur: string[] = [];
    const rec = (j: number) => {
      if (j === lists.length) {
        if (form === "chiitoi" && new Set(cur).size !== cur.length) return;
        const y = computeYaku({ form, groups: cur.map((w) => ({ word: w, concealed: true, kan: false, head: form === "standard" && w.length === 2 })), tiles: hand, menzen: true, tsumo: true, riichi: null, ippatsu: false, tenhou: false, chiihou: false, theme: null });
        for (const f of reachedFamilies(y.items.map((i) => i.name))) exact.add(f);
        return;
      }
      for (const w of lists[j]) { cur.push(w); rec(j + 1); cur.pop(); }
    };
    rec(0);
  };
  for (const k of std) walk(k, "standard");
  for (const k of chi) walk(k, "chiitoi");
  const fast = searchArrangements({ chars: hand, melds: [], tsumo: true, riichi: null, ippatsu: false, tenhou: false, chiihou: false }, lex).achievable;
  for (const f of exact) famCount.set(f, (famCount.get(f) ?? 0) + 1);
  const a = [...exact].sort().join(","), b = [...fast].sort().join(",");
  if (a !== b) { mismatch++; if (mismatch <= 8) console.log("MISMATCH", hand.join(""), "\n exact:", a, "\n fast: ", b); }
}
console.log(`checked ${checked}, mismatch ${mismatch}`, Object.fromEntries(famCount));
