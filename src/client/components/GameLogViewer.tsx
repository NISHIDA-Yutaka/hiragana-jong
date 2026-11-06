// 終わった対局を見返す画面。コンソールの /log で開く。読むだけで、ほかの人には何も伝わらない
import { useEffect, useMemo, useState } from "react";
import { emit } from "../net";
import type { GameLogLine, GameLogSummary, LogSeat } from "../../shared/gameLog";

type Snap = Extract<GameLogLine, { t: "snap" }>;
type Hand = Extract<GameLogLine, { t: "hand" }>;
type Result = Extract<GameLogLine, { t: "result" }>;
interface HandLog {
  head: Hand;
  snaps: Snap[];
  result: Result | null;
}

const EVENT_LABEL: Record<string, string> = {
  start: "配牌",
  riipai: "理牌おわり",
  draw: "ツモ",
  discard: "打牌",
  riichi: "リーチ",
  pon: "ポン",
  kan: "カン",
  ankan: "暗カン",
  kakan: "加カン",
  ron: "ロン",
  tsumo: "ツモアガリ",
  ryuukyoku: "流局",
  abort: "途中流局",
  chombo: "チョンボ",
};

const CSS = `
.glv {
  position: fixed;
  inset: 0;
  z-index: 96;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  overflow-y: auto;
  background: #0b1418;
  color: #e4efe7;
  font-size: 14px;
  line-height: 1.5;
}
.glv-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.glv-head h2 { margin: 0; font-size: 16px; flex: 1; min-width: 0; }
.glv button, .glv select {
  padding: 5px 10px;
  border: 1px solid #47705a;
  border-radius: 6px;
  background: #16262b;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.glv button:disabled { opacity: 0.4; cursor: default; }
.glv-game { display: block; width: 100%; margin-bottom: 6px; text-align: left; }
.glv-step { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.glv-step input { flex: 1; min-width: 120px; }
.glv-now { color: #ffd98a; }
.glv-seat { padding: 8px 10px; border: 1px solid #2c4650; border-radius: 8px; }
.glv-seat.on { border-color: #ffd98a; }
.glv-name { color: #9fd0ae; font-size: 13px; }
.glv-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.glv-word { padding: 1px 7px; border-radius: 5px; background: #f1ead7; color: #1d2a26; font-size: 16px; letter-spacing: 1px; }
.glv-word.meld { background: #c9dfe8; }
.glv-river { margin-top: 4px; color: #a9bcb2; font-size: 13px; word-break: break-all; }
.glv-result { padding: 8px 10px; border-radius: 8px; background: #1c2a1f; }
.glv-err { color: #ff9a8a; }
`;

function toHands(lines: GameLogLine[]): HandLog[] {
  const out: HandLog[] = [];
  for (const l of lines) {
    if (l.t === "hand") out.push({ head: l, snaps: [], result: null });
    const cur = out[out.length - 1];
    if (!cur) continue;
    if (l.t === "snap") cur.snaps.push(l);
    if (l.t === "result") cur.result = l;
  }
  return out;
}

function Seat({ name, seat, on, dealer }: { name: string; seat: LogSeat; on: boolean; dealer: boolean }) {
  return (
    <div className={`glv-seat${on ? " on" : ""}`}>
      <div className="glv-name">
        {name}
        {dealer ? "（親）" : ""}
        {seat.riichi ? "　リーチ" : ""}
      </div>
      <div className="glv-row">
        {seat.groups.map((g, i) => (
          <span key={i} className="glv-word">
            {g}
          </span>
        ))}
        {seat.melds.map((m, i) => (
          <span key={`m${i}`} className="glv-word meld">
            {m.word}
          </span>
        ))}
      </div>
      <div className="glv-river">河：{seat.discards.join(" ") || "なし"}</div>
    </div>
  );
}

export default function GameLogViewer({ onClose }: { onClose: () => void }) {
  const [games, setGames] = useState<GameLogSummary[] | null>(null);
  const [lines, setLines] = useState<GameLogLine[] | null>(null);
  const [error, setError] = useState("");
  const [handNo, setHandNo] = useState(0);
  const [step, setStep] = useState(0);

  useEffect(() => {
    void emit<{ games?: GameLogSummary[]; error?: string }>("log:list").then((r) => {
      if (r.error) setError(r.error);
      setGames(r.games ?? []);
    });
  }, []);

  const hands = useMemo(() => (lines ? toHands(lines) : []), [lines]);
  const hand = hands[handNo];
  const snap = hand?.snaps[step];
  const last = (hand?.snaps.length ?? 1) - 1;
  const start = lines?.[0]?.t === "start" ? lines[0] : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
      else if (e.key === "ArrowRight") setStep((s) => Math.min(last, s + 1));
      else return;
      // 後ろの対局画面にキーを渡さない
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [last, onClose]);

  const open = async (id: string) => {
    const r = await emit<{ lines?: GameLogLine[]; error?: string }>("log:get", { id });
    if (r.lines) {
      setError("");
      setLines(r.lines);
      setHandNo(0);
      setStep(0);
    } else setError(r.error ?? "読み込めませんでした");
  };

  return (
    <div className="glv">
      <style>{CSS}</style>
      <div className="glv-head">
        <h2>対局の記録</h2>
        {lines && <button onClick={() => setLines(null)}>一覧へ</button>}
        <button onClick={onClose}>閉じる</button>
      </div>
      {error && <div className="glv-err">{error}</div>}
      {!lines &&
        (games === null ? (
          <div>読み込み中…</div>
        ) : games.length === 0 ? (
          <div>自分が打った対局の記録はまだありません</div>
        ) : (
          <div>
            {games.map((g) => (
              <button key={g.id} className="glv-game" onClick={() => void open(g.id)}>
                {new Date(g.at).toLocaleString("ja-JP")}　{g.players.join("・")}
              </button>
            ))}
          </div>
        ))}
      {lines && !hand && <div>この対局には局の記録がありません</div>}
      {hand && start && (
        <>
          <div className="glv-step">
            <select
              value={handNo}
              onChange={(e) => {
                setHandNo(Number(e.target.value));
                setStep(0);
              }}
            >
              {hands.map((h, i) => (
                <option key={i} value={i}>
                  {h.head.label} {h.head.honba}本場
                </option>
              ))}
            </select>
            <button disabled={step <= 0} onClick={() => setStep(step - 1)}>
              前へ
            </button>
            <input type="range" min={0} max={last} value={step} onChange={(e) => setStep(Number(e.target.value))} />
            <button disabled={step >= last} onClick={() => setStep(step + 1)}>
              次へ
            </button>
            <span>
              {step + 1}/{last + 1}
            </span>
          </div>
          {snap && (
            <>
              <div className="glv-now">
                {start.players[snap.seat]?.name}：{EVENT_LABEL[snap.ev] ?? snap.ev}
                {snap.text ? `「${snap.text}」` : ""}　残り{snap.wall}枚
                {hand.head.genre ? `　ジャンル：${hand.head.genre}` : ""}
              </div>
              {snap.hands.map((s, i) => (
                <Seat key={i} name={start.players[i]?.name ?? ""} seat={s} on={i === snap.seat} dealer={i === hand.head.dealer} />
              ))}
            </>
          )}
          {hand.result && step === last && (
            <div className="glv-result">
              <div>{hand.result.title}</div>
              {hand.result.note && <div>{hand.result.note}</div>}
              {hand.result.wins.map((w, i) => (
                <div key={i}>
                  {w.name}：{w.words.join("・")}　{w.label}　+{w.gain}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
