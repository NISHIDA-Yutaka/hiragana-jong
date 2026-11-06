// 対局の記録（見返す用）。全員の手牌を理牌の区切りごと残す。1対局＝1ファイル、1行＝JSON1つ
import type { MeldType } from "./protocol";

/** ある時点の1人分の状態。groups は理牌の区切りどおりの文字のまとまり */
export interface LogSeat {
  groups: string[];
  melds: { type: MeldType; word: string }[];
  discards: string[];
  riichi: boolean;
}

export type GameLogLine =
  /** owner はその席のブラウザの鍵のハッシュ。ファイルにだけ残し、クライアントには渡さない */
  | { t: "start"; v: 1; id: string; at: string; room: string; players: { name: string; isBot: boolean; owner?: string }[] }
  | { t: "hand"; label: string; honba: number; dealer: number; genre: string | null; scores: number[] }
  /** ev は GameEvent の種類か、理牌が終わった時点の "riipai" */
  | { t: "snap"; ev: string; seat: number; text?: string; wall: number; hands: LogSeat[] }
  | { t: "result"; title: string; note?: string; wins: { name: string; words: string[]; label: string; gain: number }[]; deltas: number[]; after: number[] }
  | { t: "end"; ranking: { name: string; score: number; rank: number }[] };

/** 一覧に出す1対局分 */
export interface GameLogSummary {
  id: string;
  at: string;
  room: string;
  players: string[];
}
