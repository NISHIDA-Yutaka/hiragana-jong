// 供養：局の終わりに、手牌に好きな牌を2枚まで足した完成形を見せる（点数には関係しない）
import { KIND_INDEX, normalizeInput } from "./tiles";

/** 足せる牌の数 */
export const KUYOU_EXTRA = 2;

/**
 * 入力した完成形を手牌と照らし合わせる。語は空白・読点・中黒で区切る（作文なら区切らずに1文）。
 * 手牌は全部使い、足りない分を2枚まで足せる
 */
export function checkKuyou(handChars: string[], text: string): { groups: string[]; extra: string[]; error: string | null } {
  const groups = text
    .split(/[\s　、,，・]+/)
    .map(normalizeInput)
    .filter(Boolean);
  if (!groups.length) return { groups, extra: [], error: "完成形を入力してください" };
  const rest = new Map<string, number>();
  for (const ch of handChars) rest.set(ch, (rest.get(ch) ?? 0) + 1);
  const extra: string[] = [];
  for (const ch of groups.join("")) {
    if (!(ch in KIND_INDEX)) return { groups, extra, error: `「${ch}」は牌にない文字です` };
    const n = rest.get(ch) ?? 0;
    if (n > 0) rest.set(ch, n - 1);
    else extra.push(ch);
  }
  if (extra.length > KUYOU_EXTRA) return { groups, extra, error: `足せる牌は${KUYOU_EXTRA}枚までです（「${extra.join("")}」を足しています）` };
  const unused = [...rest].flatMap(([ch, n]) => Array<string>(n).fill(ch));
  if (unused.length) return { groups, extra, error: `手牌の「${unused.join("")}」を使っていません` };
  return { groups, extra, error: null };
}
