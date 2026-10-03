import { describe, expect, it } from "vitest";
import { checkComplete, completeWith, groupsWithChars, reconcile } from "../src/shared/arrange";
import { Lexicon } from "../src/shared/lexicon";
import { DEFAULT_SETTINGS, type RoomSettings } from "../src/shared/protocol";
import { buildTileChars, tileSupply } from "../src/shared/tiles";
import { computeYaku, paymentFor, type WordGroup, type YakuInput } from "../src/shared/yaku";
import { Game } from "../src/server/game";

const WORDS = ["ねこ", "さくら", "くるま", "たぬき", "きつね", "いぬ", "そら", "やま", "かさ", "はな", "いす", "とまと", "たしか", "かした", "あい", "いなり", "うきわ", "えほん", "おかめ", "かもめ", "めだか"];
const lex = Lexicon.build(
  WORDS.map((word) => ({ word, verified: true })),
  tileSupply(true),
);
const check = (w: string) => lex.lookup(w);

const g = (word: string, extra: Partial<WordGroup> = {}): WordGroup => ({ word, concealed: true, kan: false, head: [...word].length === 2, ...extra });
const base = (groups: WordGroup[], extra: Partial<YakuInput> = {}): YakuInput => ({
  form: "standard",
  groups,
  tiles: groups.flatMap((x) => [...x.word]),
  menzen: true,
  tsumo: false,
  riichi: null,
  ippatsu: false,
  tenhou: false,
  chiihou: false,
  theme: null,
  ...extra,
});
const names = (r: ReturnType<typeof computeYaku>) => Object.fromEntries(r.items.map((i) => [i.name, i.han]));

describe("役の計算", () => {
  it("ルールブックの計算例：門前リーチ一発ツモ＋清文＝5翻", () => {
    const r = computeYaku(base([g("ねこ"), g("さくら"), g("くるま"), g("たぬき"), g("きつね")], { tsumo: true, riichi: { open: false, double: false }, ippatsu: true }));
    expect(names(r)).toMatchObject({ 門前清自摸和: 1, 立直: 1, 一発: 1, 清文: 2 });
    expect(r.han).toBeGreaterThanOrEqual(5);
    const pay = paymentFor(5, false, false);
    expect([pay.tsumoChild, pay.tsumoDealer]).toEqual([2, 4]);
  });

  it("重回文：たしか＋かした＝6文字で5翻", () => {
    const r = computeYaku(base([g("あい"), g("たしか"), g("かした"), g("さくら"), g("くるま")]));
    expect(names(r)["重回文"]).toBe(5);
  });

  it("回文：とまと", () => {
    const r = computeYaku(base([g("あい"), g("とまと"), g("さくら"), g("くるま"), g("たぬき")]));
    expect(names(r)["回文"]).toBe(1);
  });

  it("純行：あい・いなり・うきわ・えほん・おかめ（門前5翻、五音と重ねない）", () => {
    const r = computeYaku(base([g("あい"), g("いなり"), g("うきわ"), g("えほん"), g("おかめ")]));
    expect(names(r)["純行"]).toBe(5);
    expect(names(r)["五音"]).toBeUndefined();
  });

  it("五連（門前）は役満、鳴きありは8翻", () => {
    const words = ["いた", "たんす", "すいか", "かんさ", "さんぽ"];
    const r = computeYaku(base(words.map((w) => g(w))));
    expect(r.yakuman).toBe(true);
    const r2 = computeYaku(base(words.map((w, i) => g(w, { concealed: i !== 2 })), { menzen: false }));
    expect(names(r2)["五連"]).toBe(8);
  });

  it("しりとり：二連・三連（ん で終わる語の次はつながらない）", () => {
    const r = computeYaku(base([g("ねこ"), g("かもめ"), g("めだか"), g("たぬき"), g("えほん")]));
    // かもめ→めだか→かもめ… 同じ語は1回だけ。めだか→かもめ で2語
    expect(names(r)["二連"]).toBe(3);
  });

  it("同言（同じ語が2つ）", () => {
    const r = computeYaku(base([g("ねこ"), g("さくら"), g("さくら"), g("たぬき"), g("きつね")]));
    expect(names(r)["同言"]).toBe(4);
  });

  it("点数表：親は子の1.5倍、役満は32本", () => {
    expect(paymentFor(1, false, false).ron).toBe(1);
    expect(paymentFor(4, false, true).ron).toBe(12);
    expect(paymentFor(13, true, false).ron).toBe(32);
  });
});

