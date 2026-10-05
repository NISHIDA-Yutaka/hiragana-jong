// 部屋（ロビー）の管理
import { randomBytes } from "crypto";
import type { Arrangement } from "../shared/arrange";
import { kindsOfWord, Lexicon } from "../shared/lexicon";
import { BotLevel, ChatMessage, DEFAULT_SETTINGS, GameAction, RoomSettings, RoomView } from "../shared/protocol";
import { normalizeInput, tileSupply, toSeion } from "../shared/tiles";
import { THEMES } from "../shared/yaku";
import { getBaseLexicon, getBotLexicon } from "./dict";
import { appendAgari } from "./agariLog";
import { Game } from "./game";

export interface Member {
  id: string;
  name: string;
  token: string;
  isBot: boolean;
  botLevel?: BotLevel;
  sockets: Set<string>;
  myWords: string[];
  theme: { name: string; pure: boolean } | null;
  joinedAt: number;
}

export interface RoomIO {
  /** その部屋の全員に最新の状態を送る */
  broadcast(room: Room): void;
}

const BOT_NAMES = ["ことはちゃん", "もじまる", "かなこ", "ひらりん", "ごじゅうおん", "よみびと", "つむぎ", "しりとりー"];
const LEVEL_LABEL: Record<BotLevel, string> = { weak: "弱", normal: "中", strong: "強" };

export class Room {
  readonly code: string;
  members: Member[] = [];
  hostId = "";
  settings: RoomSettings = { ...DEFAULT_SETTINGS };
  roomWords: string[] = [];
  chat: ChatMessage[] = [];
  game: Game | null = null;
  /** 対局に参加しているメンバーID */
  seatedIds: string[] = [];
  lastActive = Date.now();
  private chatSeq = 0;
  private roomLexCache: Lexicon | null = null;
  private io: RoomIO;

  constructor(code: string, io: RoomIO) {
    this.code = code;
    this.io = io;
  }

  // ---------------------------------------------------------------- メンバー

  addHuman(name: string): Member {
    const m: Member = {
      id: "p" + randomBytes(6).toString("hex"),
      name: name.slice(0, 12),
      token: randomBytes(16).toString("hex"),
      isBot: false,
      sockets: new Set(),
      myWords: [],
      theme: null,
      joinedAt: Date.now(),
    };
    this.members.push(m);
    if (!this.hostId || !this.members.some((x) => x.id === this.hostId && !x.isBot)) this.hostId = m.id;
    this.system(`${m.name} さんが入室しました`);
    return m;
  }

  addBot(level: BotLevel): Member | string {
    if (this.game && !this.game.isOver) return "対局中は追加できません";
    const used = new Set(this.members.map((m) => m.name));
    const base = BOT_NAMES.find((n) => !used.has(`${n}(${LEVEL_LABEL[level]})`)) ?? "CPU";
    const m: Member = {
      id: "b" + randomBytes(6).toString("hex"),
      name: `${base}(${LEVEL_LABEL[level]})`,
      token: "",
      isBot: true,
      botLevel: level,
      sockets: new Set(),
      myWords: [],
      theme: null,
      joinedAt: Date.now(),
    };
    this.members.push(m);
    return m;
  }

  removeMember(id: string) {
    const m = this.members.find((x) => x.id === id);
    if (!m) return;
    if (this.game && !this.game.isOver && this.seatedIds.includes(id)) return; // 対局中の席は残す
    this.members = this.members.filter((x) => x.id !== id);
    if (!m.isBot) this.system(`${m.name} さんが退室しました`);
    this.fixHost();
  }

  fixHost() {
    const humans = this.members.filter((m) => !m.isBot);
    if (!humans.some((m) => m.id === this.hostId)) {
      const connected = humans.find((m) => m.sockets.size > 0) ?? humans[0];
      this.hostId = connected?.id ?? "";
    }
  }

  get humanCount() {
    return this.members.filter((m) => !m.isBot).length;
  }
  get connectedHumans() {
    return this.members.filter((m) => !m.isBot && m.sockets.size > 0).length;
  }

