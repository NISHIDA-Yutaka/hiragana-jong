// 牌の一覧：この部屋（試合）で使う牌の種類と枚数。残り枚数のようなプレイの補助は出さない
import { KIND_INDEX, LONG_MARK, tileSupply } from "../../shared/tiles";
import { Tile } from "./Tile";

const BASE_ROWS = ["あいうえお", "かきくけこ", "さしすせそ", "たちつてと", "なにぬねの", "はひふへほ", "まみむめも", "やゆよ", "らりるれろ", "わん" + LONG_MARK];
const EXTRA_ROWS = ["がぎぐげご", "ざじずぜぞ", "だぢづでど", "ばびぶべぼ", "ぱぴぷぺぽ", "ゃゅょっ"];

export function TileCountList({ extraTiles }: { extraTiles: boolean }) {
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
      <div className="tc-grid">
        {rows.map((row) => (
          <div key={row} className="tc-row">
            {[...row].map((ch) => {
              const all = supply[KIND_INDEX[ch]];
              return (
                <div key={ch} className="tc-cell" title={`${ch}：${all}枚`}>
                  <Tile ch={ch} size="xs" />
                  <span className="tc-num">
                    <b>{all}</b>
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