describe("並べた手牌の判定", () => {
  it("完成形と、1枚足りない形への補完", () => {
    const hand = [..."ねこさくらくるまたぬききつね"].map((ch, id) => ({ id, ch }));
    const ids = hand.map((t) => t.id);
    const arr = { order: ids, breaks: [1, 4, 7, 10] };
    const groups = groupsWithChars(arr, hand);
    expect(groups.map((x) => x.word)).toEqual(["ねこ", "さくら", "くるま", "たぬき", "きつね"]);
    expect(checkComplete(groups, 0, check)?.form).toBe("standard");
    // 最後の「ね」を抜いた13枚 → 「ね」で完成（位置は自動で探す）
    const g13 = groupsWithChars({ order: ids.slice(0, 13), breaks: [1, 4, 7, 10] }, hand.slice(0, 13));
    expect(completeWith(g13, { ch: "ね", id: 99 }, 0, check)).not.toBeNull();
    expect(completeWith(g13, { ch: "こ", id: 99 }, 0, check)).toBeNull();
  });

  it("七対子は異なる語7つ", () => {
    const words = ["ねこ", "いぬ", "そら", "やま", "かさ", "はな", "いす"];
    const groups = words.map((w, i) => ({ word: w, ids: [i * 2, i * 2 + 1] }));
    expect(checkComplete(groups, 0, check)?.form).toBe("chiitoi");
    const dup = [...groups.slice(0, 6), { word: "ねこ", ids: [20, 21] }];
    expect(checkComplete(dup, 0, check)).toBeNull();
  });

  it("新しく来た牌は末尾に別の組として置かれる", () => {
    const hand = [{ id: 1, ch: "ね" }, { id: 2, ch: "こ" }];
    const a = reconcile({ order: [1, 2], breaks: [] }, [...hand, { id: 3, ch: "さ" }]);
    expect(a.order).toEqual([1, 2, 3]);
    expect(a.breaks).toEqual([2]);
  });
});

/** 2人打ちで山を固定する。seat0（親）と seat1 の配牌13枚ずつ＋その後のツモ */
function rigWall(h0: string, h1: string, draws: string): string[] {
  const a = [...h0];
  const b = [...h1];
  if (a.length !== 13 || b.length !== 13) throw new Error("配牌は13枚ずつ");
  const head: string[] = [];
  for (let i = 0; i < 13; i++) head.push(a[i], b[i]);
  head.push(...draws);
  // 残りは使わない牌で埋める
  const rest = buildTileChars(false);
  for (const c of head) {
    const i = rest.indexOf(c);
    if (i >= 0) rest.splice(i, 1);
  }
  return [...head, ...rest];
}

function makeGame(wall: string[], opts: { myWords?: string[]; settings?: Partial<RoomSettings> } = {}) {
  const settings: RoomSettings = { ...DEFAULT_SETTINGS, playerCount: 2, timer: "none", judgeMode: "assist", ...opts.settings };
  const p1lex = opts.myWords ? lex.extend(opts.myWords.map((word) => ({ word, verified: false }))) : lex;
  const approved: string[] = [];
  const game = new Game({
    settings,
    fast: true,
    presetWall: wall,
    players: [
      { id: "a", name: "A", isBot: false },
      { id: "b", name: "B", isBot: false },
    ],
    hooks: {
      update: () => {},
      wordApproved: (w) => approved.push(w),
      playerLex: (id) => (id === "b" ? p1lex : lex),
      theme: () => null,
    },
  });
  game.start();
  return { game, approved };
}

