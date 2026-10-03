// 対局の進行（サーバー側で全ての判定を行う）
import { Arrangement, checkComplete, Completed, completeWith, groupsWithChars, reconcile, WordCheck } from "../shared/arrange";
import { Lexicon } from "../shared/lexicon";
import type {
  ActionsView,
  BotLevel,
  CallOption,
  DiscardView,
  FinalView,
  GameAction,
  GameEvent,
  GameView,
  HandResultView,
  MeldType,
  RoomSettings,
  SeatView,
  VoteItem,
  WinView,
} from "../shared/protocol";
import { TIMER_SECONDS } from "../shared/protocol";
import { buildTileChars, KINDS, NUM_KINDS, Tile, WIND_NAMES } from "../shared/tiles";
import { computeYaku, paymentFor, YakuInput, YakuResult } from "../shared/yaku";
import { BotBrain } from "./bot";

export interface GamePlayerInfo {
  id: string;
  name: string;
  isBot: boolean;
  botLevel?: BotLevel;
  botLex?: Lexicon;
}

interface Meld {
  type: MeldType;
  tiles: Tile[];
  word: string;
  from: number | null;
  calledId: number | null;
}

interface HP {
  hand: Tile[];
  melds: Meld[];
  discards: DiscardView[];
  arr: Arrangement;
  riichi: null | { open: boolean; double: boolean; accepted: boolean };
  ippatsu: boolean;
  tempFuriten: boolean;
  riichiFuriten: boolean;
  /** ポン・明カン・加カンをした（門前でない・ロン不可） */
  called: boolean;
  drawnId: number | null;
  bank: number;
}

interface CallState {
  seat: number;
  ron: Completed | null;
  ronMissed: boolean;
  pon: CallOption[];
  kan: CallOption[];
  response: null | { call: "ron" | "pon" | "kan" | "pass"; optionId?: number };
  startedAt: number;
}

interface Claim {
  seat: number;
  from: number | null;
  tile: Tile | null;
  form: "standard" | "chiitoi" | "sakubun";
  completed: Completed | null;
  sentence?: string;
  theme: { name: string; pure: boolean } | null;
  items: VoteItem[];
  ippatsu: boolean;
  tenhou: boolean;
  chiihou: boolean;
}

interface VoteState {
  claims: Claim[];
  voters: number[];
  votes: Map<number, Record<number, boolean>>;
  deadline: number | null;
  /** ロンの投票か（否決時の再開方法が違う） */
  ron: boolean;
}

export interface GameHooks {
  update: () => void;
  wordApproved: (word: string) => void;
  playerLex: (playerId: string) => Lexicon;
  theme: (playerId: string) => { name: string; pure: boolean } | null;
  log?: (msg: string) => void;
}

const RULES = {
  4: { start: 22, ret: 27, uma: [15, 5, -5, -15], oka: 20 },
  3: { start: 29, ret: 34, uma: [15, 0, -15], oka: 15 },
  2: { start: 22, ret: 27, uma: [10, -10], oka: 10 },
} as const;

export class Game {
  readonly n: number;
  readonly settings: RoomSettings;
  readonly players: (GamePlayerInfo & { score: number; connected: boolean; brain?: BotBrain })[];
  private hooks: GameHooks;
  /** テストやシミュレーション用：待ち時間なし */
  private fast: boolean;

  roundWind = 0;
  kyoku = 0;
  honba = 0;
  kyotaku = 0;
  private handRiichiSticks = 0;

  private hands: HP[] = [];
  private wall: Tile[] = [];
  private drawPos = 0;
  private rinshanTaken = 0;
  turn = 0;
  step: "turn" | "calls" | "vote" | "result" | "final" = "turn";
  private afterCall = false;
  private noCallYet = true;
  private kanOwners: number[] = [];
  private lastDiscard: { seat: number; tile: Tile } | null = null;
  private calls = new Map<number, CallState>();
  private vote: VoteState | null = null;
  private turnActions: Extract<ActionsView, { kind: "turn" }> | null = null;
  private turnStartedAt = 0;
  private result: HandResultView | null = null;
  private final: FinalView | null = null;
  private nextHandPlan: (() => void) | null = null;
  private ready = new Set<number>();
  private events: GameEvent[] = [];
  private seq = 0;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private lexCache = new Map<number, Lexicon>();
  private destroyed = false;
  handCount = 0;

  /** presetWall: テスト用に最初の局の山を固定する（文字の並び） */
  private presetWall: string[] | null;

  constructor(opts: { settings: RoomSettings; players: GamePlayerInfo[]; hooks: GameHooks; fast?: boolean; presetWall?: string[] }) {
    this.presetWall = opts.presetWall ?? null;
    this.settings = opts.settings;
    this.n = opts.players.length;
    const rule = RULES[this.n as 2 | 3 | 4];
    this.players = opts.players.map((p, i) => ({
      ...p,
      score: rule.start,
      connected: true,
      brain: p.isBot && p.botLex ? new BotBrain(p.botLex, (Date.now() + i * 7919) >>> 0) : undefined,
    }));
    this.hooks = opts.hooks;
    this.fast = !!opts.fast;
  }

  // ------------------------------------------------------------------ 基本

  start() {
    this.startHand();
  }

