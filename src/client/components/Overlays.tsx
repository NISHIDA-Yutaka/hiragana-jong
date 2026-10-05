// 結果・終局・投票の画面
import { useEffect, useState } from "react";
import type { GameView, HandResultView, WinView } from "../../shared/protocol";
import { WIND_NAMES } from "../../shared/tiles";
import { send, useStore } from "../net";
import { fanfare } from "../sound";
import { Tile } from "./Tile";

const fmt = (n: number) => (n * 1000).toLocaleString();
const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(n * 1000).toLocaleString();

function useCountdown(deadline: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [deadline]);
  return deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
}

function WinHand({ w }: { w: WinView }) {
  return (
    <div className="win-hand">
      {w.groups.map((g, i) => (
        <div key={i} className={`wgroup ${g.meld ? "wgroup-meld" : ""} ${g.head ? "wgroup-head" : ""}`}>
          <div className="wtiles">
            {g.tiles.map((t) => (
              <span key={t.id} className="wt-slot">
                <Tile ch={t.ch} size={w.form === "sakubun" ? "md" : "lg"} className={w.winTile?.id === t.id ? "win-tile" : ""} />
                {w.winTile?.id === t.id && <i className="win-tag">{w.fromSeat === null ? "ツモ" : "ロン"}</i>}
              </span>
            ))}
          </div>
          <div className="wword">
            {g.word}
            {g.meld && <small>{{ pon: "ポン", minkan: "カン", ankan: "暗カン", kakan: "加カン" }[g.meld]}</small>}
            {g.head && <small>頭</small>}
          </div>
        </div>
      ))}
    </div>
  );
}

function WinBlock({ w, idx }: { w: WinView; idx: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    const t = setInterval(() => setShown((x) => x + 1), 260);
    return () => clearInterval(t);
  }, [w]);
  const total = w.yaku.length;
  return (
    <div className="win-block" style={{ animationDelay: `${idx * 0.2}s` }}>
      <div className="win-who">
        <span className="win-name">{w.name}</span>
        {w.dealer && <span className="badge">親</span>}
      </div>
      <WinHand w={w} />
      <div className="yaku-list">
        {w.yaku.slice(0, shown).map((y, i) => (
          <div key={i} className={`yaku ${y.sub ? "yaku-sub" : ""} ${y.yakuman ? "yaku-ym" : ""}`}>
            <span className="yaku-name">
              {y.name}
              {y.note && <small>{y.note}</small>}
            </span>
            <span className="yaku-han">{y.yakuman ? "役満" : `${y.han}翻`}</span>
          </div>
        ))}
      </div>
      {shown > total && (
        <div className={`win-total ${w.yakuman ? "ym" : ""}`}>
          <span className="win-label">{w.label}</span>
          <span className="win-pts">{signed(w.gain)}</span>
        </div>
      )}
    </div>
  );
}

function ScoreDeltas({ r, g }: { r: HandResultView; g: GameView }) {
  return (
    <div className="deltas">
      {g.seats.map((s) => (
        <div key={s.seat} className="delta-row">
          <span className="delta-wind">{WIND_NAMES[s.wind]}</span>
          <span className="delta-name">{s.name}</span>
          <span className="delta-before">{fmt(r.before[s.seat])}</span>
          <span className={`delta-d ${r.deltas[s.seat] > 0 ? "plus" : r.deltas[s.seat] < 0 ? "minus" : ""}`}>{r.deltas[s.seat] !== 0 ? signed(r.deltas[s.seat]) : ""}</span>
          <span className="delta-after">{fmt(r.after[s.seat])}</span>
        </div>
      ))}
    </div>
  );
}

