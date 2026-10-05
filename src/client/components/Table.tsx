// 対局画面
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CallOption, GameEvent, GameView } from "../../shared/protocol";
import { emit, lsGet, lsSet, send, toast, useStore } from "../net";
import { callSound, clack, hyoshigi, prefs, riichiSound, riipaiStart, say, setPref, shuffle, tick } from "../sound";
import { ChatFlow } from "./ChatFlow";
import { CallDetailDialog, PlaceDialog, toGroups, TsumoDialog } from "./Declare";
import { Hand } from "./Hand";
import { FinalModal, ResultModal, VoteModal } from "./Overlays";
import { ChatPanel, MyWordsPanel, RoomWordsPanel, ThemePanel, YakuPanel } from "./Panels";
import { CenterBox, Meld, NamePlate, Pos, posFor, SeatZone } from "./Seats";
import { Tile } from "./Tile";
import { TileCountList } from "./TileCount";

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
  const [panel, setPanel] = useState<null | "chat" | "words" | "theme" | "room" | "tiles" | "yaku" | "settings">(null);
  const [callouts, setCallouts] = useState<Callout[]>([]);
  const [riichiMode, setRiichiMode] = useState<null | "riichi" | "open">(null);
  const [chooser, setChooser] = useState<null | { title: string; options: CallOption[]; onPick: (o: CallOption) => void }>(null);
  const [auto, setAuto] = useState(() => lsGet("auto", { tsumogiri: false }));
  const [oneClick, setOneClick] = useState(() => lsGet("oneClick", false));
  const [chatFlow, setChatFlow] = useState(() => lsGet("chatFlow", true));
  const [tsumoOpen, setTsumoOpen] = useState(false);
  const [sakuPlace, setSakuPlace] = useState(false);
  const [, force] = useState(0);
  // 対局画面は配牌と同時に開くので、開いた時点の最後の出来事が配牌なら、その音（配牌・理牌の始まり）も鳴らす
  const [justDealt] = useState(() => g.events[g.events.length - 1]?.type === "start");
  const lastSeq = useRef<number>(Math.max(0, ...g.events.map((e) => e.seq)) - (justDealt ? 1 : 0));
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
      if (e.type === "start") {
        shuffle();
        // 理牌なしならそのまま対局が始まる
        if (!g.riipai) setTimeout(hyoshigi, 1100);
      }
      const text = CALL_TEXT[e.type];
      if (text) {
        if (e.type === "riichi") riichiSound();
        else callSound();
        say(e.type === "riichi" && e.text === "オープンリーチ" ? "オープンリーチ" : text);
        const key = e.seq;
        const sub = e.type === "riichi" ? (e.text === "オープンリーチ" ? "オープン" : undefined) : e.type === "chombo" ? undefined : e.text;
        setCallouts((c) => [...c, { key, pos: e.type === "ryuukyoku" || e.type === "abort" ? ("center" as Pos) : pos, text, sub, kind: e.type }]);
        setTimeout(() => setCallouts((c) => c.filter((x) => x.key !== key)), 1700);
      }
      if (e.type === "reject") toast(`${g.seats[e.seat]?.name}：${e.text}`, "error");
      if (e.type === "vote") toast("アガリの判定（投票）が始まりました");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.events]);

  // 理牌の始まりと終わり（対局の始まり）の音
  const hadRiipai = useRef(justDealt ? false : !!g.riipai);
  useEffect(() => {
    const now = !!g.riipai;
    if (now === hadRiipai.current) return;
    hadRiipai.current = now;
    if (now) setTimeout(riipaiStart, 900);
    else hyoshigi();
  }, [g.riipai]);

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
    setTsumoOpen(false);
    setSakuPlace(false);
  }, [actions?.kind, g.turn, g.phase]);

  // 自動ツモ切り
  useEffect(() => {
    if (spectator || !turnA) return;
    if (auto.tsumogiri && !turnA.afterCall && g.drawnId !== null) {
      const id = g.drawnId;
      const t = setTimeout(() => act({ type: "discard", tileId: id }), 350);
      return () => clearTimeout(t);
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
  // 区切らずに並べた13枚へのロンは作文
  const ronSentence = actions?.kind === "ronPlace" && myMelds.length === 0 && g.myHand.length === 13 && toGroups(g.arrangement, g.myHand).length === 1;

  return (
    <div className="table-root">
      <div className="stage" style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})` }}>
        <div className="felt" />
        <div className="table-3d">
          <div className="table-square">
            <CenterBox g={g} mySeat={me} />
            {g.seats.map((s) => (
              <SeatZone key={s.seat} n={g.n} s={s} pos={posFor(s.seat, me, g.n)} isMe={!spectator && s.seat === me} lastDiscardId={g.lastDiscard?.seat === s.seat ? g.lastDiscard.tileId : null} isTurn={g.turn === s.seat} />
            ))}
          </div>
        </div>
        <div className="callout-layer">
          {callouts.map((c) => (
            <div key={c.key} className={`callout callout-${c.pos} callout-${c.kind}`}>
              <span className="co-text">{c.text}</span>
              {c.sub && <span className="co-sub">{c.sub}</span>}
            </div>
          ))}
        </div>

        {chatFlow && <ChatFlow />}

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
          <button className={`tb-btn ${panel === "tiles" ? "on" : ""}`} onClick={() => setPanel(panel === "tiles" ? null : "tiles")}>
            牌
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
              {{ chat: "チャット", words: "マイ単語", theme: "同種の宣言", room: "ルーム辞書", tiles: "牌の一覧", yaku: "役一覧", settings: "設定" }[panel]}
              <button className="btn btn-xs btn-ghost" onClick={() => setPanel(null)}>
                ✕
              </button>
            </div>
            <div className="sp-body">
              {panel === "chat" && <ChatPanel compact />}
              {panel === "words" && <MyWordsPanel />}
              {panel === "theme" && <ThemePanel />}
              {panel === "room" && <RoomWordsPanel />}
              {panel === "tiles" && (
                <div className="panel-sec">
                  <TileCountList extraTiles={room.settings.extraTiles} />
                </div>
              )}
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
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={chatFlow}
                      onChange={(e) => {
                        setChatFlow(e.target.checked);
                        lsSet("chatFlow", e.target.checked);
                      }}
                    />
                    チャットを卓に流す
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
              <label className={auto.tsumogiri ? "on" : ""}>
                <input type="checkbox" checked={auto.tsumogiri} onChange={(e) => setAutoK("tsumogiri", e.target.checked)} />
                ツモ切り
              </label>
            </div>

            {remain !== null && isMyTurn && (
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

            <div className="action-bar">
              {g.riipai ? (
                g.riipai.done ? (
                  <span className="ab-hint">ほかの人の理牌を待っています…</span>
                ) : (
                  <button className="abtn abtn-riipai" onClick={() => act({ type: "riipaiDone" })}>
                    理牌完了
                  </button>
                )
              ) : chooser ? (
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
                  <span className="ab-title">切る牌を選んでリーチ（テンパイかは自己申告）</span>
                  <button className="abtn abtn-skip" onClick={() => setRiichiMode(null)}>
                    キャンセル
                  </button>
                </>
              ) : callA ? (
                <>
                  <span className="ab-title">
                    <Tile ch={callA.tile.ch} size="xs" /> {g.seats[callA.fromSeat].name}
                    {remain !== null && (
                      <i className="window-bar">
                        <i style={{ width: `${Math.min(100, (remain / room.settings.callSeconds) * 100)}%` }} />
                      </i>
                    )}
                  </span>
                  <button className="abtn abtn-ron" disabled={!callA.ron} onClick={() => act({ type: "call", call: "ron" })}>
                    ロン
                  </button>
                  {room.settings.calls && (
                    <>
                      <button className="abtn abtn-kan" disabled={!callA.canKan} onClick={() => act({ type: "call", call: "kan" })}>
                        カン
                      </button>
                      <button className="abtn abtn-pon" disabled={!callA.canPon} onClick={() => act({ type: "call", call: "pon" })}>
                        ポン
                      </button>
                    </>
                  )}
                  <button className="abtn abtn-skip" onClick={() => act({ type: "call", call: "pass" })}>
                    スキップ
                  </button>
                </>
              ) : turnA && g.phase === "play" ? (
                <>
                  {turnA.canTsumo && (
                    <button className="abtn abtn-ron abtn-quiet" onClick={() => {
                        // 作文待ちのリーチでツモ牌が離れているときは作文の宣言にする
                        if (turnA.canSakubun && toGroups(g.arrangement, g.myHand).length === 2) setSakuPlace(true);
                        else setTsumoOpen(true);
                      }}>
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
                        // リーチ中でツモ牌が離れているときは、文章のどこに入れるか選ぶ
                        if (toGroups(g.arrangement, g.myHand).length === 2) return setSakuPlace(true);
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
        {g.notice && <div className="notice-banner">{g.notice}</div>}
        {g.riipai && <RiipaiBoard r={g.riipai} />}
      </div>

      {sakuPlace && turnA && (
        <PlaceDialog
          title="作文でツモ"
          lead="ツモ牌を文章のどこに入れるか選んで宣言します。他の人の投票で判定され、認められないとチョンボです。"
          groups={toGroups(g.arrangement, g.myHand).slice(0, 1)}
          extra={toGroups(g.arrangement, g.myHand)[1][0]}
          meldCount={0}
          deadline={null}
          confirmLabel="作文を宣言"
          onConfirm={(_, pos) => {
            setSakuPlace(false);
            void act({ type: "sakubun", pos });
          }}
          cancelLabel="やめる"
          onCancel={() => setSakuPlace(false)}
          sentence
        />
      )}
      {actions?.kind === "ronPlace" && (
        <PlaceDialog
          title="ロン"
          lead={ronSentence ? "ロン牌を文章のどこに入れるか選んでください（作文）。認められないとチョンボ（満貫払い）です。" : "ロン牌を入れる場所を選んでください。認められないとチョンボ（満貫払い）です。"}
          sentence={ronSentence}
          groups={toGroups(g.arrangement, g.myHand)}
          extra={actions.tile}
          meldCount={myMelds.length}
          deadline={g.deadline}
          confirmLabel="この形で宣言"
          onConfirm={(group, pos) => act({ type: "ronPlace", group, pos })}
          cancelLabel="宣言を取り消す（チョンボ）"
          onCancel={() => {
            if (confirm("ロン宣言を取り消すとチョンボになります。取り消しますか？")) void act({ type: "ronCancel" });
          }}
          danger
        />
      )}
      {actions?.kind === "callDetail" && (
        <CallDetailDialog
          call={actions.call}
          tile={actions.tile}
          groups={toGroups(g.arrangement, g.myHand)}
          deadline={g.deadline}
          onPick={(tileIds) => act({ type: "callDetail", tileIds })}
          onCancel={() => act({ type: "callDetail", cancel: true })}
        />
      )}
      {tsumoOpen && turnA && (
        <TsumoDialog
          groups={toGroups(g.arrangement, g.myHand)}
          meldCount={myMelds.length}
          onClose={() => setTsumoOpen(false)}
          onConfirm={(ins) => {
            setTsumoOpen(false);
            // ツモ牌を入れる場所はサーバーで入れる（リーチ中は並べ替えを送っても受け付けられないため）
            void act({ type: "tsumo", place: ins ? { group: ins.group, pos: ins.pos } : undefined });
          }}
        />
      )}
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

function RiipaiBoard({ r }: { r: NonNullable<GameView["riipai"]> }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = r.deadline ? Math.max(0, Math.ceil((r.deadline - now) / 1000)) : null;
  return (
    <div className="riipai-board">
      <div className="rb-title">理牌タイム</div>
      {left !== null && (
        <div className={`rb-time ${left <= 10 ? "urgent" : ""}`}>
          {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
        </div>
      )}
      <div className="rb-lead">手牌を語ごとに並べてください。全員が「理牌完了」を押すか、時間になると始まります。</div>
      {r.waiting.length > 0 && <div className="rb-wait">理牌中：{r.waiting.join("、")}</div>}
    </div>
  );
}