  memberByToken(token: string) {
    return this.members.find((m) => m.token === token && !m.isBot);
  }
  member(id: string) {
    return this.members.find((m) => m.id === id);
  }

  setConnected(m: Member) {
    this.game?.setConnected(m.id, m.sockets.size > 0);
  }

  // ---------------------------------------------------------------- チャット・辞書

  system(text: string) {
    this.chat.push({ id: ++this.chatSeq, name: "", text, ts: Date.now(), system: true });
    if (this.chat.length > 100) this.chat.shift();
  }

  say(m: Member, text: string) {
    const t = text.trim().slice(0, 200);
    if (!t) return;
    this.chat.push({ id: ++this.chatSeq, name: m.name, text: t, ts: Date.now() });
    if (this.chat.length > 100) this.chat.shift();
  }

  /** 入力された語を、今の設定で牌として使える形にする。使えなければ null */
  normalizeWord(raw: string): string | null {
    let w = normalizeInput(raw);
    if (this.settings.seion) w = toSeion(w);
    const len = [...w].length;
    if (len < 2 || len > 14) return null;
    const ks = kindsOfWord(w);
    if (!ks) return null;
    const supply = tileSupply(this.settings.extraTiles);
    const cnt = new Map<number, number>();
    for (const k of ks) {
      cnt.set(k, (cnt.get(k) ?? 0) + 1);
      if (cnt.get(k)! > supply[k]) return null;
    }
    return w;
  }

  addRoomWord(word: string, by?: string): boolean {
    if (this.roomWords.includes(word)) return false;
    this.roomWords.push(word);
    this.roomLexCache = null;
    this.game?.invalidateLex();
    this.system(by ? `${by} さんが「${word}」をルーム辞書に追加しました` : `「${word}」が承認され、ルーム辞書に追加されました`);
    return true;
  }

  removeRoomWord(word: string) {
    this.roomWords = this.roomWords.filter((w) => w !== word);
    this.roomLexCache = null;
    this.game?.invalidateLex();
  }

  setMyWords(m: Member, words: string[]) {
    const out: string[] = [];
    for (const raw of words.slice(0, 300)) {
      const w = this.normalizeWord(String(raw));
      if (w && !out.includes(w)) out.push(w);
    }
    m.myWords = out;
    this.game?.invalidateLex(m.id);
    return out;
  }

  setTheme(m: Member, theme: { name: string; pure: boolean } | null) {
    m.theme = theme && THEMES.includes(theme.name) ? { name: theme.name, pure: !!theme.pure } : null;
  }

  private dictConfig() {
    return { level: this.settings.dictLevel, seion: this.settings.seion, extraTiles: this.settings.extraTiles };
  }

  roomLex(): Lexicon {
    if (!this.roomLexCache) {
      this.roomLexCache = getBaseLexicon(this.dictConfig()).extend(this.roomWords.map((word) => ({ word, verified: true })));
    }
    return this.roomLexCache;
  }

  playerLex(id: string): Lexicon {
    const m = this.member(id);
    const base = this.roomLex();
    if (!m || m.isBot || m.myWords.length === 0) return base;
    return base.extend(m.myWords.map((word) => ({ word, verified: false })));
  }

  lookupWord(raw: string): { word: string; inDict: boolean; inRoom: boolean } | null {
    const w = this.normalizeWord(raw);
    if (!w) return null;
    const base = getBaseLexicon(this.dictConfig());
    return { word: w, inDict: !!base.lookup(w), inRoom: this.roomWords.includes(w) };
  }

  // ---------------------------------------------------------------- 設定と対局

