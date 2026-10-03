// 卓の各席：捨て牌・相手の手牌・鳴いた語・中央の情報
import type { GameView, MeldView, SeatView } from "../../shared/protocol";
import { WIND_NAMES } from "../../shared/tiles";
import { Tile, TileSize } from "./Tile";

export type Pos = "bottom" | "right" | "top" | "left";
export const ANGLE: Record<Pos, number> = { bottom: 0, right: -90, top: 180, left: 90 };

export function posFor(seat: number, mySeat: number, n: number): Pos {
  const r = (seat - mySeat + n) % n;
  if (n === 4) return (["bottom", "right", "top", "left"] as Pos[])[r];
  if (n === 3) return (["bottom", "right", "left"] as Pos[])[r];
  return (["bottom", "top"] as Pos[])[r];
}

export function Meld({ m, size = "sm", glyph = 0 }: { m: MeldView; size?: TileSize; glyph?: number }) {
  const label = { pon: "ポン", minkan: "カン", ankan: "暗カン", kakan: "加カン" }[m.type];
  return (
    <div className={`meld meld-${m.type}`}>
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

export function SeatZone({ s, pos, isMe, lastDiscardId, isTurn }: { s: SeatView; pos: Pos; isMe: boolean; lastDiscardId: number | null; isTurn: boolean }) {
  const a = ANGLE[pos];
  const g = -a;
  const rows: (typeof s.discards)[] = [];
  s.discards.forEach((d, i) => {
    const r = Math.min(Math.floor(i / 6), 3);
    (rows[r] ??= []).push(d);
  });
  return (
    <div className={`zone zone-${pos}`} style={{ transform: `rotate(${a}deg)` }}>
      <div className="discards">
        {rows.map((row, ri) => (
          <div key={ri} className="drow">
            {row.map((d) => (
              <div key={d.tile.id} className="dslot">
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
                <Tile key={i} back size="xs" className={isTurn && s.hasDrawn && i === s.handCount - 1 ? "back-drawn" : ""} />
              ))}
            </div>
          )}
          <div className="opp-melds">
            {s.melds.map((m, i) => (
              <Meld key={i} m={m} size="xs" glyph={g} />
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