/** 手牌の文字列を語ごとに区切った並びにする */
function arrangeAs(game: Game, playerId: string, words: string[]) {
  const v = game.viewFor(playerId);
  const pool = [...v.myHand];
  const order: number[] = [];
  const breaks: number[] = [];
  for (const w of words) {
    for (const ch of w) {
      const i = pool.findIndex((t) => t.ch === ch);
      order.push(pool[i].id);
      pool.splice(i, 1);
    }
    breaks.push(order[order.length - 1]);
  }
  for (const t of pool) order.push(t.id);
  game.setArrangement(playerId, { order, breaks });
}

describe("対局の進行（アシスト）", () => {
  it("並べ方が正しければツモ（天和）できる", () => {
    const { game } = makeGame(rigWall("ねこさくらくるまたぬききつ", "いぬそらやまかさはないすと", "ね"));
    let v = game.viewFor("a");
    expect(v.actions?.kind).toBe("turn");
    expect(v.actions?.kind === "turn" && v.actions.canTsumo).toBe(false);
    arrangeAs(game, "a", ["ねこ", "さくら", "くるま", "たぬき", "きつ"]);
    v = game.viewFor("a");
    expect(v.actions?.kind === "turn" && v.actions.canTsumo).toBe(true);
    expect(game.act("a", { type: "tsumo" })).toBeNull();
    v = game.viewFor("a");
    expect(v.result?.kind).toBe("agari");
    const yaku = v.result!.wins[0].yaku.map((y) => y.name);
    expect(yaku).toContain("天和");
    expect(yaku).toContain("門前清自摸和");
  });

  it("テンパイの並びなら他家の捨て牌でロンでき、ポンも出る", () => {
    // B は「さく」「ねこ」…と並べて「ら」待ち
    const { game } = makeGame(rigWall("ららいぬそやまかはないすそ", "ねこさくくるまたぬききつね", "と"));
    arrangeAs(game, "b", ["ねこ", "くるま", "たぬき", "きつね", "さく"]);
    const id = game.viewFor("a").myHand.find((t) => t.ch === "ら")!.id;
    expect(game.act("a", { type: "discard", tileId: id })).toBeNull();
    const v = game.viewFor("b");
    expect(v.actions?.kind).toBe("call");
    if (v.actions?.kind !== "call") return;
    expect(v.actions.ron).toBe(true);
    expect(v.actions.pon.map((o) => o.word)).toContain("さくら");
    expect(game.act("b", { type: "call", call: "ron" })).toBeNull();
    const r = game.viewFor("b").result!;
    expect(r.kind).toBe("agari");
    expect(r.wins[0].yaku.map((y) => y.name)).toContain("地和");
    expect(r.deltas[1]).toBeGreaterThan(0);
  });

  it("ポンすると語が公開され、鳴いた人が打牌する", () => {
    const { game } = makeGame(rigWall("ららいぬそやまかはないすそ", "ねこさくくるまたぬききつと", "と"));
    arrangeAs(game, "b", ["さく", "ねこ", "くるま", "たぬき", "きつと"]);
    const id = game.viewFor("a").myHand.find((t) => t.ch === "ら")!.id;
    game.act("a", { type: "discard", tileId: id });
    const v = game.viewFor("b");
    if (v.actions?.kind !== "call") throw new Error("no call");
    const opt = v.actions.pon.find((o) => o.word === "さくら")!;
    expect(game.act("b", { type: "call", call: "pon", optionId: opt.id })).toBeNull();
    const v2 = game.viewFor("b");
    expect(v2.seats[1].melds[0].word).toBe("さくら");
    expect(v2.myHand.length).toBe(11);
    expect(v2.actions?.kind === "turn" && v2.actions.afterCall).toBe(true);
  });

  it("フリテン：自分の捨て牌に待ちがあるとロンできない", () => {
    const { game } = makeGame(rigWall("ららいぬそやまかはないすそ", "ねこさくくるまたぬききつね", "とら"));
    const a1 = game.viewFor("a").myHand.find((t) => t.ch === "そ")!.id;
    game.act("a", { type: "discard", tileId: a1 });
    // B は ら をツモって切り、「さく」の ら 待ち（自分の捨て牌に ら があるのでフリテン）
    arrangeAs(game, "b", ["ねこ", "くるま", "たぬき", "きつね", "さく"]);
    const vb = game.viewFor("b");
    const ra = vb.drawnId!;
    expect(vb.myHand.find((t) => t.id === ra)!.ch).toBe("ら");
    expect(game.act("b", { type: "discard", tileId: ra })).toBeNull();
    // A がら を切っても B はロンできない（ポンの選択肢だけ）
    const vA = game.viewFor("a");
    expect(vA.actions?.kind).toBe("turn");
    const ra2 = vA.myHand.find((t) => t.ch === "ら")!.id;
    game.act("a", { type: "discard", tileId: ra2 });
    const v = game.viewFor("b");
    expect(v.actions?.kind).toBe("call");
    if (v.actions?.kind === "call") {
      expect(v.actions.ron).toBe(false);
      expect(v.actions.pon.length).toBeGreaterThan(0);
    }
  });

  it("辞書にない語（マイ単語）は投票で承認されるとアガリになり、ルーム辞書に入る", () => {
    // 「ほげ」は辞書にない
    const { game, approved } = makeGame(rigWall("ららいぬそやまかはないすそ", "ほさくらくるまたぬききつね", "とげ"), { myWords: ["ほげ"], settings: { extraTiles: true } });
    arrangeAs(game, "b", ["ほ", "さくら", "くるま", "たぬき", "きつね"]);
    const id = game.viewFor("a").myHand.find((t) => t.ch === "そ")!.id;
    game.act("a", { type: "discard", tileId: id });
    // B がツモ（げ）
    let v = game.viewFor("b");
    expect(v.actions?.kind === "turn" && v.actions.canTsumo).toBe(true);
    game.act("b", { type: "tsumo" });
    v = game.viewFor("a");
    expect(v.phase).toBe("vote");
    expect(v.vote?.items.map((i) => i.text)).toEqual(["ほげ"]);
    game.act("a", { type: "vote", votes: { [v.vote!.items[0].id]: true } });
    expect(game.viewFor("a").result?.kind).toBe("agari");
    expect(approved).toEqual(["ほげ"]);
  });

  it("投票で否決されるとアガリは取り消され、手番が続く（否決時：取り消しのみ）", () => {
    const { game } = makeGame(rigWall("ららいぬそやまかはないすそ", "ほさくらくるまたぬききつね", "とげ"), { myWords: ["ほげ"], settings: { extraTiles: true, rejectPenalty: "cancel" } });
    arrangeAs(game, "b", ["ほ", "さくら", "くるま", "たぬき", "きつね"]);
    const id = game.viewFor("a").myHand.find((t) => t.ch === "そ")!.id;
    game.act("a", { type: "discard", tileId: id });
    game.act("b", { type: "tsumo" });
    const v = game.viewFor("a");
    game.act("a", { type: "vote", votes: { [v.vote!.items[0].id]: false } });
    const vb = game.viewFor("b");
    expect(vb.phase).toBe("play");
    expect(vb.actions?.kind === "turn" && vb.actions.canTsumo).toBe(false);
  });

  it("リーチ：テンパイを保つ牌だけ選べ、供託が増える", () => {
    const { game } = makeGame(rigWall("ねこさくらくるまたぬききつ", "いぬそらやまかさはないすと", "そ"));
    arrangeAs(game, "a", ["ねこ", "さくら", "くるま", "たぬき", "きつ"]);
    const v = game.viewFor("a");
    if (v.actions?.kind !== "turn") throw new Error("not turn");
    const so = v.myHand.find((t) => t.ch === "そ")!.id;
    expect(v.actions.riichiDiscards).toEqual([so]);
    expect(game.act("a", { type: "discard", tileId: so, riichi: "riichi" })).toBeNull();
    const after = game.viewFor("a");
    expect(after.kyotaku).toBe(1);
    expect(after.seats[0].score).toBe(21);
    expect(after.waits).toContain("ね");
  });
});

