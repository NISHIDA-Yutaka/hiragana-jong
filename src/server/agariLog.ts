// アガリの記録をファイル（JSON Lines）に追記する
import { appendFile, mkdirSync, existsSync, readFileSync } from "fs";
import path from "path";
import type { AgariRecord } from "../shared/record";

/** 保存先。環境変数 LOG_DIR で変えられる（既定は実行したフォルダの logs/） */
export const LOG_DIR = process.env.LOG_DIR ?? path.join(process.cwd(), "logs");
export const AGARI_LOG = path.join(LOG_DIR, "agari.jsonl");

let ready = false;

export function appendAgari(rec: AgariRecord) {
  try {
    if (!ready) {
      mkdirSync(LOG_DIR, { recursive: true });
      ready = true;
    }
  } catch (e) {
    console.error("[log] cannot create", LOG_DIR, e);
    return;
  }
  appendFile(AGARI_LOG, JSON.stringify(rec) + "\n", (err) => {
    if (err) console.error("[log] append failed", err);
  });
}

export function readAgariLog(): string {
  return existsSync(AGARI_LOG) ? readFileSync(AGARI_LOG, "utf8") : "";
}
