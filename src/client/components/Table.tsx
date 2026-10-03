// 対局画面
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CallOption, GameEvent, GameView } from "../../shared/protocol";
import { emit, lsGet, lsSet, send, toast, useStore } from "../net";
import { callSound, chime, clack, prefs, riichiSound, say, setPref, tick } from "../sound";
import { Hand } from "./Hand";
import { FinalModal, ResultModal, VoteModal } from "./Overlays";
import { ChatPanel, MyWordsPanel, RoomWordsPanel, ThemePanel, YakuPanel } from "./Panels";
import { CenterBox, Meld, NamePlate, Pos, posFor, SeatZone } from "./Seats";
import { Tile } from "./Tile";

const W = 1600;
const H = 900;

function useStageScale() {
  const [s, setS] = useState(1);
  useLayoutEffect(() => {
    const f = () => setS(Math.min(window.innerWidth / W, window.innerHeight / H));
    f();
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return s;
}

interface Callout {
  key: number;
  pos: Pos;
  text: string;
  sub?: string;
  kind: string;
}

const CALL_TEXT: Partial<Record<GameEvent["type"], string>> = {
  pon: "ポン",
  kan: "カン",
  ankan: "カン",
  kakan: "カン",
  riichi: "リーチ",
  ron: "ロン",
  tsumo: "ツモ",
  ryuukyoku: "流局",
  abort: "流局",
  chombo: "チョンボ",
};

async function act(a: object) {
  const r = await emit("game:action", a);
  if (r.error) toast(r.error, "error");
}

export function Table() {
  const g = useStore((s) => s.game)!;
  const room = useStore((s) => s.room)!;
  const scale = useStageScale();
  const me = g.mySeat ?? 0;
  const spectator = g.mySeat === null;
  const [panel, setPanel] = useState<null | "chat" | "words" | "theme" | "room" | "yaku" | "settings">(null);
  const [callouts, setCallouts] = useState<Callout[]>([]);
  const [riichiMode, setRiichiMode] = useState<null | "riichi" | "open">(null);
  const [chooser, setChooser] = useState<null | { title: string; options: CallOption[]; onPick: (o: CallOption) => void }>(null);
  const [auto, setAuto] = useState(() => lsGet("auto", { win: false, noCall: false, tsumogiri: false }));
  const [oneClick, setOneClick] = useState(() => lsGet("oneClick", false));
  const [, force] = useState(0);
  const lastSeq = useRef<number>(Math.max(0, ...g.events.map((e) => e.seq)));
  const unreadChat = useUnreadChat(panel === "chat");

  const setAutoK = (k: keyof typeof auto, v: boolean) => {
    const n = { ...auto, [k]: v };
    setAuto(n);
    lsSet("auto", n);
  };

  // イベント（効果音・発声・演出）
  useEffect(() => {
    const fresh = g.events.filter((e) => e.seq > lastSeq.current);
    if (!fresh.length) return;
    lastSeq.current = Math.max(...fresh.map((e) => e.seq));
    for (const e of fresh) {
      const pos = posFor(e.seat, me, g.n);
      if (e.type === "discard") clack();
      if (e.type === "start") chime();
      const text = CALL_TEXT[e.type];
      if (text) {
        if (e.type === "riichi") riichiSound();
        else callSound();
        say(e.type === "riichi" && e.text === "オープンリーチ" ? "オープンリーチ" : text);
        const key = e.seq;
        const sub = e.type === "riichi" ? (e.text === "オープンリーチ" ? "オープン" : undefined) : e.type === "abort" || e.type === "chombo" ? e.text : e.text;
        setCallouts((c) => [...c, { key, pos: e.type === "ryuukyoku" || e.type === "abort" ? ("center" as Pos) : pos, text, sub, kind: e.type }]);
        setTimeout(() => setCallouts((c) => c.filter((x) => x.key !== key)), 1700);
      }
      if (e.type === "reject") toast(`${g.seats[e.seat]?.name}：${e.text}`, "error");
      if (e.type === "vote") toast("アガリの判定（投票）が始まりました");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.events]);

  // 持ち時間表示
  useEffect(() => {
    if (!g.deadline) return;
    const t = setInterval(() => force((x) => x + 1), 250);
    return () => clearInterval(t);
  }, [g.deadline]);
  const remain = g.deadline ? Math.max(0, (g.deadline - Date.now()) / 1000) : null;
  const lastTick = useRef(-1);
  useEffect(() => {
    if (remain !== null && remain <= 5 && remain > 0) {
      const s = Math.ceil(remain);
      if (s !== lastTick.current) {
        lastTick.current = s;
        tick();
      }
    }
  }, [remain]);

  const actions = g.actions;
  const turnA = actions?.kind === "turn" ? actions : null;
  const callA = actions?.kind === "call" ? actions : null;

  useEffect(() => {
    setRiichiMode(null);
    setChooser(null);
  }, [actions?.kind, g.turn, g.phase]);

  // 自動和了・鳴きなし・ツモ切り
  useEffect(() => {
    if (spectator) return;
    if (callA) {
      if (callA.ron && auto.win) void act({ type: "call", call: "ron" });
      else if (!callA.ron && auto.noCall) void act({ type: "call", call: "pass" });
    } else if (turnA) {
      if (turnA.canTsumo && auto.win) void act({ type: "tsumo" });
      else if (auto.tsumogiri && !turnA.canTsumo && !turnA.afterCall && g.drawnId !== null && !turnA.locked) {
        const id = g.drawnId;
        const t = setTimeout(() => act({ type: "discard", tileId: id }), 350);
        return () => clearTimeout(t);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, auto]);

  const myTurnDiscard = !!turnA && g.phase === "play";
  const discardable = useMemo(() => {
    if (!myTurnDiscard || !turnA) return null;
    if (riichiMode) return new Set(turnA.riichiDiscards);
    if (turnA.locked) return g.drawnId !== null ? new Set([g.drawnId]) : null;
    return new Set(g.myHand.map((t) => t.id));
  }, [myTurnDiscard, turnA, riichiMode, g.drawnId, g.myHand]);

  const onDiscard = (id: number) => {
    if (!turnA) return;
    if (riichiMode) {
      void act({ type: "discard", tileId: id, riichi: riichiMode });
      setRiichiMode(null);
    } else void act({ type: "discard", tileId: id });
  };

  const pick = (title: string, options: CallOption[], onPick: (o: CallOption) => void) => {
    if (options.length === 1) onPick(options[0]);
    else setChooser({ title, options, onPick });
  };

  const me4 = g.seats[me];
  const isMyTurn = g.turn === me && !spectator;
  const myMelds = me4?.melds ?? [];

  return (
    <div className="table-root">
      <div className="stage" style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})` }}>
        <div className="felt" />
        <div className="table-square">
          <CenterBox g={g} mySeat={me} />
          {g.seats.map((s) => (
            <SeatZone key={s.seat} s={s} pos={posFor(s.seat, me, g.n)} isMe={!spectator && s.seat === me} lastDiscardId={g.lastDiscard?.seat === s.seat ? g.lastDiscard.tileId : null} isTurn={g.turn === s.seat} />
          ))}
          {callouts.map((c) => (
            <div key={c.key} className={`callout callout-${c.pos} callout-${c.kind}`}>
              <span className="co-text">{c.text}</span>
              {c.sub && <span className="co-sub">{c.sub}</span>}
            </div>
          ))}
        </div>

        {g.seats.map((s) => (
          <NamePlate key={s.seat} s={s} pos={posFor(s.seat, me, g.n)} isTurn={g.turn === s.seat && (g.phase === "play" || g.phase === "calls")} />
        ))}

        <div className="top-bar">
          <span className="tb-room">
            部屋 {room.code}・{g.lengthLabel}
          </span>
          <button className={`tb-btn ${panel === "chat" ? "on" : ""}`} onClick={() => setPanel(panel === "chat" ? null : "chat")}>
            チャット{unreadChat > 0 && <i className="dot">{unreadChat}</i>}
          </button>
          <button className={`tb-btn ${panel === "words" ? "on" : ""}`} onClick={() => setPanel(panel === "words" ? null : "words")}>
            マイ単語
          </button>
          <button className={`tb-btn ${panel === "theme" ? "on" : ""}`} onClick={() => setPanel(panel === "theme" ? null : "theme")}>
            同種{g.myTheme && <i className="dot">!</i>}
          </button>
          <button className={`tb-btn ${panel === "room" ? "on" : ""}`} onClick={() => setPanel(panel === "room" ? null : "room")}>
            ルーム辞書
          </button>
          <button className={`tb-btn ${panel === "yaku" ? "on" : ""}`} onClick={() => setPanel(panel === "yaku" ? null : "yaku")}>
            役
          </button>
          <button className={`tb-btn ${panel === "settings" ? "on" : ""}`} onClick={() => setPanel(panel === "settings" ? null : "settings")}>
            ⚙
          </button>
        </div>

        {panel && (
          <div className="side-panel">
            <div className="sp-head">
              {{ chat: "チャット", words: "マイ単語", theme: "同種の宣言", room: "ルーム辞書", yaku: "役一覧", settings: "設定" }[panel]}
              <button className="btn btn-xs btn-ghost" onClick={() => setPanel(null)}>
                ✕
              </button>
            </div>
            <div className="sp-body">
              {panel === "chat" && <ChatPanel compact />}
              {panel === "words" && <MyWordsPanel />}
              {panel === "theme" && <ThemePanel />}
              {panel === "room" && <RoomWordsPanel />}
              {panel === "yaku" && <YakuPanel />}
              {panel === "settings" && (
                <div className="panel-sec settings-list">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={prefs.sound}
                      onChange={(e) => {
                        setPref("sound", e.target.checked);
                        force((x) => x + 1);
                      }}
                    />
                    効果音
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={prefs.voice}
                      onChange={(e) => {
                        setPref("voice", e.target.checked);
                        force((x) => x + 1);
                      }}
                    />
                    発声（ポン・ロンなど）
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={oneClick}
                      onChange={(e) => {
                        setOneClick(e.target.checked);
                        lsSet("oneClick", e.target.checked);
                      }}
                    />
                    1クリックで打牌する
                  </label>
                  {room.isHost && (
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => {
                        if (confirm("対局を中断してロビーに戻りますか？")) send("room:abort");
                      }}
                    >
                      対局を中断する（ホスト）
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {!spectator && (
          <>
            <div className="bottom-area">
              <Hand
                hand={g.myHand}
                serverArr={g.arrangement}
                drawnId={g.drawnId}
                locked={!!me4?.riichi}
                discardable={discardable}
                highlight={riichiMode && turnA ? new Set(turnA.riichiDiscards) : null}
                oneClick={oneClick}
                onDiscard={onDiscard}
                scale={scale}
                meldCount={myMelds.length}
              />
              <div className="my-melds">
                {myMelds.map((m, i) => (
                  <Meld key={i} m={m} size="sm" />
                ))}
              </div>
            </div>

            <div className="auto-toggles">
              <label className={auto.win ? "on" : ""}>
                <input type="checkbox" checked={auto.win} onChange={(e) => setAutoK("win", e.target.checked)} />
                自動和了
              </label>
              <label className={auto.noCall ? "on" : ""}>
                <input type="checkbox" checked={auto.noCall} onChange={(e) => setAutoK("noCall", e.target.checked)} />
                鳴きなし
              </label>
              <label className={auto.tsumogiri ? "on" : ""}>
                <input type="checkbox" checked={auto.tsumogiri} onChange={(e) => setAutoK("tsumogiri", e.target.checked)} />
                ツモ切り
              </label>
            </div>

            {remain !== null && (isMyTurn || callA) && (
              <div className={`timer ${remain <= 5 ? "urgent" : ""}`}>
                {remain > g.bank ? (
                  <>
                    <b>{Math.ceil(remain - g.bank)}</b>
                    <span>+{g.bank}</span>
                  </>
                ) : (
                  <b>{Math.ceil(remain)}</b>
                )}
              </div>
            )}

            {g.waits.length > 0 && (
              <div className="waits">
                待ち：
                {g.waits.map((c) => (
                  <Tile key={c} ch={c} size="xs" />
                ))}
              </div>
            )}

            <div className="action-bar">
              {chooser ? (
                <>
                  <span className="ab-title">{chooser.title}</span>
                  {chooser.options.map((o) => (
                    <button key={o.id} className="abtn abtn-word" onClick={() => (chooser.onPick(o), setChooser(null))}>
                      {o.word}
                    </button>
                  ))}
                  <button className="abtn abtn-skip" onClick={() => setChooser(null)}>
                    戻る
                  </button>
                </>
              ) : riichiMode ? (
                <>
                  <span className="ab-title">光っている牌を切ってリーチ</span>
                  <button className="abtn abtn-skip" onClick={() => setRiichiMode(null)}>
                    キャンセル
                  </button>
                </>
              ) : callA ? (
                <>
                  <span className="ab-title">
                    <Tile ch={callA.tile.ch} size="xs" /> {g.seats[callA.fromSeat].name}
                  </span>
                  {callA.ron && (
                    <button className="abtn abtn-ron" onClick={() => act({ type: "call", call: "ron" })}>
                      ロン
                    </button>
                  )}
                  {callA.kan.length > 0 && (
                    <button className="abtn abtn-kan" onClick={() => pick("カンする語", callA.kan, (o) => act({ type: "call", call: "kan", optionId: o.id }))}>
                      カン{callA.kan.length === 1 ? `（${callA.kan[0].word}）` : ""}
                    </button>
                  )}
                  {callA.pon.length > 0 && (
                    <button className="abtn abtn-pon" onClick={() => pick("ポンする語", callA.pon, (o) => act({ type: "call", call: "pon", optionId: o.id }))}>
                      ポン{callA.pon.length === 1 ? `（${callA.pon[0].word}）` : ""}
                    </button>
                  )}
                  <button className="abtn abtn-skip" onClick={() => act({ type: "call", call: "pass" })}>
                    スキップ
                  </button>
                </>
              ) : turnA && g.phase === "play" ? (
                <>
                  {turnA.canTsumo && (
                    <button className="abtn abtn-ron" onClick={() => act({ type: "tsumo" })}>
                      ツモ
                    </button>
                  )}
                  {turnA.riichiDiscards.length > 0 && !turnA.locked && (
                    <>
                      <button className="abtn abtn-riichi" onClick={() => setRiichiMode("riichi")}>
                        リーチ
                      </button>
                      <button className="abtn abtn-riichi" onClick={() => setRiichiMode("open")}>
                        オープン
                      </button>
                    </>
                  )}
                  {turnA.ankan.length + turnA.kakan.length > 0 && (
                    <button
                      className="abtn abtn-kan"
                      onClick={() =>
                        pick("カンする語", [...turnA.ankan.map((o) => ({ ...o, id: o.id })), ...turnA.kakan.map((o) => ({ ...o, id: 1000 + o.id }))], (o) =>
                          o.id >= 1000 ? act({ type: "kakan", optionId: o.id - 1000 }) : act({ type: "ankan", optionId: o.id }),
                        )
                      }
                    >
                      カン
                    </button>
                  )}
                  {turnA.canSakubun && (
                    <button
                      className="abtn abtn-saku"
                      onClick={() => {
                        const text = g.arrangement?.order.map((id) => g.myHand.find((t) => t.id === id)?.ch ?? "").join("");
                        if (confirm(`並べた順の「${text}」を文章として作文を宣言しますか？\n（他の人の投票で判定されます）`)) void act({ type: "sakubun" });
                      }}
                    >
                      作文
                    </button>
                  )}
                  {isMyTurn && <span className="ab-hint">{turnA.afterCall ? "鳴いた後の打牌" : turnA.locked ? "リーチ中" : "切る牌を選んでください"}</span>}
                </>
              ) : null}
            </div>
          </>
        )}
        {spectator && <div className="spectator-note">観戦中</div>}
      </div>

      <div className="rotate-hint">スマホは横向きにすると遊びやすくなります</div>
      {g.phase === "vote" && g.vote && <VoteModal g={g} />}
      {g.phase === "result" && g.result && <ResultModal g={g} />}
      {g.phase === "final" && g.final && <FinalModal g={g} />}
    </div>
  );
}

function useUnreadChat(open: boolean) {
  const chat = useStore((s) => s.room?.chat ?? []);
  const seen = useRef(chat.length ? chat[chat.length - 1].id : 0);
  const last = chat.length ? chat[chat.length - 1].id : 0;
  if (open) seen.current = last;
  return chat.filter((m) => m.id > seen.current && !m.system).length;
}
