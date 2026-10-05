// 手牌の区切りの形（文字数）だけを見る。辞書の判定はしない

/** 七対子に同じ語が2組以上あれば、その語 */
function dupPair(words: string[]): string | null {
  const seen = new Set<string>();
  for (const w of words) {
    if ([...w].length !== 2) continue;
    if (seen.has(w)) return w;
    seen.add(w);
  }
  return null;
}

/**
 * 区切りの形（文字数の並び）だけを見た目で知らせる。辞書の判定はしない。
 * words は組ごとの文字列（七対子で同じ語が2組あるかだけを見る）。chiitoi=七対子ありのルール
 */
export function shapeLabel(words: string[], meldCount: number, chiitoi: boolean): { text: string; cls: string } {
  const lens = words.map((w) => [...w].length);
  const total = lens.reduce((a, b) => a + b, 0);
  const need3 = 4 - meldCount;
  const twos = lens.filter((l) => l === 2).length;
  const threes = lens.filter((l) => l === 3).length;
  const text = lens.join("・");
  // 区切りなしの13・14枚は作文の形
  if (meldCount === 0 && lens.length === 1 && (lens[0] === 13 || lens[0] === 14)) return { text: `${text}　区切りなし（作文の形）`, cls: "" };
  const full = 2 + 3 * need3;
  const chiitoiDup = () => {
    const d = dupPair(words);
    return d ? { text: `${text}　七対子は同じ語を2組使えません（${d}）`, cls: "" } : null;
  };
  if (total === full) {
    if (twos === 1 && threes === need3 && lens.length === need3 + 1) return { text: `${text}　アガリの形`, cls: "shape-win" };
    if (meldCount === 0 && twos === 7 && lens.length === 7) {
      if (!chiitoi) return { text: `${text}　七対子なしのルールです`, cls: "" };
      return chiitoiDup() ?? { text: `${text}　アガリの形`, cls: "shape-win" };
    }
    // ツモ牌を別にしている場合：残りがテンパイの形か
    if (lens[lens.length - 1] === 1 && lens.length > 1) {
      const r = shapeLabel(words.slice(0, -1), meldCount, chiitoi);
      if (r.cls === "shape-tenpai") return { text: `${text}　テンパイの形＋1枚`, cls: "shape-tenpai" };
      if (r.text.includes("七対子")) return { text: `${text}　${r.text.split("　")[1]}`, cls: "" };
    }
  }
  if (total === full - 1) {
    const ones = lens.filter((l) => l === 1).length;
    const groupsOk = lens.length === need3 + 1;
    // 2・3・3・3・2（3文字の語が1枚足りない）／3・3・3・3・1（頭が1枚足りない）
    if ((groupsOk && twos === 2 && threes === need3 - 1) || (groupsOk && threes === need3 && ones === 1)) return { text: `${text}　テンパイの形`, cls: "shape-tenpai" };
    // 七対子の1枚足りない形
    if (meldCount === 0 && lens.length === 7 && twos === 6 && ones === 1) {
      if (!chiitoi) return { text: `${text}　七対子なしのルールです`, cls: "" };
      return chiitoiDup() ?? { text: `${text}　テンパイの形`, cls: "shape-tenpai" };
    }
  }
  return { text: lens.length > 1 ? text : "語ごとに区切りましょう", cls: "" };
}
