// チャット・マイ単語・ルーム辞書・同種テーマ・役一覧
import { FormEvent, useEffect, useRef, useState } from "react";
import { THEMES } from "../../shared/yaku";
import { emit, getMyWords, send, setMyWords, toast, useStore } from "../net";
import { KuyouHand, useKuyouPref } from "./Kuyou";
import { openYakuWindow, YakuList } from "./YakuList";

export function ChatPanel({ compact }: { compact?: boolean }) {
  const all = useStore((s) => s.room?.chat ?? []);
  const kuyouOn = useKuyouPref();
  const chat = kuyouOn ? all : all.filter((m) => !m.kuyou);
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chat.length]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    send("room:chat", { text });
    setText("");
  };
  return (
    <div className={`chat ${compact ? "chat-compact" : ""}`}>
      <div className="chat-list" ref={listRef}>
        {chat.map((m) => (
          <div key={m.id} className={m.system ? "chat-sys" : "chat-msg"}>
            {!m.system && <b>{m.kuyou ? `🙏 ${m.name}の供養` : m.name}</b>}
            {m.kuyou ? <KuyouHand post={m.kuyou} size="xs" joined /> : <span>{m.text}</span>}
          </div>
        ))}
      </div>
      <form onSubmit={submit} className="chat-form">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="メッセージ" maxLength={200} />
        <button className="btn btn-sm">送信</button>
      </form>
    </div>
  );
}

export function MyWordsPanel() {
  const [words, setWords] = useState<string[]>(getMyWords());
  const [text, setText] = useState("");
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const items = text
      .split(/[\s、,，]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!items.length) return;
    const before = words.length;
    const res = await setMyWords([...words, ...items]);
    setWords(res);
    setText("");
    if (res.length < before + items.length) toast("牌で作れない語は登録されませんでした", "error");
  };
  const remove = async (w: string) => setWords(await setMyWords(words.filter((x) => x !== w)));
  return (
    <div className="panel-sec">
      <p className="hint">
        辞書にない語を登録すると、その語を含む形でもアガれます。アガったときに他の人の投票で判定され、承認されるとルーム辞書に入ります。登録した語は他の人には見えません。
      </p>
      <form onSubmit={add} className="row">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="例：ぽけもん（空白で複数）" />
        <button className="btn btn-sm">登録</button>
      </form>
      <div className="word-chips">
        {words.length === 0 && <span className="muted">まだありません</span>}
        {words.map((w) => (
          <span key={w} className="chip">
            {w}
            <button onClick={() => remove(w)} aria-label="削除">
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

export function RoomWordsPanel({ lobby }: { lobby?: boolean }) {
  const room = useStore((s) => s.room);
  const [text, setText] = useState("");
  const [look, setLook] = useState<{ word: string; inDict: boolean; inRoom: boolean } | null | "none">(null);
  if (!room) return null;
  const add = async () => {
    const res = await emit<{ error?: string; word?: string }>("room:addWord", { word: text });
    if (res.error) toast(res.error, "error");
    else setText("");
  };
  const lookup = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const r = await emit<{ word: string; inDict: boolean; inRoom: boolean } | null>("dict:lookup", { word: text });
    setLook(r ?? "none");
  };
  return (
    <div className="panel-sec">
      <p className="hint">ルーム辞書の語は全員が使えます（承認済みの扱い）。投票で承認された語もここに入ります。</p>
      {lobby && (
        <form onSubmit={lookup} className="row">
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setLook(null);
            }}
            placeholder="語を調べる・追加する"
          />
          <button className="btn btn-sm">調べる</button>
          <button type="button" className="btn btn-sm" onClick={add}>
            追加
          </button>
        </form>
      )}
      {lobby && look && (
        <div className="lookup">
          {look === "none" ? (
            <span className="bad">牌で作れない語です</span>
          ) : look.inDict ? (
            <span className="good">「{look.word}」は辞書にあります</span>
          ) : look.inRoom ? (
            <span className="good">「{look.word}」はルーム辞書にあります</span>
          ) : (
            <span className="bad">「{look.word}」は辞書にありません</span>
          )}
        </div>
      )}
      <div className="word-chips">
        {room.roomWords.length === 0 && <span className="muted">まだありません</span>}
        {room.roomWords.map((w) => (
          <span key={w} className="chip chip-room">
            {w}
            {room.isHost && (
              <button onClick={() => send("room:removeWord", { word: w })} aria-label="削除">
                ×
              </button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ThemePanel() {
  const theme = useStore((s) => s.game?.myTheme ?? null);
  const set = (name: string, pure: boolean) => send("player:theme", { theme: name ? { name, pure } : null });
  return (
    <div className="panel-sec">
      <p className="hint">同種（頭以外の語が同じテーマ）を狙うときは、アガる前にテーマを宣言しておきます。アガったときに他の人が投票で判定します。</p>
      <div className="row">
        <select value={theme?.name ?? ""} onChange={(e) => set(e.target.value, theme?.pure ?? false)}>
          <option value="">宣言しない</option>
          {THEMES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={theme?.pure ?? false} disabled={!theme} onChange={(e) => set(theme!.name, e.target.checked)} />
          頭も含む（純同種）
        </label>
      </div>
    </div>
  );
}

export function YakuPanel() {
  const extraTiles = useStore((s) => s.room?.settings.extraTiles ?? true);
  return (
    <div className="panel-sec yk">
      <div className="yk-tools">
        <button className="btn btn-xs btn-ghost" onClick={() => openYakuWindow(extraTiles)}>
          別窓で開く
        </button>
      </div>
      <YakuList extraTiles={extraTiles} />
    </div>
  );
}
