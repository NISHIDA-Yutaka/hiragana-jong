// デバッグ用のコマンド（DEBUG_COMMANDS=1 のときだけ受け付ける）。
// 結果は打った本人にだけ返し、ほかの人には知らせない（チャットにも出さない）
import type { MeldType } from "../shared/protocol";
import { KIND_INDEX, normalizeInput, tileSupply, toSeion } from "../shared/tiles";
import type { DealRig } from "./game";
import type { Member, Room } from "./room";

export const DEBUG_ENABLED = process.env.DEBUG_COMMANDS === "1";

/** 配牌は13枚（親の14枚目は普通にツモる） */
const MAX_TILES = 13;
/** 1局のカンは4回まで */
const MAX_KANS = 4;

const HELP = [
  "/set ほげ おばかさん        次の配牌で、自分の手牌の先頭に「ほげおばかさん」の並びで配る",
  "/set -r ほげ おばかさん     語ごとにまとめたまま、手牌のランダムな位置に入れる（--random でも可）",
  "/set @名前 ほげ おばかさん  ほかの人（CPUも可）に配る。名前は前の方だけでもよい",
  "/meld @名前 ねこ おみやげ   次の局の始めから、鳴いた形で持たせる（3文字はポン、4文字以上はカン）",
  "/meld @名前 暗カン おみやげ 種類を決めるときは語の前に ポン・カン・暗カン・加カン を書く。打つたびに足していく",
  "/naki @CPU名 [on|off]       そのCPUを鳴きたがりにする（鳴ける語があれば必ずポン・カンする）。省くと切り替え",
  "/list                       参加者と、予約中の配牌・鳴き・鳴きたがりを見る",
  "/clear [@名前]              配牌と鳴きの予約を取り消す（名前を省くと自分、@all で全員）",
  "手牌は13枚まで（鳴いた語1つにつき3枚減る）。山から抜いて配るので、残りの山や他の人の配牌はその分だけ変わる",
];

const MELD_TYPES: Record<string, MeldType> = {
  ポン: "pon",
  pon: "pon",
  カン: "minkan",
  明カン: "minkan",
  kan: "minkan",
  minkan: "minkan",
  暗カン: "ankan",
  ankan: "ankan",
  加カン: "kakan",
  kakan: "kakan",
};
const MELD_LABEL: Record<MeldType, string> = { pon: "ポン", minkan: "カン", ankan: "暗カン", kakan: "加カン" };

export function debugCommand(room: Room, me: Member, text: string): { lines: string[] } | { error: string } {
  const [cmd, ...args] = text.trim().split(/\s+/);
  switch (cmd) {
    case "/help":
    case "/?":
      return { lines: HELP };
    case "/list":
      return { lines: listLines(room) };
    case "/set":
      return setRig(room, me, args);
    case "/meld":
      return meldRig(room, me, args);
    case "/naki":
      return naki(room, me, args);
    case "/clear":
      return clearRig(room, me, args[0]);
    default:
      return { error: `知らないコマンドです：${cmd}（/help で一覧）` };
  }
}

/** 対象にできる人。対局中は席に着いている人、ロビーでは部屋の全員 */
function candidates(room: Room): Member[] {
  if (room.game && !room.game.isOver) return room.seatedIds.map((id) => room.member(id)).filter((m): m is Member => !!m);
  return room.members;
}

function findTarget(room: Room, me: Member, arg: string | undefined): Member | string {
  if (!arg?.startsWith("@")) return me;
  const q = arg.slice(1);
  const list = candidates(room);
  const exact = list.filter((m) => m.name === q);
  const hits = exact.length ? exact : list.filter((m) => m.name.startsWith(q));
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) return `「${q}」に当たる人がいません（/list で確認）`;
  return `「${q}」に当たる人が複数います：${hits.map((m) => m.name).join("、")}`;
}

