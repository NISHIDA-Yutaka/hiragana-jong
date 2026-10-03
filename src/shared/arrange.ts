// 手牌の並べ方（プレイヤーが自分で語に区切った形）と、その判定
import type { Tile } from "./tiles";

/** order: 牌IDの並び、breaks: その牌の後ろで区切る牌ID */
export interface Arrangement {
  order: number[];
  breaks: number[];
}

/** 手牌の変化に合わせて並びを直す。新しく来た牌は末尾に別の組として置く */
export function reconcile(arr: Arrangement | null, hand: Tile[]): Arrangement {
  const ids = new Set(hand.map((t) => t.id));
  const order = (arr?.order ?? []).filter((id) => ids.has(id));
  const seen = new Set(order);
  const fresh = hand.filter((t) => !seen.has(t.id)).map((t) => t.id);
  const breaks = new Set((arr?.breaks ?? []).filter((id) => seen.has(id)));
  if (fresh.length && order.length && arr) breaks.add(order[order.length - 1]);
  order.push(...fresh);
  if (!arr) return { order, breaks: [] };
  // 最後の牌の後ろの区切りは意味がないので消す
  if (order.length) breaks.delete(order[order.length - 1]);
  return { order, breaks: [...breaks] };
}

export function groupIds(arr: Arrangement): number[][] {
  const br = new Set(arr.breaks);
  const out: number[][] = [];
  let cur: number[] = [];
  for (const id of arr.order) {
    cur.push(id);
    if (br.has(id)) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

export type WordCheck = (word: string) => { verified: boolean } | undefined;

export interface MeldLike {
  word: string;
  kan: boolean;
  concealed: boolean;
}

export interface Completed {
  form: "standard" | "chiitoi";
  /** 手牌側の語（頭を含む）。牌IDつき */
  hand: { word: string; ids: number[] }[];
  /** 辞書にない（未承認の）語 */
  unverified: string[];
}

/** 手牌の語（文字列）の組と鳴きの数から、アガリ形かを判定する */
export function checkComplete(groups: { word: string; ids: number[] }[], meldCount: number, isWord: WordCheck): Completed | null {
  const unverified: string[] = [];
  for (const gr of groups) {
    const e = isWord(gr.word);
    if (!e) return null;
    if (!e.verified && !unverified.includes(gr.word)) unverified.push(gr.word);
  }
  const lens = groups.map((g) => [...g.word].length);
  const twos = lens.filter((l) => l === 2).length;
  const threes = lens.filter((l) => l === 3).length;
  if (twos === 1 && threes === 4 - meldCount && lens.length === 5 - meldCount) return { form: "standard", hand: groups, unverified };
  if (meldCount === 0 && twos === 7 && lens.length === 7) {
    const ws = new Set(groups.map((g) => g.word));
    if (ws.size === 7) return { form: "chiitoi", hand: groups, unverified };
  }
  return null;
}

/**
 * 並べた手牌（13-3m枚）に牌 extra を1枚加えてアガリ形になるか。
 * extra はどれか1つの組の好きな位置に入る（1枚だけの組に足して2文字の頭にするのも可）。
 */
export function completeWith(
  groups: { word: string; ids: number[] }[],
  extra: { ch: string; id: number },
  meldCount: number,
  isWord: WordCheck,
): Completed | null {
  let best: Completed | null = null;
  for (let gi = 0; gi < groups.length; gi++) {
    const chars = [...groups[gi].word];
    for (let p = 0; p <= chars.length; p++) {
      const w = [...chars.slice(0, p), extra.ch, ...chars.slice(p)].join("");
      const ids = [...groups[gi].ids.slice(0, p), extra.id, ...groups[gi].ids.slice(p)];
      const ng = groups.map((g, i) => (i === gi ? { word: w, ids } : g));
      const r = checkComplete(ng, meldCount, isWord);
      if (r && (!best || r.unverified.length < best.unverified.length)) best = r;
    }
  }
  return best;
}

export function groupsWithChars(arr: Arrangement, hand: Tile[]): { word: string; ids: number[] }[] {
  const byId = new Map(hand.map((t) => [t.id, t.ch]));
  return groupIds(arr).map((ids) => ({ ids, word: ids.map((id) => byId.get(id) ?? "?").join("") }));
}