  updateSettings(s: Partial<RoomSettings>) {
    if (this.game && !this.game.isOver) return;
    const next = { ...this.settings };
    if (s.playerCount && [2, 3, 4].includes(s.playerCount)) next.playerCount = s.playerCount;
    if (s.length && ["tonpuu", "hanchan", "ikkyoku"].includes(s.length)) next.length = s.length;
    if (s.dictLevel && ["full", "common"].includes(s.dictLevel)) next.dictLevel = s.dictLevel;
    if (typeof s.seion === "boolean") next.seion = s.seion;
    if (typeof s.chiitoi === "boolean") next.chiitoi = s.chiitoi;
    if (typeof s.extraTiles === "boolean") next.extraTiles = s.extraTiles;
    if (s.timer && ["fast", "normal", "slow", "none"].includes(s.timer)) next.timer = s.timer;
    if (typeof s.calls === "boolean") next.calls = s.calls;
    if (s.rejectPenalty && ["cancel", "chombo"].includes(s.rejectPenalty)) next.rejectPenalty = s.rejectPenalty;
    if (s.callSeconds !== undefined && [0, 5, 8, 10, 12].includes(s.callSeconds)) next.callSeconds = s.callSeconds;
    if (s.riipaiSeconds !== undefined && [0, 60, 180, 300].includes(s.riipaiSeconds)) next.riipaiSeconds = s.riipaiSeconds;
    this.settings = next;
    this.roomLexCache = null;
  }

  fillBots(level: BotLevel) {
    while (this.members.length < this.settings.playerCount) {
      if (typeof this.addBot(level) === "string") break;
    }
  }

  start(): string | null {
    if (this.game && !this.game.isOver) return "対局中です";
    const n = this.settings.playerCount;
    const humans = this.members.filter((m) => !m.isBot);
    const bots = this.members.filter((m) => m.isBot);
    const seated = [...humans, ...bots].slice(0, n);
    if (seated.length < n) return `${n}人そろっていません（CPUを追加できます）`;
    if (!seated.some((m) => !m.isBot)) return "人間のプレイヤーが必要です";
    // 席順はランダム（席0が起家）
    for (let i = seated.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [seated[i], seated[j]] = [seated[j], seated[i]];
    }
    this.game?.destroy();
    this.seatedIds = seated.map((m) => m.id);
    const cfg = this.dictConfig();
    this.roomLex(); // 辞書を先に用意
    this.game = new Game({
      settings: { ...this.settings },
      players: seated.map((m, i) => ({
        id: m.id,
        name: m.name,
        isBot: m.isBot,
        botLevel: m.botLevel,
        botLex: m.isBot ? getBotLexicon(cfg, m.botLevel ?? "normal", (Date.now() + i * 104729) >>> 0) : undefined,
      })),
      hooks: {
        update: () => this.io.broadcast(this),
        wordApproved: (w) => this.addRoomWord(w),
        playerLex: (id) => this.playerLex(id),
        theme: (id) => this.member(id)?.theme ?? null,
        record: (rec) => appendAgari({ ...rec, room: this.code }),
      },
    });
    for (const m of seated) if (!m.isBot && m.sockets.size === 0) this.game.setConnected(m.id, false);
    this.system(`対局開始：${seated.map((m) => m.name).join("、")}`);
    this.game.start();
    return null;
  }

  backToLobby() {
    if (this.game && !this.game.isOver) return;
    this.game?.destroy();
    this.game = null;
    this.seatedIds = [];
  }

  abortGame() {
    this.game?.destroy();
    this.game = null;
    this.seatedIds = [];
    this.system("対局を中断しました");
  }

  gameAction(m: Member, a: GameAction): string | null {
    if (!this.game) return "対局していません";
    return this.game.act(m.id, a);
  }

  arrange(m: Member, arr: Arrangement) {
    this.game?.setArrangement(m.id, arr);
  }

  view(forId: string): RoomView {
    const inGame = !!this.game;
    return {
      code: this.code,
      you: forId,
      isHost: forId === this.hostId,
      players: this.members.map((m) => ({
        id: m.id,
        name: m.name,
        isBot: m.isBot,
        botLevel: m.botLevel,
        connected: m.isBot || m.sockets.size > 0,
        isHost: m.id === this.hostId,
      })),
      spectators: inGame ? this.members.filter((m) => !this.seatedIds.includes(m.id)).map((m) => m.name) : [],
      settings: this.settings,
      roomWords: this.roomWords,
      chat: this.chat,
      inGame,
    };
  }
}
