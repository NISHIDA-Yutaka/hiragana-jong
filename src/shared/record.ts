// アガリの記録（役のバランスを確かめるためのログ）。1アガリ＝JSONの1行
import type { DictConfig } from "./lexicon";
import type { MeldType } from "./protocol";

export interface AgariRecord {
  v: 1;
  /** 記録した時刻（ISO形式） */
  at: string;
  room?: string;
  dict: DictConfig;
  playerCount: number;
  judgeMode: "declare" | "assist";
  name: string;
  isBot: boolean;
  botLevel?: string;
  dealer: boolean;
  tsumo: boolean;
  /** ロンのとき、放銃した人がCPUか */
  fromIsBot: boolean | null;
  /** アガった人が何枚捨てていたか（巡目の目安） */
  turn: number;
  form: "standard" | "chiitoi" | "sakubun";
  /** 手牌側の語（頭を含み、アガリ牌も入る）。作文は文章1つ */
  hand: string[];
  melds: { type: MeldType; word: string }[];
  winTile: string | null;
  riichi: null | { open: boolean; double: boolean };
  ippatsu: boolean;
  tenhou: boolean;
  chiihou: boolean;
  theme: { name: string; pure: boolean } | null;
  yaku: { name: string; han: number }[];
  han: number;
  yakuman: boolean;
}