  destroy() {
    this.destroyed = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  get dealer() {
    return this.kyoku;
  }
  private get rule() {
    return RULES[this.n as 2 | 3 | 4];
  }
  get liveRemaining() {
    return this.wall.length - 14 - this.rinshanTaken - this.drawPos;
  }
  private next(seat: number) {
    return (seat + 1) % this.n;
  }
  private seatOf(playerId: string) {
    return this.players.findIndex((p) => p.id === playerId);
  }
  private isHuman(seat: number) {
    return !this.players[seat].isBot;
  }
  private menzen(hp: HP) {
    return !hp.called;
  }
  private totalKans() {
    return this.kanOwners.length;
  }

  invalidateLex(playerId?: string) {
    if (playerId === undefined) this.lexCache.clear();
    else this.lexCache.delete(this.seatOf(playerId));
  }
  private lex(seat: number): Lexicon {
    let lx = this.lexCache.get(seat);
    if (!lx) {
      lx = this.hooks.playerLex(this.players[seat].id);
      this.lexCache.set(seat, lx);
    }
    return lx;
  }
  private check(seat: number): WordCheck {
    const lx = this.lex(seat);
    return (w) => lx.lookup(w);
  }

  private emit(type: GameEvent["type"], seat: number, text?: string) {
    this.events.push({ seq: ++this.seq, type, seat, text });
    if (this.events.length > 40) this.events.shift();
  }

  private log(msg: string) {
    this.hooks.log?.(msg);
  }

  private setTimer(key: string, ms: number, fn: () => void) {
    this.clearTimer(key);
    if (this.destroyed) return;
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        if (this.destroyed) return;
        try {
          fn();
        } catch (e) {
          console.error("[game] timer error", e);
        }
        this.hooks.update();
      }, ms),
    );
  }
  private clearTimer(key: string) {
    const t = this.timers.get(key);
    if (t) clearTimeout(t);
    this.timers.delete(key);
  }

  private timing() {
    return TIMER_SECONDS[this.settings.timer];
  }

  /** 人間の持ち時間を設定する。戻り値は締め切り（ms）。null=無制限 */
  private armActionTimer(seat: number, key: string, onTimeout: () => void): void {
    const p = this.players[seat];
    if (p.isBot) return;
    const { base } = this.timing();
    if (!p.connected) {
      this.setTimer(key, this.fast ? 0 : 1200, onTimeout);
      return;
    }
    if (base === 0) return;
    const ms = (base + this.hands[seat].bank) * 1000;
    this.setTimer(key, ms, () => {
      this.hands[seat].bank = 0;
      onTimeout();
    });
  }
  private consumeBank(seat: number, startedAt: number) {
    const { base } = this.timing();
    if (base === 0) return;
    const used = (Date.now() - startedAt) / 1000 - base;
    if (used > 0) this.hands[seat].bank = Math.max(0, this.hands[seat].bank - used);
  }
  private deadlineFor(seat: number, startedAt: number): number | null {
    const { base } = this.timing();
    if (base === 0 || this.players[seat].isBot) return null;
    return startedAt + (base + this.hands[seat].bank) * 1000;
  }

  private botDelay(min = 700, max = 1400) {
    return this.fast ? 0 : min + Math.random() * (max - min);
  }

  // ------------------------------------------------------------------ 局の開始

  private startHand() {
    this.handCount++;
    let tiles: Tile[];
    if (this.presetWall) {
      tiles = this.presetWall.map((ch, id) => ({ id, ch }));
      this.presetWall = null;
    } else {
      tiles = buildTileChars(this.settings.extraTiles).map((ch, id) => ({ id, ch }));
      for (let i = tiles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
      }
    }
    this.wall = tiles;
    this.drawPos = 0;
    this.rinshanTaken = 0;
    this.noCallYet = true;
    this.kanOwners = [];
    this.lastDiscard = null;
    this.calls.clear();
    this.vote = null;
    this.result = null;
    this.handRiichiSticks = 0;
    this.lexCache.clear();
    const bank = this.timing().bank;
    this.hands = this.players.map(() => ({
      hand: [],
      melds: [],
      discards: [],
      arr: { order: [], breaks: [] },
      riichi: null,
      ippatsu: false,
      tempFuriten: false,
      riichiFuriten: false,
      called: false,
      drawnId: null,
      bank,
    }));
    for (let r = 0; r < 13; r++) {
      for (let k = 0; k < this.n; k++) {
        const s = (this.dealer + k) % this.n;
        this.hands[s].hand.push(this.wall[this.drawPos++]);
      }
    }
    for (const hp of this.hands) hp.arr = reconcile(null, hp.hand);
    this.emit("start", this.dealer, `${WIND_NAMES[this.roundWind]}${this.kyoku + 1}局`);
    this.log(`=== ${WIND_NAMES[this.roundWind]}${this.kyoku + 1}局 ${this.honba}本場 ===`);
    this.beginTurn(this.dealer, "draw");
  }

  // ------------------------------------------------------------------ 手番

  private beginTurn(seat: number, kind: "draw" | "afterCall" | "rinshan", count = 1) {
    this.turn = seat;
    this.step = "turn";
    this.afterCall = kind === "afterCall";
    const hp = this.hands[seat];
    if (kind === "draw") {
      const t = this.wall[this.drawPos++];
      hp.hand.push(t);
      hp.drawnId = t.id;
      hp.tempFuriten = false;
      this.emit("draw", seat);
    } else if (kind === "rinshan") {
      for (let i = 0; i < count; i++) {
        const t = this.wall[this.wall.length - 1 - this.rinshanTaken++];
        hp.hand.push(t);
        hp.drawnId = t.id;
      }
      hp.tempFuriten = false;
    } else {
      hp.drawnId = null;
    }
    hp.arr = reconcile(hp.arr, hp.hand);
    this.turnActions = this.computeTurnActions(seat);
    this.turnStartedAt = Date.now();
    this.armActionTimer(seat, "turn", () => this.autoDiscard(seat));
    if (this.players[seat].isBot) this.setTimer("bot", this.botDelay(), () => this.botTurn(seat));
    else if (hp.riichi && !this.turnActions.canTsumo && this.turnActions.ankan.length === 0) {
      // リーチ後はアガれない牌なら自動でツモ切り
      this.setTimer("turn", this.fast ? 0 : 900, () => this.autoDiscard(seat));
    }
  }

  private autoDiscard(seat: number) {
    if (this.step !== "turn" || this.turn !== seat) return;
    const hp = this.hands[seat];
    const id = hp.drawnId ?? hp.hand[hp.hand.length - 1].id;
    this.doDiscard(seat, id);
  }

  /** 並べた手牌から牌IDを1つ取り除いた並び */
  private withoutId(arr: Arrangement, id: number): Arrangement {
    const i = arr.order.indexOf(id);
    if (i < 0) return arr;
    const order = arr.order.filter((x) => x !== id);
    const breaks = new Set(arr.breaks.filter((x) => x !== id));
    if (arr.breaks.includes(id) && i > 0) breaks.add(arr.order[i - 1]);
    if (order.length) breaks.delete(order[order.length - 1]);
    return { order, breaks: [...breaks] };
  }

  private handGroups(seat: number, arr?: Arrangement, hand?: Tile[]) {
    const hp = this.hands[seat];
    return groupsWithChars(arr ?? hp.arr, hand ?? hp.hand);
  }

  /** 並べた13-3m枚の待ち（牌の種類） */
  private waitsOfGroups(seat: number, groups: { word: string; ids: number[] }[]): string[] {
    const hp = this.hands[seat];
    const chk = this.check(seat);
    const lx = this.lex(seat);
    const out: string[] = [];
    for (let k = 0; k < NUM_KINDS; k++) {
      if (lx.supply[k] === 0) continue;
      if (completeWith(groups, { ch: KINDS[k], id: -1 }, hp.melds.length, chk)) out.push(KINDS[k]);
    }
    return out;
  }

  private tsumoCompletion(seat: number): Completed | null {
    const hp = this.hands[seat];
    const chk = this.check(seat);
    const m = hp.melds.length;
    const full = checkComplete(this.handGroups(seat), m, chk);
    if (full) return full;
    if (hp.drawnId === null) return null;
    const drawn = hp.hand.find((t) => t.id === hp.drawnId)!;
    const rest = hp.hand.filter((t) => t.id !== hp.drawnId);
    const groups = this.handGroups(seat, this.withoutId(hp.arr, drawn.id), rest);
    return completeWith(groups, drawn, m, chk);
  }

  private computeTurnActions(seat: number): Extract<ActionsView, { kind: "turn" }> {
    const hp = this.hands[seat];
    const lx = this.lex(seat);
    const locked = !!hp.riichi;
    const out: Extract<ActionsView, { kind: "turn" }> = {
      kind: "turn",
      canTsumo: false,
      riichiDiscards: [],
      ankan: [],
      kakan: [],
      canSakubun: false,
      locked,
      afterCall: this.afterCall,
    };
    if (this.afterCall) return out;
    const comp = this.tsumoCompletion(seat);
    if (comp) {
      const y = this.yakuFor(this.claimFor(seat, null, this.drawnTile(seat), comp), true);
      out.canTsumo = y.mainHan >= 1;
    }
    // 作文：14牌を区切らずに1つの組として並べたとき
    out.canSakubun = hp.melds.length === 0 && hp.hand.length === 14 && hp.arr.breaks.length === 0;
    const groups = this.handGroups(seat);
    // 暗カン：4文字以上の語として並べた組
    if (!locked && this.totalKans() < 4) {
      let id = 0;
      for (const g of groups) {
        const len = g.ids.length;
        if (len >= 4 && len - 3 <= this.liveRemaining && lx.lookup(g.word)) out.ankan.push({ id: id++, word: g.word, tileIds: g.ids });
      }
      // 加カン：ポンした語に手牌の組を差し込む
      id = 0;
      hp.melds.forEach((m) => {
        if (m.type !== "pon") return;
        const mc = m.tiles;
        for (const g of groups) {
          if (g.ids.length + 3 - 3 > this.liveRemaining) continue;
          for (let p = 0; p <= 3; p++) {
            const ids = [...mc.slice(0, p).map((t) => t.id), ...g.ids, ...mc.slice(p).map((t) => t.id)];
            const word = [...m.word].slice(0, p).join("") + g.word + [...m.word].slice(p).join("");
            if (lx.lookup(word) && !out.kakan.some((o) => o.word === word)) out.kakan.push({ id: id++, word, tileIds: ids });
          }
        }
      });
    }
    // リーチ：その牌を切るとテンパイになる牌
    const r = this.players[seat].score;
    if (!hp.riichi && this.menzen(hp) && r >= 1 && this.liveRemaining >= 4) {
      for (const t of hp.hand) {
        const arr = this.withoutId(hp.arr, t.id);
        const g = this.handGroups(
          seat,
          arr,
          hp.hand.filter((x) => x.id !== t.id),
        );
        if (this.waitsOfGroups(seat, g).length > 0) out.riichiDiscards.push(t.id);
      }
    }
    return out;
  }

  private drawnTile(seat: number): Tile | null {
    const hp = this.hands[seat];
    return hp.drawnId === null ? null : (hp.hand.find((t) => t.id === hp.drawnId) ?? null);
  }

  // ------------------------------------------------------------------ 打牌と鳴き

  private doDiscard(seat: number, tileId: number, riichi?: "riichi" | "open"): string | null {
    if (this.step !== "turn" || this.turn !== seat) return "あなたの手番ではありません";
    const hp = this.hands[seat];
    const idx = hp.hand.findIndex((t) => t.id === tileId);
    if (idx < 0) return "その牌はありません";
    if (hp.riichi && tileId !== hp.drawnId) return "リーチ後はツモ切りのみです";
    if (riichi) {
      // 並べ替え後の状態で再計算
      this.turnActions = this.computeTurnActions(seat);
      if (!this.turnActions.riichiDiscards.includes(tileId)) return "その牌ではリーチできません";
    }
    this.clearTimer("turn");
    this.clearTimer("bot");
    this.consumeBank(seat, this.turnStartedAt);
    const tile = hp.hand[idx];
    const tsumogiri = tileId === hp.drawnId;
    hp.hand.splice(idx, 1);
    hp.arr = this.withoutId(hp.arr, tileId);
    if (hp.ippatsu && !riichi) hp.ippatsu = false;
    if (riichi) {
      hp.riichi = { open: riichi === "open", double: hp.discards.length === 0 && this.noCallYet, accepted: false };
      this.emit("riichi", seat, riichi === "open" ? "オープンリーチ" : "リーチ");
    }
    hp.discards.push({ tile, riichi: !!riichi, called: false, tsumogiri });
    hp.drawnId = null;
    this.lastDiscard = { seat, tile };
    this.turnActions = null;
    this.emit("discard", seat, tile.ch);
    this.openCallWindow();
    return null;
  }

  private discardFuriten(seat: number, groups: { word: string; ids: number[] }[]) {
    const hp = this.hands[seat];
    const waits = this.waitsOfGroups(seat, groups);
    return hp.discards.some((d) => waits.includes(d.tile.ch));
  }

  private openCallWindow() {
    const d = this.lastDiscard!;
    this.calls.clear();
    for (let k = 1; k < this.n; k++) {
      const s = (d.seat + k) % this.n;
      const cs = this.callOptions(s, d.tile);
      if (cs) this.calls.set(s, cs);
    }
    if (this.calls.size === 0) {
      this.finalizeDiscard();
      return;
    }
    this.step = "calls";
    for (const cs of this.calls.values()) {
      const s = cs.seat;
      if (this.players[s].isBot) this.setTimer(`bot-call-${s}`, this.botDelay(400, 900), () => this.botCall(s));
      else this.armActionTimer(s, `call-${s}`, () => this.respondCall(s, { call: "pass" }));
    }
  }

  private callOptions(seat: number, tile: Tile): CallState | null {
    const hp = this.hands[seat];
    const lx = this.lex(seat);
    const chk = this.check(seat);
    const groups = this.handGroups(seat);
    let ron: Completed | null = null;
    let ronMissed = false;
    if (!hp.called) {
      const comp = completeWith(groups, tile, hp.melds.length, chk);
      if (comp) {
        const furiten = hp.tempFuriten || hp.riichiFuriten || this.discardFuriten(seat, groups);
        const y = this.yakuFor(this.claimFor(seat, this.lastDiscard!.seat, tile, comp), true);
        if (y.mainHan >= 1) {
          if (furiten) ronMissed = true;
          else ron = comp;
        }
      }
    }
    const pon: CallOption[] = [];
    const kan: CallOption[] = [];
    if (this.settings.calls && !hp.riichi && this.liveRemaining > 0) {
      let pid = 0;
      let kid = 0;
      for (const g of groups) {
        const chars = [...g.word];
        for (let p = 0; p <= chars.length; p++) {
          const word = [...chars.slice(0, p), tile.ch, ...chars.slice(p)].join("");
          const ids = [...g.ids.slice(0, p), tile.id, ...g.ids.slice(p)];
          if (!lx.lookup(word)) continue;
          if (chars.length === 2 && hp.hand.length >= 3) {
            if (!pon.some((o) => o.word === word)) pon.push({ id: pid++, word, tileIds: ids });
          } else if (chars.length >= 3 && this.totalKans() < 4 && chars.length + 1 - 3 <= this.liveRemaining) {
            if (!kan.some((o) => o.word === word)) kan.push({ id: kid++, word, tileIds: ids });
          }
        }
      }
    }
    if (ronMissed && hp.riichi) hp.riichiFuriten = true;
    if (!ron && pon.length === 0 && kan.length === 0) {
      if (ronMissed) hp.tempFuriten = true;
      return null;
    }
    return { seat, ron, ronMissed, pon, kan, response: null, startedAt: Date.now() };
  }

  private respondCall(seat: number, r: { call: "ron" | "pon" | "kan" | "pass"; optionId?: number }): string | null {
    if (this.step !== "calls") return "今は鳴けません";
    const cs = this.calls.get(seat);
    if (!cs || cs.response) return "応答済みです";
    if (r.call === "ron" && !cs.ron) return "ロンできません";
    if (r.call === "pon" && !cs.pon.some((o) => o.id === r.optionId)) return "その語ではポンできません";
    if (r.call === "kan" && !cs.kan.some((o) => o.id === r.optionId)) return "その語ではカンできません";
    cs.response = r;
    this.clearTimer(`call-${seat}`);
    this.clearTimer(`bot-call-${seat}`);
    this.consumeBank(seat, cs.startedAt);
    if ([...this.calls.values()].every((c) => c.response)) this.resolveCalls();
    return null;
  }

  private resolveCalls() {
    const d = this.lastDiscard!;
    const order = [...this.calls.values()].sort((a, b) => ((a.seat - d.seat + this.n) % this.n) - ((b.seat - d.seat + this.n) % this.n));
    for (const c of order) {
      if (c.ron && c.response?.call !== "ron") {
        this.hands[c.seat].tempFuriten = true;
        if (this.hands[c.seat].riichi) this.hands[c.seat].riichiFuriten = true;
      }
    }
    const rons = order.filter((c) => c.response?.call === "ron");
    if (rons.length > 0) {
      if (rons.length >= 3 && this.n === 4) {
        this.abortHand("三家和了");
        return;
      }
      const claims = rons.map((c) => this.claimFor(c.seat, d.seat, d.tile, c.ron!));
      this.declareWins(claims);
      return;
    }
    const kan = order.find((c) => c.response?.call === "kan");
    if (kan) {
      this.doMinkan(kan.seat, kan.kan.find((o) => o.id === kan.response!.optionId)!);
      return;
    }
    const pon = order.find((c) => c.response?.call === "pon");
    if (pon) {
      this.doPon(pon.seat, pon.pon.find((o) => o.id === pon.response!.optionId)!);
      return;
    }
    this.finalizeDiscard();
  }

  private takeCalled(seat: number, opt: CallOption): Tile[] {
    const d = this.lastDiscard!;
    const hp = this.hands[seat];
    const dd = this.hands[d.seat].discards;
    dd[dd.length - 1].called = true;
    const tiles = opt.tileIds.map((id) => (id === d.tile.id ? d.tile : hp.hand.find((t) => t.id === id)!));
    const used = new Set(opt.tileIds);
    hp.hand = hp.hand.filter((t) => !used.has(t.id));
    hp.arr = reconcile(hp.arr, hp.hand);
    return tiles;
  }

  private breakIppatsu() {
    for (const hp of this.hands) hp.ippatsu = false;
    this.noCallYet = false;
  }

  private doPon(seat: number, opt: CallOption) {
    const d = this.lastDiscard!;
    const tiles = this.takeCalled(seat, opt);
    const hp = this.hands[seat];
    hp.melds.push({ type: "pon", tiles, word: opt.word, from: d.seat, calledId: d.tile.id });
    hp.called = true;
    this.breakIppatsu();
    this.calls.clear();
    this.emit("pon", seat, opt.word);
    this.beginTurn(seat, "afterCall");
  }

  private doMinkan(seat: number, opt: CallOption) {
    const d = this.lastDiscard!;
    const tiles = this.takeCalled(seat, opt);
    const hp = this.hands[seat];
    hp.melds.push({ type: "minkan", tiles, word: opt.word, from: d.seat, calledId: d.tile.id });
    hp.called = true;
    this.kanOwners.push(seat);
    this.breakIppatsu();
    this.calls.clear();
    this.emit("kan", seat, opt.word);
    this.beginTurn(seat, "rinshan", tiles.length - 3);
  }

  private doAnkan(seat: number, optionId: number): string | null {
    const opt = this.turnActions?.ankan.find((o) => o.id === optionId);
    if (!opt) return "カンできません";
    const hp = this.hands[seat];
    const used = new Set(opt.tileIds);
    const tiles = opt.tileIds.map((id) => hp.hand.find((t) => t.id === id)!);
    hp.hand = hp.hand.filter((t) => !used.has(t.id));
    hp.arr = reconcile(hp.arr, hp.hand);
    hp.melds.push({ type: "ankan", tiles, word: opt.word, from: null, calledId: null });
    this.kanOwners.push(seat);
    this.breakIppatsu();
    this.clearTimer("turn");
    this.consumeBank(seat, this.turnStartedAt);
    this.emit("ankan", seat, opt.word);
    this.beginTurn(seat, "rinshan", tiles.length - 3);
    return null;
  }

  private doKakan(seat: number, optionId: number): string | null {
    const opt = this.turnActions?.kakan.find((o) => o.id === optionId);
    if (!opt) return "カンできません";
    const hp = this.hands[seat];
    const meld = hp.melds.find((m) => m.type === "pon" && opt.tileIds.includes(m.tiles[0].id));
    if (!meld) return "カンできません";
    const meldIds = new Set(meld.tiles.map((t) => t.id));
    const added = opt.tileIds.filter((id) => !meldIds.has(id));
    const addedSet = new Set(added);
    const all = [...meld.tiles, ...hp.hand.filter((t) => addedSet.has(t.id))];
    meld.tiles = opt.tileIds.map((id) => all.find((t) => t.id === id)!);
    meld.word = opt.word;
    meld.type = "kakan";
    hp.hand = hp.hand.filter((t) => !addedSet.has(t.id));
    hp.arr = reconcile(hp.arr, hp.hand);
    this.kanOwners.push(seat);
    this.breakIppatsu();
    this.clearTimer("turn");
    this.consumeBank(seat, this.turnStartedAt);
    this.emit("kakan", seat, opt.word);
    this.beginTurn(seat, "rinshan", added.length);
    return null;
  }

  private finalizeDiscard() {
    const d = this.lastDiscard!;
    const dp = this.hands[d.seat];
    this.calls.clear();
    if (dp.riichi && !dp.riichi.accepted) {
      dp.riichi.accepted = true;
      dp.ippatsu = true;
      this.players[d.seat].score -= 1;
      this.kyotaku += 1;
      this.handRiichiSticks += 1;
    }
    if (this.n === 4 && this.hands.every((h) => h.riichi?.accepted)) {
      this.abortHand("四家立直");
      return;
    }
    if (this.totalKans() >= 4 && new Set(this.kanOwners).size >= 2) {
      this.abortHand("四開槓");
      return;
    }
    if (this.liveRemaining <= 0) {
      this.exhaustiveDraw();
      return;
    }
    this.beginTurn(this.next(d.seat), "draw");
  }

  // ------------------------------------------------------------------ アガリ

  private claimFor(seat: number, from: number | null, tile: Tile | null, comp: Completed | null, sentence?: string): Claim {
    const hp = this.hands[seat];
    const isDealer = seat === this.dealer;
    const form = sentence !== undefined ? "sakubun" : comp!.form;
    const theme = form === "standard" ? this.hooks.theme(this.players[seat].id) : null;
    const items: VoteItem[] = [];
    let iid = 0;
    if (form === "sakubun") items.push({ id: iid++, kind: "sakubun", text: sentence!, detail: "14牌で1つの文章になっていますか？" });
    else for (const w of comp!.unverified) items.push({ id: iid++, kind: "word", text: w, detail: "辞書にない語です。言葉として認めますか？" });
    if (theme) {
      items.push({ id: iid++, kind: "theme", text: `${theme.pure ? "純同種" : "同種"}「${theme.name}」`, detail: theme.pure ? "頭を含む全ての語が同じテーマですか？" : "頭以外の語が全て同じテーマですか？" });
    }
    return {
      seat,
      from,
      tile,
      form,
      completed: comp,
      sentence,
      theme,
      items,
      ippatsu: hp.ippatsu,
      tenhou: from === null && isDealer && hp.discards.length === 0 && this.noCallYet && this.rinshanTaken === 0,
      chiihou: from !== null && from === this.dealer && !isDealer && this.hands[this.dealer].discards.length === 1 && this.noCallYet,
    };
  }

  private winGroups(claim: Claim) {
    const hp = this.hands[claim.seat];
    const byId = new Map<number, Tile>(hp.hand.map((t) => [t.id, t]));
    if (claim.tile) byId.set(claim.tile.id, claim.tile);
    const handGroups =
      claim.form === "sakubun"
        ? [{ word: claim.sentence!, tiles: this.handGroups(claim.seat).flatMap((g) => g.ids.map((id) => byId.get(id)!)), meld: null, head: false }]
        : claim.completed!.hand.map((g) => ({ word: g.word, tiles: g.ids.map((id) => byId.get(id)!), meld: null as MeldType | null, head: claim.completed!.form === "standard" && [...g.word].length === 2 }));
    const meldGroups = hp.melds.map((m) => ({ word: m.word, tiles: m.tiles, meld: m.type as MeldType | null, head: false }));
    return [...handGroups, ...meldGroups];
  }

  private yakuFor(claim: Claim, withoutTheme = false): YakuResult {
    const hp = this.hands[claim.seat];
    const groups = this.winGroups(claim);
    const inp: YakuInput = {
      form: claim.form,
      groups: groups.map((g) => ({ word: g.word, concealed: g.meld === null || g.meld === "ankan", kan: g.meld === "minkan" || g.meld === "ankan" || g.meld === "kakan", head: g.head })),
      tiles: groups.flatMap((g) => g.tiles.map((t) => t.ch)),
      menzen: this.menzen(hp),
      tsumo: claim.from === null,
      riichi: hp.riichi ? { open: hp.riichi.open, double: hp.riichi.double } : null,
      ippatsu: claim.ippatsu && !!hp.riichi,
      tenhou: claim.tenhou,
      chiihou: claim.chiihou,
      theme: withoutTheme ? null : claim.theme,
    };
    return computeYaku(inp);
  }

  private declareWins(claims: Claim[]) {
    this.clearTimer("turn");
    this.clearTimer("bot");
    for (const c of claims) this.emit(c.from === null ? "tsumo" : "ron", c.seat);
    const needVote = claims.some((c) => c.items.length > 0);
    const voters = this.players.map((_, i) => i).filter((s) => this.isHuman(s) && this.players[s].connected && !claims.some((c) => c.seat === s));
    if (needVote && voters.length > 0) {
      this.step = "vote";
      this.vote = {
        claims,
        voters,
        votes: new Map(),
        deadline: this.fast ? null : Date.now() + 45000,
        ron: claims[0].from !== null,
      };
      this.emit("vote", claims[0].seat);
      this.setTimer("vote", this.fast ? 0 : 45000, () => this.resolveVote());
      return;
    }
    this.applyClaims(claims.map((c) => ({ claim: c, approved: new Set(c.items.map((i) => i.id)) })));
  }

  private castVote(seat: number, votes: Record<number, boolean>): string | null {
    const v = this.vote;
    if (this.step !== "vote" || !v) return "投票中ではありません";
    if (!v.voters.includes(seat)) return "投票できません";
    v.votes.set(seat, votes);
    if (v.voters.every((s) => v.votes.has(s))) this.resolveVote();
    return null;
  }

  private resolveVote() {
    const v = this.vote;
    if (!v || this.step !== "vote") return;
    this.clearTimer("vote");
    const results = v.claims.map((claim, ci) => {
      const approved = new Set<number>();
      for (const it of claim.items) {
        let yes = 0;
        let no = 0;
        for (const s of v.voters) {
          const r = v.votes.get(s)?.[ci * 100 + it.id];
          if (r === false) no++;
          else yes++; // 時間切れ・未回答は承認扱い
        }
        if (yes > no) approved.add(it.id);
      }
      return { claim, approved };
    });
    this.vote = null;
    this.applyClaims(results);
  }

  private applyClaims(results: { claim: Claim; approved: Set<number> }[]) {
    const valid: { claim: Claim; yaku: YakuResult }[] = [];
    const rejected: { claim: Claim; reason: string; serious: boolean }[] = [];
    for (const { claim, approved } of results) {
      const badItem = claim.items.find((i) => i.kind !== "theme" && !approved.has(i.id));
      for (const i of claim.items) {
        if (i.kind === "word") {
          if (approved.has(i.id)) this.hooks.wordApproved(i.text);
        }
      }
      if (badItem) {
        rejected.push({ claim, reason: badItem.kind === "word" ? `「${badItem.text}」は認められませんでした` : "作文は認められませんでした", serious: true });
        continue;
      }
      const themeItem = claim.items.find((i) => i.kind === "theme");
      if (themeItem && !approved.has(themeItem.id)) claim.theme = null;
      const yaku = this.yakuFor(claim);
      if (yaku.mainHan < 1) {
        rejected.push({ claim, reason: "役がありません", serious: false });
        continue;
      }
      valid.push({ claim, yaku });
    }
    for (const r of rejected) this.emit("reject", r.claim.seat, r.reason);
    if (valid.length > 0) {
      this.finishAgari(valid);
      return;
    }
    const first = rejected[0];
    if (this.settings.rejectPenalty === "chombo" && first.serious) {
      this.chombo(first.claim.seat, first.reason);
      return;
    }
    // 取り消し：ゲームを続ける
    if (first.claim.from === null) {
      const seat = first.claim.seat;
      this.step = "turn";
      this.turn = seat;
      this.turnActions = this.computeTurnActions(seat);
      this.turnActions.canTsumo = false;
      this.turnActions.canSakubun = false;
      this.turnStartedAt = Date.now();
      this.armActionTimer(seat, "turn", () => this.autoDiscard(seat));
      if (this.players[seat].isBot) this.setTimer("bot", this.botDelay(), () => this.botTurn(seat, true));
    } else {
      for (const r of rejected) this.hands[r.claim.seat].tempFuriten = true;
      this.finalizeDiscard();
    }
  }

  private finishAgari(wins: { claim: Claim; yaku: YakuResult }[]) {
    const before = this.players.map((p) => p.score);
    const deltas = this.players.map(() => 0);
    const from = wins[0].claim.from;
    const views: WinView[] = [];
    wins.forEach(({ claim, yaku }, i) => {
      const s = claim.seat;
      const isDealer = s === this.dealer;
      const pay = paymentFor(yaku.han, yaku.yakuman, isDealer);
      let gain = 0;
      if (claim.from !== null) {
        const amt = pay.ron + (i === 0 ? this.honba : 0);
        deltas[claim.from] -= amt;
        gain += amt;
      } else {
        for (let o = 0; o < this.n; o++) {
          if (o === s) continue;
          let amt = isDealer ? pay.tsumoChild : o === this.dealer ? pay.tsumoDealer : pay.tsumoChild;
          // 本場：子のツモは親、親のツモは下家がまとめて払う
          if ((isDealer && o === this.next(this.dealer)) || (!isDealer && o === this.dealer)) amt += this.honba;
          deltas[o] -= amt;
          gain += amt;
        }
      }
      if (i === 0) {
        gain += this.kyotaku;
        this.kyotaku = 0;
      }
      deltas[s] += gain;
      views.push({
        seat: s,
        name: this.players[s].name,
        fromSeat: claim.from,
        form: claim.form,
        groups: this.winGroups(claim),
        winTile: claim.tile,
        yaku: yaku.items,
        han: yaku.han,
        label: yaku.label,
        yakuman: yaku.yakuman,
        gain,
        dealer: isDealer,
      });
      this.log(`${claim.from === null ? "ツモ" : "ロン"} ${this.players[s].name} ${views[views.length - 1].groups.map((g) => g.word).join("・")} ${yaku.label} +${gain}`);
    });
    deltas.forEach((d, i) => (this.players[i].score += d));
    this.result = {
      kind: "agari",
      title: from === null ? "ツモ" : wins.length > 1 ? "ダブロン" : "ロン",
      wins: views,
      tenpai: [],
      before,
      deltas,
      after: this.players.map((p) => p.score),
    };
    const dealerWon = wins.some((w) => w.claim.seat === this.dealer);
    this.toResult(() => this.advance(dealerWon ? "renchan" : "rotate", dealerWon ? this.honba + 1 : 0));
  }

  private exhaustiveDraw() {
    const before = this.players.map((p) => p.score);
    const tenpai = this.players.map((_, s) => this.waitsOfGroups(s, this.handGroups(s)).length > 0);
    const t = tenpai.filter(Boolean).length;
    const deltas = this.players.map(() => 0);
    if (t > 0 && t < this.n) {
      const noten = this.n - t;
      const pay = t === 1 ? 1 : noten === 1 ? t : 1;
      const recv = t === 1 ? noten : 1;
      tenpai.forEach((tp, i) => (deltas[i] = tp ? recv : -pay));
    }
    deltas.forEach((d, i) => (this.players[i].score += d));
    this.emit("ryuukyoku", this.dealer);
    this.result = {
      kind: "ryuukyoku",
      title: "流局",
      wins: [],
      tenpai: this.players.map((p, s) => ({
        seat: s,
        name: p.name,
        tenpai: tenpai[s],
        groups: tenpai[s] ? this.handGroups(s).map((g) => g.ids.map((id) => this.hands[s].hand.find((x) => x.id === id)!)) : null,
      })),
      before,
      deltas,
      after: this.players.map((p) => p.score),
    };
    const dealerTenpai = tenpai[this.dealer];
    this.toResult(() => this.advance(dealerTenpai ? "renchan" : "rotate", this.honba + 1));
  }

  private abortHand(reason: string) {
    const before = this.players.map((p) => p.score);
    this.emit("abort", this.dealer, reason);
    this.result = { kind: "abort", title: `途中流局（${reason}）`, wins: [], tenpai: [], before, deltas: before.map(() => 0), after: before };
    this.toResult(() => this.advance("renchan", this.honba + 1));
  }

  private chombo(seat: number, reason: string) {
    const before = this.players.map((p) => p.score);
    const deltas = this.players.map(() => 0);
    // 出したリーチ棒は戻す
    this.hands.forEach((h, i) => {
      if (h.riichi?.accepted) {
        deltas[i] += 1;
        this.kyotaku -= 1;
      }
    });
    for (let o = 0; o < this.n; o++) {
      if (o === seat) continue;
      const amt = seat === this.dealer || o === this.dealer ? 4 : 2;
      deltas[o] += amt;
      deltas[seat] -= amt;
    }
    deltas.forEach((d, i) => (this.players[i].score += d));
    this.emit("chombo", seat, reason);
    this.result = { kind: "chombo", title: "チョンボ", wins: [], tenpai: [], before, deltas, after: this.players.map((p) => p.score), note: `${this.players[seat].name}：${reason}` };
    this.toResult(() => this.advance("renchan", this.honba));
  }

  private toResult(next: () => void) {
    this.step = "result";
    this.calls.clear();
    this.turnActions = null;
    this.clearTimer("turn");
    this.clearTimer("bot");
    this.nextHandPlan = next;
    this.ready = new Set(this.players.map((p, i) => (p.isBot || !p.connected ? i : -1)).filter((i) => i >= 0));
    this.setTimer("result", this.fast ? 0 : 40000, () => this.proceedFromResult());
    if (this.ready.size === this.n) this.setTimer("result", this.fast ? 0 : 6000, () => this.proceedFromResult());
  }

  private markReady(seat: number) {
    if (this.step !== "result") return;
    this.ready.add(seat);
    if (this.ready.size >= this.n) this.proceedFromResult();
  }

  private proceedFromResult() {
    if (this.step !== "result" || !this.nextHandPlan) return;
    this.clearTimer("result");
    const f = this.nextHandPlan;
    this.nextHandPlan = null;
    f();
  }

  /** 次の局へ。renchan=親が続く */
  private advance(mode: "renchan" | "rotate", honba: number) {
    const lastWind = this.settings.length === "hanchan" ? 1 : 0;
    const ret = this.rule.ret;
    const top = Math.max(...this.players.map((p) => p.score));
    if (this.settings.length === "ikkyoku") return this.endGame();
    if (this.players.some((p) => p.score < 0)) return this.endGame();
    const isLastKyoku = this.kyoku === this.n - 1 && this.roundWind >= lastWind;
    const inExtension = this.roundWind > lastWind;
    if (inExtension && top >= ret) return this.endGame();
    if (mode === "renchan") {
      // アガリ止め・テンパイ止め：オーラスの親がトップで返し点以上
      const d = this.players[this.dealer].score;
      if (isLastKyoku && d >= ret && this.players.every((p, i) => i === this.dealer || p.score < d)) return this.endGame();
      this.honba = honba;
    } else {
      this.honba = honba;
      this.kyoku++;
      if (this.kyoku >= this.n) {
        this.kyoku = 0;
        this.roundWind++;
      }
      if (this.roundWind > lastWind) {
        if (top >= ret) return this.endGame();
        if (this.roundWind > lastWind + 1) return this.endGame();
      }
    }
    this.startHand();
  }

  private endGame() {
    if (this.kyotaku > 0) {
      const top = this.rankOrder()[0];
      this.players[top].score += this.kyotaku;
      this.kyotaku = 0;
    }
    const order = this.rankOrder();
    const rule = this.rule;
    const ranking = order.map((s, i) => {
      const score = this.players[s].score;
      const pt = score - rule.ret + rule.uma[i] + (i === 0 ? rule.oka : 0);
      return { seat: s, name: this.players[s].name, score, rank: i + 1, pt };
    });
    this.final = { ranking, oneHand: this.settings.length === "ikkyoku" };
    this.step = "final";
    this.log(`=== 終局 ${ranking.map((r) => `${r.rank}位 ${r.name} ${r.score}`).join(" / ")} ===`);
  }

  private rankOrder(): number[] {
    return this.players.map((_, i) => i).sort((a, b) => this.players[b].score - this.players[a].score || a - b);
  }

  get isOver() {
    return this.step === "final";
  }

  // ------------------------------------------------------------------ ボット

  private botTurn(seat: number, afterReject = false) {
    if (this.step !== "turn" || this.turn !== seat) return;
    const p = this.players[seat];
    const brain = p.brain;
    const hp = this.hands[seat];
    if (!brain) return this.autoDiscard(seat);
    // ツモ
    if (!this.afterCall && !afterReject) {
      const arr = brain.completeArrangement(hp.hand, hp.melds.length);
      if (arr) {
        hp.arr = arr;
        this.turnActions = this.computeTurnActions(seat);
        if (this.turnActions.canTsumo) {
          this.act(p.id, { type: "tsumo" });
          return;
        }
      }
    }
    if (hp.riichi) {
      this.autoDiscard(seat);
      return;
    }
    const choice = brain.chooseDiscard(hp.hand, hp.melds.length, this.visibleCounts(seat));
    hp.arr = choice.arrangement;
    let riichi: "riichi" | undefined;
    if (choice.tenpai && this.menzen(hp) && !this.afterCall && p.score >= 1 && this.liveRemaining >= 4 && Math.random() < 0.85) riichi = "riichi";
    const err = this.doDiscard(seat, choice.tileId, riichi);
    if (err) this.doDiscard(seat, choice.tileId);
  }

  private botCall(seat: number) {
    const cs = this.calls.get(seat);
    if (!cs || cs.response) return;
    if (cs.ron) this.respondCall(seat, { call: "ron" });
    else this.respondCall(seat, { call: "pass" });
  }

  private visibleCounts(seat: number): Int8Array {
    const c = new Int8Array(NUM_KINDS);
    const idx = (ch: string) => KINDS.indexOf(ch);
    for (const hp of this.hands) {
      for (const d of hp.discards) c[idx(d.tile.ch)]++;
      for (const m of hp.melds) for (const t of m.tiles) c[idx(t.ch)]++;
    }
    for (const t of this.hands[seat].hand) c[idx(t.ch)]++;
    return c;
  }

  // ------------------------------------------------------------------ 外部からの操作

  act(playerId: string, a: GameAction): string | null {
    const seat = this.seatOf(playerId);
    if (seat < 0) return "対局に参加していません";
    let err: string | null = null;
    switch (a.type) {
      case "discard":
        err = this.doDiscard(seat, a.tileId, a.riichi);
        break;
      case "tsumo": {
        if (this.step !== "turn" || this.turn !== seat || this.afterCall) return "ツモできません";
        const comp = this.tsumoCompletion(seat);
        if (!comp) return "アガリ形になっていません";
        const claim = this.claimFor(seat, null, this.drawnTile(seat), comp);
        if (this.yakuFor(claim, true).mainHan < 1) return "役がありません";
        this.clearTimer("turn");
        this.consumeBank(seat, this.turnStartedAt);
        this.declareWins([claim]);
        break;
      }
      case "sakubun": {
        if (this.step !== "turn" || this.turn !== seat || this.afterCall) return "作文できません";
        const hp = this.hands[seat];
        if (hp.melds.length > 0 || hp.hand.length !== 14) return "作文は鳴きなしの14牌で宣言します";
        const sentence = this.handGroups(seat)
          .map((g) => g.word)
          .join("");
        this.clearTimer("turn");
        this.consumeBank(seat, this.turnStartedAt);
        this.declareWins([this.claimFor(seat, null, this.drawnTile(seat), null, sentence)]);
        break;
      }
      case "ankan":
        if (this.step !== "turn" || this.turn !== seat) return "カンできません";
        this.turnActions = this.computeTurnActions(seat);
        err = this.doAnkan(seat, a.optionId);
        break;
      case "kakan":
        if (this.step !== "turn" || this.turn !== seat) return "カンできません";
        this.turnActions = this.computeTurnActions(seat);
        err = this.doKakan(seat, a.optionId);
        break;
      case "call":
        err = this.respondCall(seat, { call: a.call, optionId: a.optionId });
        break;
      case "vote":
        err = this.castVote(seat, a.votes);
        break;
      case "ready":
        this.markReady(seat);
        break;
    }
    return err;
  }

  setArrangement(playerId: string, arr: Arrangement) {
    const seat = this.seatOf(playerId);
    if (seat < 0 || !this.hands[seat]) return;
    const hp = this.hands[seat];
    if (hp.riichi) return; // リーチ後は並びを固定
    const ids = new Set(hp.hand.map((t) => t.id));
    if (!Array.isArray(arr?.order) || !Array.isArray(arr?.breaks)) return;
    if (arr.order.length !== ids.size || !arr.order.every((id) => ids.has(id))) {
      hp.arr = reconcile({ order: arr.order.filter((id) => ids.has(id)), breaks: arr.breaks }, hp.hand);
    } else hp.arr = { order: [...arr.order], breaks: arr.breaks.filter((id) => ids.has(id)) };
    if (this.step === "turn" && this.turn === seat) this.turnActions = this.computeTurnActions(seat);
  }

  setConnected(playerId: string, connected: boolean) {
    const seat = this.seatOf(playerId);
    if (seat < 0) return;
    this.players[seat].connected = connected;
    if (!connected) {
      // 応答待ちなら自動で進める
      if (this.step === "turn" && this.turn === seat) this.armActionTimer(seat, "turn", () => this.autoDiscard(seat));
      if (this.step === "calls" && this.calls.get(seat) && !this.calls.get(seat)!.response) this.armActionTimer(seat, `call-${seat}`, () => this.respondCall(seat, { call: "pass" }));
      if (this.step === "vote" && this.vote) {
        this.vote.voters = this.vote.voters.filter((s) => s !== seat);
        if (this.vote.voters.every((s) => this.vote!.votes.has(s))) this.resolveVote();
      }
      if (this.step === "result") this.markReady(seat);
    }
  }

  // ------------------------------------------------------------------ 表示用データ

  viewFor(playerId: string | null): GameView {
    const me = playerId ? this.seatOf(playerId) : -1;
    const mySeat = me >= 0 ? me : null;
    const seats: SeatView[] = this.players.map((p, s) => {
      const hp = this.hands[s];
      const open = hp.riichi?.open;
      return {
        seat: s,
        name: p.name,
        isBot: p.isBot,
        connected: p.connected,
        score: p.score,
        wind: (s - this.dealer + this.n) % this.n,
        handCount: hp.hand.length,
        hasDrawn: this.step === "turn" && this.turn === s && !this.afterCall,
        melds: hp.melds.map((m) => ({ type: m.type, tiles: m.tiles, word: m.word, from: m.from, calledId: m.calledId })),
        discards: hp.discards,
        riichi: !!hp.riichi,
        openRiichi: !!open,
        openGroups: open && s !== mySeat ? this.handGroups(s).map((g) => g.ids.map((id) => hp.hand.find((t) => t.id === id)!)) : null,
      };
    });
    let actions: ActionsView | null = null;
    let deadline: number | null = null;
    if (mySeat !== null) {
      if (this.step === "turn" && this.turn === mySeat && this.turnActions) {
        actions = this.turnActions;
        deadline = this.deadlineFor(mySeat, this.turnStartedAt);
      } else if (this.step === "calls") {
        const cs = this.calls.get(mySeat);
        if (cs && !cs.response) {
          actions = { kind: "call", ron: !!cs.ron, pon: cs.pon, kan: cs.kan, tile: this.lastDiscard!.tile, fromSeat: this.lastDiscard!.seat };
          deadline = this.deadlineFor(mySeat, cs.startedAt);
        }
      }
    }
    const hp = mySeat !== null ? this.hands[mySeat] : null;
    let vote: GameView["vote"] = null;
    if (this.vote) {
      const v = this.vote;
      const c0 = v.claims[0];
      vote = {
        claimant: c0.seat,
        claimantName: v.claims.map((c) => this.players[c.seat].name).join("・"),
        title: c0.form === "sakubun" ? "作文の判定" : "言葉の判定",
        items: v.claims.flatMap((c, ci) => c.items.map((it) => ({ ...it, id: ci * 100 + it.id, detail: `${v.claims.length > 1 ? this.players[c.seat].name + "：" : ""}${it.detail ?? ""}` }))),
        words: v.claims.flatMap((c) => this.winGroups(c).map((g) => g.word)),
        canVote: mySeat !== null && v.voters.includes(mySeat) && !v.votes.has(mySeat),
        myVotes: mySeat !== null ? (v.votes.get(mySeat) ?? null) : null,
        waitingFor: v.voters.filter((s) => !v.votes.has(s)).map((s) => this.players[s].name),
        deadline: v.deadline,
      };
    }
    const lengthLabel = { tonpuu: "東風戦", hanchan: "半荘戦", ikkyoku: "1局勝負" }[this.settings.length];
    let waits: string[] = [];
    if (hp?.riichi && mySeat !== null) waits = this.waitsOfGroups(mySeat, this.handGroups(mySeat, hp.drawnId !== null ? this.withoutId(hp.arr, hp.drawnId) : hp.arr, hp.drawnId !== null ? hp.hand.filter((t) => t.id !== hp.drawnId) : hp.hand));
    return {
      mySeat,
      n: this.n,
      seats,
      roundWind: this.roundWind,
      kyoku: this.kyoku,
      honba: this.honba,
      kyotaku: this.kyotaku,
      dealer: this.dealer,
      liveRemaining: Math.max(0, this.liveRemaining),
      turn: this.turn,
      phase: this.step === "turn" ? "play" : this.step,
      lengthLabel,
      myHand: hp ? hp.hand : [],
      drawnId: hp ? hp.drawnId : null,
      arrangement: hp ? hp.arr : null,
      actions,
      deadline,
      bank: hp ? Math.round(hp.bank) : 0,
      base: this.timing().base,
      vote,
      result: this.result,
      final: this.final,
      lastDiscard: this.lastDiscard ? { seat: this.lastDiscard.seat, tileId: this.lastDiscard.tile.id } : null,
      events: this.events,
      waits,
      readyWaiting: this.step === "result" ? this.players.filter((_, i) => !this.ready.has(i)).map((p) => p.name) : [],
      myTheme: playerId ? this.hooks.theme(playerId) : null,
    };
  }
}
