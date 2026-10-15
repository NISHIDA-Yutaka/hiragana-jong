// 卓の各席：捨て牌・相手の手牌・鳴いた語・中央の情報
import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import type { GameView, MeldView, SeatView } from "../../shared/protocol";
import { WIND_NAMES } from "../../shared/tiles";
import { Tile, TileBox, TileSize } from "./Tile";

export type Pos = "bottom" | "right" | "top" | "left";
export const ANGLE: Record<Pos, number> = { bottom: 0, right: -90, top: 180, left: 90 };

export function posFor(seat: number, mySeat: number, n: number): Pos {
  const r = (seat - mySeat + n) % n;
  if (n === 4) return (["bottom", "right", "top", "left"] as Pos[])[r];
  if (n === 3) return (["bottom", "right", "left"] as Pos[])[r];
  return (["bottom", "top"] as Pos[])[r];
}

const MELD_LABEL: Record<MeldView["type"], string> = { pon: "ポン", minkan: "カン", ankan: "暗カン", kakan: "加カン" };

/**
 * 鳴いた語。peek のときはカンにマウスを乗せると、大きな牌で正立させた中身を出す。
 * 相手の席は卓ごと回して倒しているので、ポップアップは body 直下に置いて画面の向きのまま描く
 */
export function Meld({ m, size = "sm", glyph = 0, peek = false }: { m: MeldView; size?: TileSize; glyph?: number; peek?: boolean }) {
  const label = MELD_LABEL[m.type];
  const [at, setAt] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const canPeek = peek && m.type !== "pon";
  const show = (e: ReactMouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    // 画面の端で切れないよう、ポップアップの幅（md の牌40px×枚数＋余白）を見込んで寄せる
    const half = (m.tiles.length * 40 + 28) / 2;
    const x = Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8);
    const below = r.top < 110;
    setAt({ x, y: below ? r.bottom : r.top, below });
  };
  return (
    <div
      className={`meld meld-${m.type} ${canPeek ? "meld-peekable" : ""}`}
      onMouseEnter={canPeek ? show : undefined}
      onMouseLeave={canPeek ? () => setAt(null) : undefined}
    >
      {at &&
        createPortal(
          <div className={`meld-peek ${at.below ? "meld-peek-below" : ""}`} style={{ left: at.x, top: at.y }}>
            <div className="meld-peek-label">{label}</div>
            <div className="meld-peek-tiles">
              {m.tiles.map((t) => (
                <Tile key={t.id} ch={t.ch} size="md" className={t.id === m.calledId ? "called-in" : ""} />
              ))}
            </div>
          </div>,
          document.body,
        )}
      <div className="meld-tiles">
        {m.tiles.map((t) => (
          <Tile key={t.id} ch={t.ch} size={size} glyphRotate={glyph} className={t.id === m.calledId ? "called-in" : ""} />
        ))}
      </div>
      <div className="meld-label" style={glyph ? { transform: `rotate(${glyph}deg)` } : undefined}>
        {label}
      </div>
    </div>
  );
}

/**
 * 捨て牌の重なり順。牌の厚みは画面の下（手前）に描くので、手前にある牌ほど上に重ねる。
 * 右の席は列が画面の上へ、正面の席は段が画面の上へ伸びるため、その向きだけ順番を逆にする
 */
function discardZ(pos: Pos, row: number, col: number): number {
  if (pos === "right") return 40 - col;
  if (pos === "top") return 10 - row;
  return 1;
}

/**
 * 1段に並べる捨て牌の数。山が長い少人数ほど1人の捨て牌が多い（4人で最大約18〜25枚、3人で約28〜38枚、2人で約48〜63枚）。
 * 3人打ちは持ち主から見て右（空いている卓の角）へ伸ばし、2人打ちは左右の席が空いているので横長にする
 */
const PER_ROW: Record<number, number> = { 4: 6, 3: 10, 2: 16 };

