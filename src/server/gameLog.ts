// 対局の記録をファイルに残し、終わった対局だけを読み出す。
// 進行中の対局は全員の手牌が見えてしまうので、一覧にも出さず、読み出しも断る
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync } from "fs";
import path from "path";
import { randomBytes } from "crypto";
import type { GameLogLine, GameLogSummary } from "../shared/gameLog";

const LIST_LIMIT = 30;
/** ファイル名に使う id。クライアントから来る値なので、これ以外の形は読まない */
const ID_PATTERN = /^[0-9]{8}T[0-9]{6}-[A-Za-z0-9]+-[0-9a-f]{6}$/;

/** 記録中の対局 */
const live = new Set<string>();

const gamesDir = () => path.join(process.env.LOG_DIR ?? path.join(process.cwd(), "logs"), "games");
const fileOf = (id: string) => path.join(gamesDir(), `${id}.jsonl`);

export interface GameRecorder {
  write(line: GameLogLine): void;
  /** 対局が終わった（中断も含む）。これ以降は読み出せる */
  finish(): void;
}

export function openGameLog(room: string, players: { name: string; isBot: boolean }[]): GameRecorder {
  const now = new Date();
  const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, "");
  const id = `${stamp}-${room.replace(/[^A-Za-z0-9]/g, "") || "room"}-${randomBytes(3).toString("hex")}`;
  live.add(id);
  let broken = false;
  // 順番が入れ替わらないように同期で書く（1行は1KBほどで、人の操作の間隔でしか増えない）
  const write = (line: GameLogLine) => {
    if (broken) return;
    try {
      mkdirSync(gamesDir(), { recursive: true });
      appendFileSync(fileOf(id), JSON.stringify(line) + "\n");
    } catch (e) {
      broken = true;
      console.error("[gameLog] write failed", e);
    }
  };
  write({ t: "start", v: 1, id, at: now.toISOString(), room, players });
  return { write, finish: () => void live.delete(id) };
}

/** 先頭の行だけを読む（ファイル全体は読まない） */
function readStart(id: string): GameLogSummary | null {
  const buf = Buffer.alloc(4096);
  let fd: number | null = null;
  try {
    fd = openSync(fileOf(id), "r");
    const n = readSync(fd, buf, 0, buf.length, 0);
    const line = JSON.parse(buf.toString("utf8", 0, n).split("\n")[0]) as GameLogLine;
    if (line.t !== "start") return null;
    return { id, at: line.at, room: line.room, players: line.players.map((p) => p.name) };
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** 終わった対局を新しい順に返す */
export function listGameLogs(): GameLogSummary[] {
  if (!existsSync(gamesDir())) return [];
  const ids = readdirSync(gamesDir())
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => f.slice(0, -".jsonl".length))
    .filter((id) => ID_PATTERN.test(id) && !live.has(id))
    .sort()
    .reverse()
    .slice(0, LIST_LIMIT);
  return ids.map(readStart).filter((s): s is GameLogSummary => !!s);
}

/** 終わった対局の記録を返す。形の違う id、進行中の対局、ないファイルは null */
export function readGameLog(id: string): GameLogLine[] | null {
  if (!ID_PATTERN.test(id) || live.has(id) || !existsSync(fileOf(id))) return null;
  return readFileSync(fileOf(id), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as GameLogLine);
}