/** 先頭の @名前 を読んで、対象と残りの引数に分ける。対局中は席に着いている人だけ */
function splitTarget(room: Room, me: Member, args: string[]): { target: Member; rest: string[] } | { error: string } {
  const target = findTarget(room, me, args[0]);
  if (typeof target === "string") return { error: target };
  if (room.game && !room.game.isOver && !room.seatedIds.includes(target.id)) return { error: "対局に参加していないので配牌がありません" };
  return { target, rest: args[0]?.startsWith("@") ? args.slice(1) : args };
}

/** 入力した語を牌の文字にする。追加牌なしの卓では、濁音などは清音の牌に置き換える（語を作るときの清音代用と同じ） */
function toTileWords(room: Room, raw: string[]): { words: string[]; notes: string[] } | { error: string } {
  const supply = tileSupply(room.settings.extraTiles);
  const notes: string[] = [];
  const words: string[] = [];
  for (const w of raw.map(normalizeInput).filter(Boolean)) {
    let out = "";
    for (const ch of w) {
      if (supply[KIND_INDEX[ch]] > 0) out += ch;
      else if (supply[KIND_INDEX[toSeion(ch)]] > 0) {
        out += toSeion(ch);
        notes.push(`「${ch}」はこの卓にないので「${toSeion(ch)}」にしました`);
      } else return { error: `「${ch}」は牌にありません` };
    }
    words.push(out);
  }
  return { words, notes };
}

/** 予約を入れ替えたときに、手牌の枚数・カンの回数・山の枚数を超えないか */
function checkRig(room: Room, targetId: string, rig: DealRig): string | null {
  const melds = rig.melds ?? [];
  const hand = MAX_TILES - 3 * melds.length;
  const count = rig.words.join("").length;
  if (count > hand) return melds.length ? `鳴いた語が${melds.length}つあるので、配牌は${hand}枚までです（いま${count}枚）` : `${count}枚あります。配牌は${MAX_TILES}枚までです`;

  const all = new Map(room.debugRigs);
  all.set(targetId, rig);
  const kans = [...all.values()].reduce((n, r) => n + (r.melds ?? []).filter((m) => m.type !== "pon").length, 0);
  if (kans > MAX_KANS) return `カンは全員で${MAX_KANS}回までです（予約と合わせて${kans}回）`;

  const supply = tileSupply(room.settings.extraTiles);
  const need = new Map<string, number>();
  for (const r of all.values()) for (const ch of [...r.words, ...(r.melds ?? []).map((m) => m.word)].join("")) need.set(ch, (need.get(ch) ?? 0) + 1);
  for (const [ch, n] of need) {
    const have = supply[KIND_INDEX[ch]];
    if (n > have) return `「${ch}」は山に${have}枚しかありません（ほかの予約と合わせて${n}枚）`;
  }
  return null;
}

function setRig(room: Room, me: Member, allArgs: string[]): { lines: string[] } | { error: string } {
  const random = allArgs.some((a) => a === "-r" || a === "--random");
  const t = splitTarget(
    room,
    me,
    allArgs.filter((a) => a !== "-r" && a !== "--random"),
  );
  if ("error" in t) return t;
  const { target } = t;
  const tw = toTileWords(room, t.rest);
  if ("error" in tw) return tw;
  const { words, notes } = tw;
  if (words.length === 0) return { error: "牌を指定してください（例：/set ほげ おばかさん）" };

  const rig: DealRig = { ...room.debugRigs.get(target.id), words, random };
  const err = checkRig(room, target.id, rig);
  if (err) return { error: err };
  room.debugRigs.set(target.id, rig);
  console.log(`[debug] ${room.code} ${me.name} → ${target.name}: ${words.join(" ")}${random ? " (random)" : ""}`);
  const where = random ? "手牌のランダムな位置に" : "手牌の先頭に";
  return { lines: [...notes, `次の配牌で ${target.name} の${where}「${words.join(" ")}」（${words.join("").length}枚）を配ります`] };
}

