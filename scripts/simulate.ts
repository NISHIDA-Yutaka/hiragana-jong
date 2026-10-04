// ボット同士で対局をシミュレーションして、エンジンの不具合や役のバランスを確かめる
// 使い方: npx tsx scripts/simulate.ts [対局数] [weak|normal|strong] [tonpuu|hanchan|ikkyoku] [人数]
// RECORD=ファイル名 をつけると、アガリをログと同じ形式（JSON Lines）で書き出す（analyze-agari.ts で分析できる）
import { appendFileSync, writeFileSync } from "fs";
import { Game } from "../src/server/game";
import { getBaseLexicon, getBotLexicon } from "../src/server/dict";
import { DEFAULT_SETTINGS, type BotLevel, type GameLength, type RoomSettings } from "../src/shared/protocol";

const games = Number(process.argv[2] ?? 3);
const level = (process.argv[3] ?? "normal") as BotLevel;
const length = (process.argv[4] ?? "tonpuu") as GameLength;
const n = Number(process.argv[5] ?? 4) as 2 | 3 | 4;
const verbose = process.env.VERBOSE === "1";
const recordFile = process.env.RECORD;
// SEED=数 で CPU の語彙の選び方をずらす（並列で回すとき用）
const seedOffset = Number(process.env.SEED ?? 0);
if (recordFile) writeFileSync(recordFile, "");

// EXTRA=1 で濁音など＋30牌あり
const settings: RoomSettings = { ...DEFAULT_SETTINGS, length, playerCount: n, timer: "none", extraTiles: process.env.EXTRA === "1" };
const cfg = { level: settings.dictLevel, seion: settings.seion, extraTiles: settings.extraTiles };
const base = getBaseLexicon(cfg);
// 配牌直後にツモれる山の枚数（王牌14枚を除く）
const liveAtStart = (settings.extraTiles ? 166 : 136) - 13 * n - 14;

const turns: number[] = [];
const stats = { hands: 0, tsumo: 0, ron: 0, draw: 0, abort: 0, yaku: new Map<string, number>(), hanHist: new Map<string, number>() };

async function runOne(gi: number) {
  const players = Array.from({ length: n }, (_, i) => ({ id: `bot${i}`, name: `CPU${i + 1}`, isBot: true, botLevel: level, botLex: getBotLexicon(cfg, level, 1000 * (gi + seedOffset) + i + 1) }));
  let lastResult: unknown = null;
  return new Promise<void>((resolve) => {
    const g: Game = new Game({
      settings,
      players,
      fast: true,
      hooks: {
        update: () => {
          const v = g.viewFor(null);
          if (v.result && v.result !== lastResult) {
            lastResult = v.result;
            stats.hands++; turns.push(liveAtStart - v.liveRemaining);
            if (v.result.kind === "agari") {
              for (const w of v.result.wins) {
                if (w.fromSeat === null) stats.tsumo++;
                else stats.ron++;
                for (const y of w.yaku) stats.yaku.set(y.name, (stats.yaku.get(y.name) ?? 0) + 1);
                stats.hanHist.set(w.label, (stats.hanHist.get(w.label) ?? 0) + 1);
              }
            } else if (v.result.kind === "ryuukyoku") stats.draw++;
            else stats.abort++;
          }
          if (g.isOver) {
            const f = g.viewFor(null).final!;
            console.log(`game ${gi + 1}: hands=${g.handCount} ` + f.ranking.map((r) => `${r.name}:${r.score}(${r.pt > 0 ? "+" : ""}${r.pt})`).join(" "));
            g.destroy();
            resolve();
          }
        },
        wordApproved: () => {},
        playerLex: () => base,
        theme: () => null,
        log: verbose ? (m) => console.log(m) : undefined,
        record: recordFile ? (rec) => appendFileSync(recordFile, JSON.stringify(rec) + "\n") : undefined,
      },
    });
    g.start();
    // 最初の update は起動直後に一度呼ぶ
    setTimeout(() => {}, 0);
  });
}

const t0 = Date.now();
for (let i = 0; i < games; i++) await runOne(i);
const dt = (Date.now() - t0) / 1000;
console.log(`\n${games} games, ${stats.hands} hands in ${dt.toFixed(1)}s`);
console.log(`avg tiles drawn per hand: ${(turns.reduce((a, b) => a + b, 0) / turns.length).toFixed(1)}`);
console.log(`tsumo=${stats.tsumo} ron=${stats.ron} draw=${stats.draw} abort=${stats.abort}`);
console.log("han:", Object.fromEntries([...stats.hanHist.entries()].sort()));
console.log("yaku:", Object.fromEntries([...stats.yaku.entries()].sort((a, b) => b[1] - a[1])));
