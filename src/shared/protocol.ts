// サーバーとクライアントでやり取りするデータの型
import type { Arrangement } from "./arrange";
import type { Tile } from "./tiles";
import type { YakuItem } from "./yaku";

export type GameLength = "tonpuu" | "hanchan" | "ikkyoku";
export type TimerPreset = "fast" | "normal" | "slow" | "none";
export type BotLevel = "weak" | "normal" | "strong";

export interface RoomSettings {
  playerCount: 2 | 3 | 4;
  length: GameLength;
  /** full: 広い辞書（JMdict全体） / common: 常用語のみ */
  dictLevel: "full" | "common";
  /** 清音代用（「かき」を「かぎ」と読むなど） */
  seion: boolean;
  /** 別売の追加牌（濁音・半濁音・小書き・ー）を混ぜる */
  extraTiles: boolean;
  timer: TimerPreset;
  /** ポン・カンあり */
  calls: boolean;
  /** 投票で否決されたとき：cancel=取り消しのみ / chombo=チョンボ（満貫払い） */
  rejectPenalty: "cancel" | "chombo";
}

export const DEFAULT_SETTINGS: RoomSettings = {
  playerCount: 4,
  length: "tonpuu",
  dictLevel: "full",
  seion: false,
  extraTiles: false,
  timer: "normal",
  calls: true,
  rejectPenalty: "cancel",
};

export const TIMER_SECONDS: Record<TimerPreset, { base: number; bank: number }> = {
  fast: { base: 10, bank: 30 },
  normal: { base: 20, bank: 60 },
  slow: { base: 40, bank: 120 },
  none: { base: 0, bank: 0 },
};

export interface RoomPlayerView {
  id: string;
  name: string;
  isBot: boolean;
  botLevel?: BotLevel;
  connected: boolean;
  isHost: boolean;
}

export interface ChatMessage {
  id: number;
  name: string;
  text: string;
  ts: number;
  system?: boolean;
}

export interface RoomView {
  code: string;
  you: string;
  isHost: boolean;
  players: RoomPlayerView[];
  spectators: string[];
  settings: RoomSettings;
  roomWords: string[];
  chat: ChatMessage[];
  inGame: boolean;
}

export type MeldType = "pon" | "minkan" | "ankan" | "kakan";

export interface MeldView {
  type: MeldType;
  tiles: Tile[];
  word: string;
  from: number | null;
  /** 鳴いた牌のID */
  calledId: number | null;
}

export interface DiscardView {
  tile: Tile;
  riichi: boolean;
  called: boolean;
  tsumogiri: boolean;
}

export interface SeatView {
  seat: number;
  name: string;
  isBot: boolean;
  connected: boolean;
  score: number;
  /** 0=東…（その局の自風） */
  wind: number;
  handCount: number;
  hasDrawn: boolean;
  melds: MeldView[];
  discards: DiscardView[];
  riichi: boolean;
  openRiichi: boolean;
  /** オープンリーチや流局時に公開された手牌（並べた形） */
  openGroups: Tile[][] | null;
}

export interface CallOption {
  id: number;
  word: string;
  tileIds: number[];
}

export type ActionsView =
  | {
      kind: "turn";
      canTsumo: boolean;
      riichiDiscards: number[];
      ankan: CallOption[];
      kakan: CallOption[];
      canSakubun: boolean;
      /** リーチ後などでツモ切りしかできない */
      locked: boolean;
      afterCall: boolean;
    }
  | {
      kind: "call";
      ron: boolean;
      pon: CallOption[];
      kan: CallOption[];
      tile: Tile;
      fromSeat: number;
    };

export interface VoteItem {
  id: number;
  kind: "word" | "theme" | "sakubun";
  text: string;
  detail?: string;
}

export interface VoteView {
  claimant: number;
  claimantName: string;
  title: string;
  items: VoteItem[];
  /** 手牌の語（参考表示） */
  words: string[];
  canVote: boolean;
  myVotes: Record<number, boolean> | null;
  waitingFor: string[];
  deadline: number | null;
}

export interface WinGroupView {
  word: string;
  tiles: Tile[];
  meld: MeldType | null;
  head: boolean;
}

export interface WinView {
  seat: number;
  name: string;
  fromSeat: number | null;
  form: "standard" | "chiitoi" | "sakubun";
  groups: WinGroupView[];
  winTile: Tile | null;
  yaku: YakuItem[];
  han: number;
  label: string;
  yakuman: boolean;
  /** 獲得本数（本場・供託を含む） */
  gain: number;
  dealer: boolean;
}

export interface HandResultView {
  kind: "agari" | "ryuukyoku" | "abort" | "chombo";
  title: string;
  wins: WinView[];
  tenpai: { seat: number; name: string; tenpai: boolean; groups: Tile[][] | null }[];
  before: number[];
  deltas: number[];
  after: number[];
  note?: string;
}

export interface FinalView {
  ranking: { seat: number; name: string; score: number; rank: number; pt: number }[];
  oneHand: boolean;
}

export interface GameEvent {
  seq: number;
  type: "discard" | "draw" | "pon" | "kan" | "ankan" | "kakan" | "riichi" | "ron" | "tsumo" | "ryuukyoku" | "abort" | "start" | "vote" | "chombo" | "reject";
  seat: number;
  text?: string;
}

export interface GameView {
  mySeat: number | null;
  n: number;
  seats: SeatView[];
  roundWind: number;
  kyoku: number;
  honba: number;
  kyotaku: number;
  dealer: number;
  liveRemaining: number;
  turn: number;
  phase: "play" | "calls" | "vote" | "result" | "final";
  lengthLabel: string;
  myHand: Tile[];
  drawnId: number | null;
  arrangement: Arrangement | null;
  actions: ActionsView | null;
  deadline: number | null;
  bank: number;
  base: number;
  vote: VoteView | null;
  result: HandResultView | null;
  final: FinalView | null;
  lastDiscard: { seat: number; tileId: number } | null;
  events: GameEvent[];
  /** リーチ中の自分の待ち */
  waits: string[];
  readyWaiting: string[];
  myTheme: { name: string; pure: boolean } | null;
}

export type GameAction =
  | { type: "discard"; tileId: number; riichi?: "riichi" | "open" }
  | { type: "tsumo" }
  | { type: "ankan"; optionId: number }
  | { type: "kakan"; optionId: number }
  | { type: "sakubun" }
  | { type: "call"; call: "ron" | "pon" | "kan" | "pass"; optionId?: number }
  | { type: "vote"; votes: Record<number, boolean> }
  | { type: "ready" };