function meldRig(room: Room, me: Member, args: string[]): { lines: string[] } | { error: string } {
  const t = splitTarget(room, me, args);
  if ("error" in t) return t;
  const { target } = t;
  const fixed = MELD_TYPES[t.rest[0]?.toLowerCase() ?? ""];
  const tw = toTileWords(room, fixed ? t.rest.slice(1) : t.rest);
  if ("error" in tw) return tw;
  const { words, notes } = tw;
  if (words.length === 0) return { error: "語を指定してください（例：/meld @CPU1 ねこ おみやげ）" };

  const added: { type: MeldType; word: string }[] = [];
  for (const word of words) {
    const len = [...word].length;
    const type = fixed ?? (len === 3 ? "pon" : "minkan");
    if (type === "pon" && len !== 3) return { error: `ポンは3文字です：「${word}」` };
    if (type !== "pon" && (len < 4 || len > 8)) return { error: `カンは4〜8文字です：「${word}」` };
    added.push({ type, word });
  }
  const prev = room.debugRigs.get(target.id) ?? { words: [], random: false };
  const melds = [...(prev.melds ?? []), ...added];
  if (melds.length > 4) return { error: `鳴いた語は4つまでです（予約と合わせて${melds.length}つ）` };
  const rig: DealRig = { ...prev, melds };
  const err = checkRig(room, target.id, rig);
  if (err) return { error: err };
  room.debugRigs.set(target.id, rig);
  const desc = melds.map((m) => `${MELD_LABEL[m.type]}「${m.word}」`).join("・");
  console.log(`[debug] ${room.code} ${me.name} → ${target.name}: meld ${desc}`);
  return { lines: [...notes, `次の局の始めから ${target.name} に ${desc} を持たせます`] };
}

function naki(room: Room, me: Member, args: string[]): { lines: string[] } | { error: string } {
  if (!args[0]?.startsWith("@")) return { error: "CPUを @名前 で指定してください（例：/naki @CPU1 on）" };
  const target = findTarget(room, me, args[0]);
  if (typeof target === "string") return { error: target };
  if (!target.isBot) return { error: `${target.name} はCPUではありません（鳴きたがりにできるのはCPUだけです）` };
  const mode = args[1]?.toLowerCase();
  if (mode && mode !== "on" && mode !== "off") return { error: "on か off を指定してください" };
  const on = mode ? mode === "on" : !room.debugNaki.has(target.id);
  if (on) room.debugNaki.add(target.id);
  else room.debugNaki.delete(target.id);
  console.log(`[debug] ${room.code} ${me.name} → ${target.name}: naki ${on ? "on" : "off"}`);
  return { lines: [on ? `${target.name} を鳴きたがりにしました（鳴ける語があれば必ずポン・カンします）` : `${target.name} の鳴きたがりをやめました`] };
}

function clearRig(room: Room, me: Member, arg: string | undefined): { lines: string[] } | { error: string } {
  if (arg === "@all") {
    room.debugRigs.clear();
    return { lines: ["予約をすべて取り消しました"] };
  }
  const target = findTarget(room, me, arg);
  if (typeof target === "string") return { error: target };
  if (!room.debugRigs.delete(target.id)) return { lines: [`${target.name} の予約はありません`] };
  return { lines: [`${target.name} の予約を取り消しました`] };
}

function listLines(room: Room): string[] {
  const inGame = room.game && !room.game.isOver;
  const lines = [inGame ? "対局中の参加者：" : "部屋のメンバー："];
  for (const m of candidates(room)) {
    const rig = room.debugRigs.get(m.id);
    const parts: string[] = [];
    if (rig?.words.length) parts.push(`予約：${rig.words.join(" ")}${rig.random ? "（ランダムな位置）" : ""}`);
    if (rig?.melds?.length) parts.push(`鳴き：${rig.melds.map((x) => `${MELD_LABEL[x.type]}「${x.word}」`).join("・")}`);
    if (room.debugNaki.has(m.id)) parts.push("鳴きたがり");
    lines.push(`  ${m.name}${m.isBot ? "（CPU）" : ""}${parts.length ? `　→ ${parts.join("　")}` : ""}`);
  }
  return lines;
}