export function ResultModal({ g }: { g: GameView }) {
  const r = g.result!;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    if (r.kind === "agari") fanfare(r.wins.some((w) => w.yakuman || w.han >= 6));
  }, [r]);
  const ok = () => {
    setReady(true);
    send("game:action", { type: "ready" });
  };
  return (
    <div className="modal-back">
      <div className={`modal result result-${r.kind}`}>
        <div className="result-title">{r.title}</div>
        {r.note && <div className="result-note">{r.note}</div>}
        {r.shown && (
          <div className="win-hand shown-hand">
            {r.shown.map((g, i) => (
              <div key={i} className="wgroup">
                <div className="wtiles">
                  {g.tiles.map((t) => (
                    <Tile key={t.id} ch={t.ch} size="md" />
                  ))}
                </div>
                <div className="wword">{g.word}</div>
              </div>
            ))}
          </div>
        )}
        {r.wins.map((w, i) => (
          <WinBlock key={i} w={w} idx={i} />
        ))}
        {r.kind === "ryuukyoku" && (
          <div className="tenpai-list">
            {r.tenpai.map((t) => (
              <div key={t.seat} className="tenpai-row">
                <span className="tp-name">{t.name}</span>
                <span className={`tp-flag ${t.tenpai ? "on" : ""}`}>{t.tenpai ? "テンパイ" : "ノーテン"}</span>
                {t.groups && (
                  <span className="tp-groups">
                    {t.groups.map((grp, i) => (
                      <span key={i} className="tp-group">
                        {grp.map((x) => (
                          <Tile key={x.id} ch={x.ch} size="xs" />
                        ))}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        <ScoreDeltas r={r} g={g} />
        <div className="modal-foot">
          {g.mySeat !== null && !ready ? (
            <button className="btn btn-primary" onClick={ok}>
              OK
            </button>
          ) : (
            <span className="muted">{g.readyWaiting.length ? `待っています：${g.readyWaiting.join("、")}` : "次の局へ…"}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function FinalModal({ g }: { g: GameView }) {
  const f = g.final!;
  const isHost = useStore((s) => s.room?.isHost);
  useEffect(() => {
    fanfare(true);
  }, []);
  return (
    <div className="modal-back">
      <div className="modal final">
        <div className="result-title">終局</div>
        <div className="final-list">
          {f.ranking.map((r) => (
            <div key={r.seat} className={`final-row rank-${r.rank} ${r.seat === g.mySeat ? "me" : ""}`} style={{ animationDelay: `${(f.ranking.length - r.rank) * 0.25}s` }}>
              <span className="final-rank">{r.rank}位</span>
              <span className="final-name">{r.name}</span>
              <span className="final-score">{fmt(r.score)}</span>
              {!f.oneHand && <span className={`final-pt ${r.pt >= 0 ? "plus" : "minus"}`}>{(r.pt > 0 ? "+" : "") + r.pt.toFixed(0)}</span>}
            </div>
          ))}
        </div>
        <div className="modal-foot">
          {isHost ? (
            <button className="btn btn-primary" onClick={() => send("room:backToLobby")}>
              ロビーに戻る
            </button>
          ) : (
            <span className="muted">ホストがロビーに戻るのを待っています</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function VoteModal({ g }: { g: GameView }) {
  const v = g.vote!;
  const [votes, setVotes] = useState<Record<number, boolean>>({});
  const left = useCountdown(v.deadline);
  useEffect(() => setVotes({}), [v.claimant, v.items.length]);
  const submit = () => {
    const all: Record<number, boolean> = {};
    for (const it of v.items) all[it.id] = votes[it.id] ?? true;
    send("game:action", { type: "vote", votes: all });
  };
  return (
    <div className="modal-back">
      <div className="modal vote">
        <div className="result-title small">{v.title}</div>
        <div className="vote-who">
          <b>{v.claimantName}</b> さんの{v.purpose === "tenpai" ? "テンパイ（作文待ち）" : "アガリ"}
        </div>
        <div className="vote-words">
          {v.words.map((w, i) => {
            const asked = v.items.some((it) => it.kind === "word" && it.text === w);
            return (
              <span key={i} className={`chip ${asked ? "chip-ask" : "chip-ok"}`} title={asked ? "辞書にない語（投票）" : "辞書にある語（自動で承認）"}>
                {asked ? "？" : "✓"} {w}
              </span>
            );
          })}
        </div>
        {v.words.length > 0 && <div className="vote-allknown">✓ の語は辞書にあるので自動で認めています。下の項目だけ投票してください。</div>}
        <div className="vote-items">
          {v.items.map((it) => (
            <div key={it.id} className="vote-item">
              <div className="vi-text">
                <b>{it.text}</b>
                <small className={it.known === true ? "good" : it.known === false ? "bad" : ""}>{it.detail}</small>
              </div>
              {v.canVote && (
                <div className="vi-btns">
                  <button className={`vbtn ok ${votes[it.id] !== false ? "on" : ""}`} onClick={() => setVotes({ ...votes, [it.id]: true })}>
                    ○ 認める
                  </button>
                  <button className={`vbtn ng ${votes[it.id] === false ? "on" : ""}`} onClick={() => setVotes({ ...votes, [it.id]: false })}>
                    × 認めない
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="modal-foot">
          {v.canVote ? (
            <button className="btn btn-primary" onClick={submit}>
              投票する{left !== null ? `（${left}）` : ""}
            </button>
          ) : (
            <span className="muted">
              {v.waitingFor.length ? `投票を待っています：${v.waitingFor.join("、")}` : "集計中…"}
              {left !== null ? `（${left}秒）` : ""}
            </span>
          )}
        </div>
        <div className="hint">
          {v.purpose === "tenpai"
            ? "あと1牌で文章になるなら「○」にしてください。多数決で決まります（同数は不可、時間切れは承認扱い）。認められないとノーテンリーチでチョンボになります。"
            : "言葉として認めない語だけ「×」にしてください。多数決で決まります（同数は不可、時間切れは承認扱い）。認められないとチョンボになります。"}
        </div>
      </div>
    </div>
  );
}
