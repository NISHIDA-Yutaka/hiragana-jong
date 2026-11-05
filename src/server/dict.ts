// 辞書ファイルの読み込みと、設定ごとの辞書のキャッシュ
import { readFileSync, existsSync } from "fs";
import { gunzipSync } from "zlib";
import path from "path";
import { fileURLToPath } from "url";
import { buildBaseLexicon, DictConfig, Lexicon, parseWordList } from "../shared/lexicon";
import { tileSupply, toSeion } from "../shared/tiles";
import type { Genre } from "../shared/yaku";
import type { BotLevel } from "../shared/protocol";

let wordList: { word: string; common: boolean }[] | null = null;

function findDataFile(name: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.join(here, "../../data", name), path.join(here, "../data", name), path.join(process.cwd(), "data", name)];
  const f = candidates.find((p) => existsSync(p));
  if (!f) throw new Error(`data/${name} が見つかりません`);
  return f;
}

export function getWordList() {
  if (!wordList) {
    const t = Date.now();
    wordList = parseWordList(gunzipSync(readFileSync(findDataFile("words.txt.gz"))).toString("utf8"));
    console.log(`[dict] ${wordList.length} words loaded in ${Date.now() - t}ms`);
  }
  return wordList;
}

const cache = new Map<string, Lexicon>();

export function getBaseLexicon(cfg: DictConfig): Lexicon {
  const key = `${cfg.level}|${cfg.seion}|${cfg.extraTiles}`;
  let lx = cache.get(key);
  if (!lx) {
    lx = buildBaseLexicon(getWordList(), cfg);
    cache.set(key, lx);
  }
  return lx;
}

const genreCache = new Map<boolean, Genre[]>();

/** 同種ドラのジャンル（data/genres.json）。清音代用の卓では、語を作るときと同じく清音にした形も認める */
export function getGenres(seion: boolean): Genre[] {
  let genres = genreCache.get(seion);
  if (!genres) {
    const raw = JSON.parse(readFileSync(findDataFile("genres.json"), "utf8")) as Record<string, string[]>;
    genres = Object.entries(raw).map(([name, words]) => ({ name, words: new Set(seion ? words.flatMap((w) => [w, toSeion(w)]) : words) }));
    genreCache.set(seion, genres);
  }
  return genres;
}

const BOT_RATIO: Record<BotLevel, number> = { weak: 0.035, normal: 0.05, strong: 0.075 };

/** ボットの語彙：常用語の一部だけを知っている（強さで割合が変わる） */
export function getBotLexicon(cfg: DictConfig, level: BotLevel, seed: number): Lexicon {
  const list = getWordList();
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  const ratio = BOT_RATIO[level];
  const entries = list.filter((w) => w.common && w.word.length <= 3 && rnd() < ratio).map((w) => ({ word: w.word, verified: true }));
  return Lexicon.build(entries, tileSupply(cfg.extraTiles));
}
