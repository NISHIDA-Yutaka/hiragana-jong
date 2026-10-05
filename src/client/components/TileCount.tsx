// 牌の一覧：この部屋で使う牌の種類と枚数。対局中は自分から見えていない残り枚数も出す
import type { GameView } from "../../shared/protocol";
import { KIND_INDEX, LONG_MARK, tileSupply } from "../../shared/tiles";
import { Tile } from "./Tile";

const BASE_ROWS = ["あいうえお", "かきくけこ", "さしすせそ", "たちつてと", "なにぬねの", "はひふへほ", "まみむめも", "やゆよ", "らりるれろ", "わん" + LONG_MARK];
const EXTRA_ROWS = ["がぎぐげご", "ざじずぜぞ", "だぢづでど", "ばびぶべぼ", "ぱぴぷぺぽ", "ゃゅょっ"];

/** 自分から見えている牌の枚数（自分の手牌・全員の捨て牌・鳴いた語・公開された手牌） */
export function seenCounts(g: GameView): Map<string, number> {
  const m = new Map<string, number>();
  const add = (ch: string) => m.set(ch, (m.get(ch) ?? 0) + 1);
  for (const t of g.myHand) add(t.ch);
  for (const s of g.seats) {
    // 鳴かれた捨て牌は鳴いた人の語にも入っているので、捨て牌の側では数えない
    for (const d of s.discards) if (!d.called) add(d.tile.ch);
    for (const meld of s.melds) for (const t of meld.tiles) add(t.ch);
    if (s.seat !== g.mySeat && s.openGroups) for (const grp of s.openGroups) for (const t of grp) add(t.ch);
  }
  return m;
}

export function TileCountList({ extraTiles, seen }: { extraTiles: boolean; seen: Map<string, number> | null }) {
  const supply = tileSupply(extraTiles);
  const rows = extraTiles ? [...BASE_ROWS, ...EXTRA_ROWS] : BASE_ROWS;
  const kinds = rows.join("").length;
  const total = rows.flatMap((r) => [...r]).reduce((a, ch) => a + supply[KIND_INDEX[ch]], 0);
  return (
    <div className="tc">
      <div className="tc-sum">
        全{kinds}種・{total}枚
        <small>
          清音45種は各3枚、「ー」は{supply[KIND_INDEX[LONG_MARK]]}枚{extraTiles ? "、濁音・半濁音・小書きは各1枚" : ""}
        </small>
      </div>
      {seen && <p className="hint">大きい数字は、自分から見えていない残りの枚数です（山や他の人の手牌にあるかもしれない牌）。</p>}
      <div className="tc-grid">
        {rows.map((row) => (
          <div key={row} className="tc-row">
            {[...row].map((ch) => {
              const all = supply[KIND_INDEX[ch]];
              const left = seen ? Math.max(0, all - (seen.get(ch) ?? 0)) : all;
              return (
                <div key={ch} className={`tc-cell ${seen && left === 0 ? "tc-gone" : ""}`} title={seen ? `${ch}：残り${left}枚（全${all}枚）` : `${ch}：${all}枚`}>
                  <Tile ch={ch} size="xs" />
                  <span className="tc-num">
                    <b>{left}</b>
                    {seen && <small>/{all}</small>}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
