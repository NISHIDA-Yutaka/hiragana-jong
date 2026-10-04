// アガリの記録を読み、同じ14牌を辞書で並べ直したら作れた役と、実際に付けた役を比べる
// 使い方: npx tsx scripts/analyze-agari.ts [ログ=logs/agari.jsonl] [--who human|bot|all] [--dict full|common] [--misses 件数]
import { readFileSync } from "fs";
import { getBaseLexicon } from "../src/server/dict";
import type { DictConfig, Lexicon } from "../src/shared/lexicon";
import type { AgariRecord } from "../src/shared/record";
import { reachedFamilies, searchArrangements, SHAPE_YAKU } from "../src/shared/yakuSearch";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "logs/agari.jsonl";
const who = opt("--who") ?? "human";
const dictOverride = opt("--dict") as DictConfig["level"] | undefined;
const showMisses = Number(opt("--misses") ?? 10);

const records: AgariRecord[] = readFileSync(file, "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));
const target = records.filter((r) => (who === "all" ? true : who === "bot" ? r.isBot : !r.isBot));

const lexCache = new Map<string, Lexicon>();
function lexFor(r: AgariRecord): Lexicon {
  const cfg = { ...r.dict, level: dictOverride ?? r.dict.level };
  const key = `${cfg.level}|${cfg.seion}|${cfg.extraTiles}`;
  let lx = lexCache.get(key);
  if (!lx) {
    lx = getBaseLexicon(cfg);
    lexCache.set(key, lx);
  }
  // 投票で認められた語など、辞書にない語も実際の並べ方として入れておく
  return lx.extend(r.hand.map((word) => ({ word, verified: true })));
}

const tally = new Map<string, { got: number; could: number }>();
for (const y of SHAPE_YAKU) tally.set(y, { got: 0, could: 0 });
let n = 0;
let sakubun = 0;
let truncated = 0;
let sumHan = 0;
let sumBest = 0;
const misses: { r: AgariRecord; best: number; words: string[]; yaku: string[] }[] = [];
const t0 = Date.now();

for (const r of target) {
  if (r.form === "sakubun") {
    sakubun++;
    continue;
  }
  const res = searchArrangements(
    { chars: r.hand.flatMap((w) => [...w]), melds: r.melds, tsumo: r.tsumo, riichi: r.riichi, ippatsu: r.ippatsu, tenhou: r.tenhou, chiihou: r.chiihou, extraTiles: r.dict.extraTiles },
    lexFor(r),
  );
  n++;
  if (res.truncated) truncated++;
  // 同種（テーマ宣言）は並べ直しでは調べられないので、実際の翻数から除いて比べる
  const themeHan = r.yaku.filter((y) => y.name === "同種" || y.name === "純同種").reduce((a, b) => a + b.han, 0);
  const actualHan = r.han - themeHan;
  const best = Math.max(res.bestHan, actualHan);
  sumHan += actualHan;
  sumBest += best;
  const got = reachedFamilies(r.yaku.map((y) => y.name));
  for (const f of SHAPE_YAKU) {
    const t = tally.get(f)!;
    const could = got.has(f) || res.achievable.has(f);
    if (could) t.could++;
    if (got.has(f)) t.got++;
  }
  if (res.best && best > actualHan) misses.push({ r, best, words: res.best.words, yaku: res.best.yaku });
}

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "-");
console.log(`記録 ${records.length} 件中、対象 ${n} 件（${who}、作文 ${sakubun} 件は除外）／辞書 ${dictOverride ?? "記録時の設定"}／${((Date.now() - t0) / 1000).toFixed(1)}秒`);
if (truncated) console.log(`※ ${truncated} 件は分解が多すぎて途中で打ち切り（作れた役を少なめに数えている可能性）`);
console.log(`平均翻数（同種を除く）：実際 ${(sumHan / Math.max(1, n)).toFixed(2)} ／ 最高の目安 ${(sumBest / Math.max(1, n)).toFixed(2)}\n`);
console.log("※ 二連は「二連以上」、同頭は「同頭か同頭同尾」のように、その役以上を数えています");
console.log("役        付いた率  作れた率  見つけた率（付いた/作れた）");
for (const [name, t] of [...tally.entries()].sort((a, b) => b[1].could - a[1].could)) {
  console.log(`${name.padEnd(6, "　")}  ${pct(t.got, n).padStart(7)}  ${pct(t.could, n).padStart(7)}  ${pct(t.got, t.could).padStart(7)}  (${t.got}/${t.could})`);
}

if (showMisses > 0 && misses.length) {
  console.log(`\n取りこぼしの大きかったアガリ（上位 ${Math.min(showMisses, misses.length)} 件）`);
  misses.sort((a, b) => b.best - b.r.han - (a.best - a.r.han));
  for (const m of misses.slice(0, showMisses)) {
    const actual = m.r.yaku.map((y) => y.name).join("・");
    console.log(`- ${m.r.name}：${m.r.hand.join("・")}${m.r.melds.length ? "＋" + m.r.melds.map((x) => x.word).join("・") : ""}（${m.r.han}翻：${actual}）`);
    console.log(`    → ${m.words.join("・")}（${m.best}翻：${m.yaku.join("・")}）`);
  }
}