export function SeatZone({ n, s, pos, isMe, lastDiscardId, isTurn }: { n: number; s: SeatView; pos: Pos; isMe: boolean; lastDiscardId: number | null; isTurn: boolean }) {
  const a = ANGLE[pos];
  const g = -a;
  const perRow = PER_ROW[n] ?? 6;
  const rows: (typeof s.discards)[] = [];
  s.discards.forEach((d, i) => {
    const r = Math.min(Math.floor(i / perRow), 3);
    (rows[r] ??= []).push(d);
  });
  return (
    <div className={`zone zone-${pos}`} style={{ transform: `rotate(${a}deg)` }}>
      <div className={`discards discards-${n}p`}>
        {rows.map((row, ri) => (
          <div key={ri} className="drow">
            {row.map((d, di) => (
              <div key={d.tile.id} className="dslot" style={{ zIndex: discardZ(pos, ri, di) }}>
                <Tile
                  ch={d.tile.ch}
                  size="md"
                  sideways={d.riichi}
                  glyphRotate={g}
                  className={[d.called ? "called" : "", d.tsumogiri ? "tsumogiri" : "", d.tile.id === lastDiscardId ? "last" : "", "dtile"].join(" ")}
                />
                {d.tile.id === lastDiscardId && <div className="last-mark" />}
              </div>
            ))}
          </div>
        ))}
      </div>
      {s.riichi && <div className="riichi-stick" />}
      {!isMe && (
        <div className="opp-hand">
          {s.openGroups ? (
            <div className="open-groups">
              {s.openGroups.map((grp, i) => (
                <div key={i} className="ogroup">
                  {grp.map((t) => (
                    <Tile key={t.id} ch={t.ch} size="sm" glyphRotate={g} />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="backs">
              {Array.from({ length: s.handCount }).map((_, i) => (
                <TileBox key={i} className={isTurn && s.hasDrawn && i === s.handCount - 1 ? "back-drawn" : ""} />
              ))}
            </div>
          )}
          <div className="opp-melds">
            {s.melds.map((m, i) => (
              <Meld key={i} m={m} size="xs" glyph={g} peek />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function CenterBox({ g, mySeat }: { g: GameView; mySeat: number }) {
  return (
    <div className="center-box">
      <div className="cb-inner">
        <div className="cb-round">
          {WIND_NAMES[g.roundWind]}
          {g.kyoku + 1}局
        </div>
        <div className="cb-sub">
          <span>{g.honba}本場</span>
          <span className="cb-kyotaku">
            <i className="mini-stick" />×{g.kyotaku}
          </span>
        </div>
        <div className="cb-remain">
          残り <b>{g.liveRemaining}</b>
        </div>
      </div>
      {g.seats.map((s) => {
        const pos = posFor(s.seat, mySeat, g.n);
        return (
          <div key={s.seat} className={`cb-side cb-${pos} ${g.turn === s.seat && (g.phase === "play" || g.phase === "calls") ? "turn" : ""}`}>
            <span className={`cb-wind ${s.wind === 0 ? "dealer" : ""}`}>{WIND_NAMES[s.wind]}</span>
            <span className="cb-score">{(s.score * 1000).toLocaleString()}</span>
          </div>
        );
      })}
    </div>
  );
}

export function NamePlate({ s, pos, isTurn }: { s: SeatView; pos: Pos; isTurn: boolean }) {
  return (
    <div className={`plate plate-${pos} ${isTurn ? "turn" : ""} ${!s.connected ? "off" : ""}`}>
      <div className={`avatar ${s.isBot ? "avatar-bot" : ""}`}>{s.isBot ? "🤖" : s.name.slice(0, 1)}</div>
      <div className="plate-body">
        <div className="plate-name">
          <span className={`plate-wind ${s.wind === 0 ? "dealer" : ""}`}>{WIND_NAMES[s.wind]}</span>
          {s.name}
        </div>
        <div className="plate-score">
          {(s.score * 1000).toLocaleString()}
          {s.riichi && <span className="plate-riichi">{s.openRiichi ? "オープン" : "リーチ"}</span>}
          {!s.connected && <span className="plate-off">切断中</span>}
        </div>
      </div>
    </div>
  );
}