describe("自己申告", () => {
  const declare = { judgeMode: "declare" as const };

  it("ツモはいつでも宣言でき、他の人の承認でアガリ", () => {
    const { game } = makeGame(rigWall("ねこさくらくるまたぬききつ", "いぬそらやまかさはないすと", "ね"), { settings: declare });
    const v = game.viewFor("a");
    expect(v.actions?.kind === "turn" && v.actions.canTsumo).toBe(true);
    // 形になっていなければ受け付けない（チョンボにはしない）
    expect(game.act("a", { type: "tsumo" })).not.toBeNull();
    arrangeAs(game, "a", ["ねこ", "さくら", "くるま", "たぬき", "きつね"]);
    expect(game.act("a", { type: "tsumo" })).toBeNull();
    const vb = game.viewFor("b");
    expect(vb.phase).toBe("vote");
    expect(vb.vote!.items.map((i) => i.text)).toEqual(["ねこ", "さくら", "くるま", "たぬき", "きつね"]);
    expect(vb.vote!.items.every((i) => i.known)).toBe(true);
    game.act("b", { type: "vote", votes: {} });
    expect(game.viewFor("a").result?.kind).toBe("agari");
  });

  it("否決されるとチョンボ（満貫払い）", () => {
    const { game } = makeGame(rigWall("ねこさくらくるまたぬききつ", "いぬそらやまかさはないすと", "ね"), { settings: declare });
    // 「こね」「さらく」など辞書にない並び
    arrangeAs(game, "a", ["こね", "さらく", "くるま", "たぬき", "きつね"]);
    game.act("a", { type: "tsumo" });
    const v = game.viewFor("b");
    const bad = v.vote!.items.find((i) => i.text === "さらく")!;
    expect(bad.known).toBe(false);
    game.act("b", { type: "vote", votes: { [bad.id]: false } });
    const r = game.viewFor("a").result!;
    expect(r.kind).toBe("chombo");
    expect(r.deltas).toEqual([-4, 4]);
  });

  it("ロンは受付時間に宣言し、ロン牌を入れる位置を自分で選ぶ", () => {
    const { game } = makeGame(rigWall("ららいぬそやまかはないすそ", "ねこさくくるまたぬききつね", "と"), { settings: declare });
    arrangeAs(game, "b", ["ねこ", "くるま", "たぬき", "きつね", "さく"]);
    const id = game.viewFor("a").myHand.find((t) => t.ch === "ら")!.id;
    game.act("a", { type: "discard", tileId: id });
    let v = game.viewFor("b");
    expect(v.actions?.kind === "call" && v.actions.declare).toBe(true);
    expect(game.act("b", { type: "call", call: "ron" })).toBeNull();
    v = game.viewFor("b");
    expect(v.actions?.kind).toBe("ronPlace");
    expect(game.viewFor("a").notice).toContain("ロン");
    // 「さく」は5番目の組（index 4）、末尾に入れて「さくら」
    expect(game.act("b", { type: "ronPlace", group: 4, pos: 2 })).toBeNull();
    const va = game.viewFor("a");
    expect(va.phase).toBe("vote");
    game.act("a", { type: "vote", votes: {} });
    expect(game.viewFor("a").result?.kind).toBe("agari");
  });

  it("テンパイでない牌でのロンや形にならない位置は受け付けない／取り消しはチョンボ", () => {
    const { game } = makeGame(rigWall("ららいぬそやまかはないすそ", "ねこさくくるまたぬききつね", "と"), { settings: declare });
    arrangeAs(game, "b", ["ねこ", "くるま", "たぬき", "きつね", "さく"]);
    const id = game.viewFor("a").myHand.find((t) => t.ch === "い")!.id;
    game.act("a", { type: "discard", tileId: id });
    game.act("b", { type: "call", call: "ron" });
    // 「きつね」に入れると4文字になり、アガリの形にならない
    expect(game.act("b", { type: "ronPlace", group: 3, pos: 0 })).not.toBeNull();
    expect(game.act("b", { type: "ronCancel" })).toBeNull();
    expect(game.viewFor("a").result?.kind).toBe("chombo");
  });

  it("フリテンのロンは確認なしでチョンボ", () => {
    const { game } = makeGame(rigWall("ららいぬそやまかはないすそ", "ねこさくくるまたぬききつね", "とら"), { settings: declare });
    game.act("a", { type: "discard", tileId: game.viewFor("a").myHand.find((t) => t.ch === "そ")!.id });
    game.act("b", { type: "call", call: "pass" });
    arrangeAs(game, "b", ["ねこ", "くるま", "たぬき", "きつね", "さく"]);
    game.act("b", { type: "discard", tileId: game.viewFor("b").drawnId! });
    game.act("a", { type: "call", call: "pass" });
    game.act("a", { type: "discard", tileId: game.viewFor("a").myHand.find((t) => t.ch === "ら")!.id });
    game.act("b", { type: "call", call: "ron" });
    game.act("b", { type: "ronPlace", group: 4, pos: 2 });
    const r = game.viewFor("a").result!;
    expect(r.kind).toBe("chombo");
    expect(r.note).toContain("フリテン");
  });

  it("ポンは押してから語を選ぶ。辞書にない語ならアガリ放棄", () => {
    const { game } = makeGame(rigWall("ららいぬそやまかはないすそ", "ねこさくくるまたぬききつと", "と"), { settings: declare });
    arrangeAs(game, "b", ["さく", "ねこ", "くるま", "たぬき", "きつと"]);
    const ra = game.viewFor("a").myHand.find((t) => t.ch === "ら")!;
    game.act("a", { type: "discard", tileId: ra.id });
    expect(game.act("b", { type: "call", call: "pon" })).toBeNull();
    const v = game.viewFor("b");
    expect(v.actions?.kind).toBe("callDetail");
    const [sa, ku] = v.arrangement!.order;
    expect(game.act("b", { type: "callDetail", tileIds: [sa, ku, ra.id] })).toBeNull();
    expect(game.viewFor("b").seats[1].melds[0].word).toBe("さくら");

    // 辞書にない語でポン → 鳴けず、その局はツモもできない
    const g2 = makeGame(rigWall("ららいぬそやまかはないすそ", "ねこさくくるまたぬききつと", "と"), { settings: declare }).game;
    arrangeAs(g2, "b", ["さく", "ねこ", "くるま", "たぬき", "きつと"]);
    const ra2 = g2.viewFor("a").myHand.find((t) => t.ch === "ら")!;
    g2.act("a", { type: "discard", tileId: ra2.id });
    g2.act("b", { type: "call", call: "pon" });
    const o = g2.viewFor("b").arrangement!.order;
    g2.act("b", { type: "callDetail", tileIds: [ra2.id, o[0], o[1]] });
    const vb = g2.viewFor("b");
    expect(vb.seats[1].melds.length).toBe(0);
    expect(vb.actions?.kind === "turn" && vb.actions.canTsumo).toBe(false);
  });

  it("リーチはテンパイの確認なしで宣言できる", () => {
    const { game } = makeGame(rigWall("ねこさくらくるまたぬききつ", "いぬそらやまかさはないすと", "そ"), { settings: declare });
    const v = game.viewFor("a");
    if (v.actions?.kind !== "turn") throw new Error("not turn");
    expect(v.actions.riichiDiscards.length).toBe(14);
    expect(v.waits).toEqual([]);
  });
});
