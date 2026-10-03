// 手牌の区切りの形（文字数）だけを見る。辞書の判定はしない

/** 区切りの形（文字数の並び）だけを見た目で知らせる。辞書の判定はしない */
export function shapeLabel(lens: number[], meldCount: number): { text: string; cls: string } {
  const total = lens.reduce((a, b) => a + b, 0);
  const need3 = 4 - meldCount;
  const twos = lens.filter((l) => l === 2).length;
  const threes = lens.filter((l) => l === 3).length;
  const text = lens.join("・");
  const full = 2 + 3 * need3;
  if (total === full) {
    if ((twos === 1 && threes === need3 && lens.length === need3 + 1) || (meldCount === 0 && twos === 7 && lens.length === 7)) return { text: `${text}　アガリの形`, cls: "shape-win" };
    // ツモ牌を別にしている場合：残りがテンパイの形か
    if (lens[lens.length - 1] === 1 && lens.length > 1) {
      const r = shapeLabel(lens.slice(0, -1), meldCount);
      if (r.cls === "shape-tenpai") return { text: `${text}　テンパイの形＋1枚`, cls: "shape-tenpai" };
    }
  }
  if (total === full - 1) {
    const ones = lens.filter((l) => l === 1).length;
    const groupsOk = lens.length === need3 + 1;
    // 2・3・3・3・2（3文字の語が1枚足りない）／3・3・3・3・1（頭が1枚足りない）／七対子の1枚足りない形
    const tenpai = (groupsOk && twos === 2 && threes === need3 - 1) || (groupsOk && threes === need3 && ones === 1) || (meldCount === 0 && lens.length === 7 && twos === 6 && ones === 1);
    if (tenpai) return { text: `${text}　テンパイの形`, cls: "shape-tenpai" };
  }
  return { text: lens.length > 1 ? text : "語ごとに区切りましょう", cls: "" };
}
