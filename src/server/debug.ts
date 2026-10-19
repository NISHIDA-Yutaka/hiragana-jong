// デバッグ用のコマンド（DEBUG_COMMANDS=1 のときだけ受け付ける）。
// 結果は打った本人にだけ返し、ほかの人には知らせない（チャットにも出さない）
import { KIND_INDEX, normalizeInput, tileSupply, toSeion } from "../shared/tiles";
import type { Member, Room } from "./room";

export const DEBUG_ENABLED = process.env.DEBUG_COMMANDS === "1";

/** 配牌は13枚（親の14枚目は普通にツモる） */
const MAX_TILES = 13;

const HELP = [
  "/set ほげ おばかさん        次の配牌で、自分の手牌の先頭に「ほげおばかさん」の並びで配る",
  "/set -r ほげ おばかさん     語ごとにまとめたまま、手牌のランダムな位置に入れる（--random でも可）",
  "/set @名前 ほげ おばかさん  ほかの人（CPUも可）に配る。名前は前の方だけでもよい",
  "/list                       参加者と、予約中の配牌を見る",
  "/clear [@名前]              予約を取り消す（名前を省くと自分、@all で全員）",
  "牌は合わせて13枚まで。山から抜いて配るので、残りの山や他の人の配牌はその分だけ変わる",
];

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

function setRig(room: Room, me: Member, allArgs: string[]): { lines: string[] } | { error: string } {
  const random = allArgs.some((a) => a === "-r" || a === "--random");
  const args = allArgs.filter((a) => a !== "-r" && a !== "--random");
  const target = findTarget(room, me, args[0]);
  if (typeof target === "string") return { error: target };
  const raw = args[0]?.startsWith("@") ? args.slice(1) : args;
  if (room.game && !room.game.isOver && !room.seatedIds.includes(target.id)) return { error: "対局に参加していないので配牌がありません" };

  // 追加牌なしの卓では、濁音などは清音の牌に置き換える（語を作るときの清音代用と同じ）
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
  if (words.length === 0) return { error: "牌を指定してください（例：/set ほげ おばかさん）" };
  const count = words.join("").length;
  if (count > MAX_TILES) return { error: `${count}枚あります。配牌は${MAX_TILES}枚までです` };

  // ほかの人の予約と合わせて、山の枚数を超えないか
  const need = new Map<string, number>();
  for (const [id, rig] of room.debugRigs) if (id !== target.id) for (const ch of rig.words.join("")) need.set(ch, (need.get(ch) ?? 0) + 1);
  for (const ch of words.join("")) need.set(ch, (need.get(ch) ?? 0) + 1);
  for (const [ch, n] of need) {
    const have = supply[KIND_INDEX[ch]];
    if (n > have) return { error: `「${ch}」は山に${have}枚しかありません（ほかの予約と合わせて${n}枚）` };
  }

  room.debugRigs.set(target.id, { words, random });
  console.log(`[debug] ${room.code} ${me.name} → ${target.name}: ${words.join(" ")}${random ? " (random)" : ""}`);
  const where = random ? "手牌のランダムな位置に" : "手牌の先頭に";
  return { lines: [...notes, `次の配牌で ${target.name} の${where}「${words.join(" ")}」（${count}枚）を配ります`] };
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
    lines.push(`  ${m.name}${m.isBot ? "（CPU）" : ""}${rig ? `　→ 予約：${rig.words.join(" ")}${rig.random ? "（ランダムな位置）" : ""}` : ""}`);
  }
  return lines;
}
