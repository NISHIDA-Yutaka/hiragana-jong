import { useState } from "react";
import type { BotLevel, RoomSettings } from "../../shared/protocol";
import { emit, leaveRoom, send, toast, useStore } from "../net";
import { ChatPanel, MyWordsPanel, RoomWordsPanel, YakuPanel } from "./Panels";

const LEVELS: [BotLevel, string][] = [
  ["weak", "弱い"],
  ["normal", "普通"],
  ["strong", "強い"],
];

export function Lobby() {
  const room = useStore((s) => s.room)!;
  const [level, setLevel] = useState<BotLevel>("normal");
  const [tab, setTab] = useState<"chat" | "words" | "room" | "yaku">("chat");
  const s = room.settings;
  const host = room.isHost;
  const set = (p: Partial<RoomSettings>) => send("room:settings", p);
  const invite = `${location.origin}${location.pathname}?room=${room.code}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite);
      toast("招待リンクをコピーしました");
    } catch {
      toast(invite);
    }
  };
  const start = async () => {
    const r = await emit("room:start");
    if (r.error) toast(r.error, "error");
  };
  const seats = room.players.slice(0, Math.max(s.playerCount, room.players.length));

  return (
    <div className="lobby">
      <header className="lobby-head">
        <div className="brand">ひらがじゃん</div>
        <div className="room-code" onClick={copy} title="クリックで招待リンクをコピー">
          <span>部屋コード</span>
          <b>{room.code}</b>
          <em>招待リンクをコピー</em>
        </div>
        <button className="btn btn-ghost" onClick={leaveRoom}>
          退出
        </button>
      </header>

      <main className="lobby-main">
        <section className="card members">
          <h2>
            メンバー <small>{s.playerCount}人打ち</small>
          </h2>
          <ul>
            {seats.map((p, i) => (
              <li key={p.id} className={`member ${i >= s.playerCount ? "member-extra" : ""}`}>
                <span className={`avatar ${p.isBot ? "avatar-bot" : ""}`}>{p.isBot ? "🤖" : p.name.slice(0, 1)}</span>
                <span className="mname">
                  {p.name}
                  {p.id === room.you && <em>（あなた）</em>}
                </span>
                {p.isHost && <span className="badge">ホスト</span>}
                {!p.connected && <span className="badge badge-off">切断中</span>}
                {i >= s.playerCount && <span className="badge badge-off">観戦</span>}
                {host && p.id !== room.you && (
                  <button className="btn btn-xs btn-ghost" onClick={() => send("room:removeMember", { id: p.id })}>
                    {p.isBot ? "外す" : "退出させる"}
                  </button>
                )}
              </li>
            ))}
            {Array.from({ length: Math.max(0, s.playerCount - room.players.length) }).map((_, i) => (
              <li key={"empty" + i} className="member member-empty">
                <span className="avatar avatar-empty">?</span>
                <span className="mname muted">空席</span>
              </li>
            ))}
          </ul>
          {host && (
            <div className="bot-row">
              <select value={level} onChange={(e) => setLevel(e.target.value as BotLevel)}>
                {LEVELS.map(([v, l]) => (
                  <option key={v} value={v}>
                    CPU：{l}
                  </option>
                ))}
              </select>
              <button className="btn btn-sm" onClick={() => send("room:addBot", { level })}>
                CPUを追加
              </button>
              <button className="btn btn-sm" onClick={() => send("room:fillBots", { level })}>
                空席をCPUで埋める
              </button>
            </div>
          )}
          <p className="hint">招待リンクを友だちに送ると、同じ部屋に入れます。</p>
        </section>

        <section className="card settings">
          <h2>ルール設定{!host && <small>（ホストが変更できます）</small>}</h2>
          <fieldset disabled={!host}>
            <Row label="人数">
              <Seg value={s.playerCount} options={[[4, "4人"], [3, "3人"], [2, "2人"]]} onChange={(v) => set({ playerCount: v as 2 | 3 | 4 })} />
            </Row>
            <Row label="長さ">
              <Seg
                value={s.length}
                options={[
                  ["tonpuu", "東風戦"],
                  ["hanchan", "半荘戦"],
                  ["ikkyoku", "1局勝負"],
                ]}
                onChange={(v) => set({ length: v as RoomSettings["length"] })}
              />
            </Row>
            <Row label="持ち時間">
              <Seg
                value={s.timer}
                options={[
                  ["fast", "速い 10+30秒"],
                  ["normal", "普通 20+60秒"],
                  ["slow", "長考 40+120秒"],
                  ["none", "無制限"],
                ]}
                onChange={(v) => set({ timer: v as RoomSettings["timer"] })}
              />
            </Row>
            <Row label="辞書">
              <Seg
                value={s.dictLevel}
                options={[
                  ["full", "広い（約20万語）"],
                  ["common", "常用語のみ（約2万語）"],
                ]}
                onChange={(v) => set({ dictLevel: v as RoomSettings["dictLevel"] })}
              />
            </Row>
            <Row label="鳴き">
              <Seg
                value={s.calls ? "on" : "off"}
                options={[
                  ["on", "ポン・カンあり"],
                  ["off", "なし"],
                ]}
                onChange={(v) => set({ calls: v === "on" })}
              />
            </Row>
            <Row label="清音代用">
              <Seg
                value={s.seion ? "on" : "off"}
                options={[
                  ["off", "なし"],
                  ["on", "あり（かき→かぎ 等）"],
                ]}
                onChange={(v) => set({ seion: v === "on" })}
              />
            </Row>
            <Row label="追加牌">
              <Seg
                value={s.extraTiles ? "on" : "off"}
                options={[
                  ["off", "なし（136牌）"],
                  ["on", "あり（濁音など＋30牌）"],
                ]}
                onChange={(v) => set({ extraTiles: v === "on" })}
              />
            </Row>
            <Row label="否決時">
              <Seg
                value={s.rejectPenalty}
                options={[
                  ["cancel", "取り消しのみ"],
                  ["chombo", "チョンボ（満貫払い）"],
                ]}
                onChange={(v) => set({ rejectPenalty: v as RoomSettings["rejectPenalty"] })}
              />
            </Row>
          </fieldset>
          {host ? (
            <button className="btn btn-primary btn-big start-btn" onClick={start}>
              対局開始
            </button>
          ) : (
            <div className="waiting">ホストの開始を待っています…</div>
          )}
        </section>

        <section className="card side">
          <div className="tabs">
            {(
              [
                ["chat", "チャット"],
                ["words", "マイ単語"],
                ["room", "ルーム辞書"],
                ["yaku", "役一覧"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
                {l}
              </button>
            ))}
          </div>
          <div className="tab-body">
            {tab === "chat" && <ChatPanel />}
            {tab === "words" && <MyWordsPanel />}
            {tab === "room" && <RoomWordsPanel lobby />}
            {tab === "yaku" && <YakuPanel />}
          </div>
        </section>
      </main>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <span className="set-label">{label}</span>
      {children}
    </div>
  );
}

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([v, l]) => (
        <button key={String(v)} type="button" className={v === value ? "on" : ""} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}
