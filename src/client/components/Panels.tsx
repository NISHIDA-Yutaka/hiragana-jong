// チャット・マイ単語・ルーム辞書・同種テーマ・役一覧
import { FormEvent, useEffect, useRef, useState } from "react";
import { THEMES } from "../../shared/yaku";
import { emit, getMyWords, send, setMyWords, toast, useStore } from "../net";

export function ChatPanel({ compact }: { compact?: boolean }) {
  const chat = useStore((s) => s.room?.chat ?? []);
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
            {!m.system && <b>{m.name}</b>}
            <span>{m.text}</span>
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

const YAKU_TABLE: [string, string, string][] = [
  ["門前清自摸和", "1", "鳴かずにツモ"],
  ["立直", "1（一巡目2）", "門前でテンパイを宣言"],
  ["一発", "1", "リーチ後1巡以内にアガる"],
  ["清文", "1（門前2）", "特殊文字（濁音・ー等）を含まない"],
  ["同頭", "1（門前2）", "語頭が同じ語が2つ"],
  ["同尾", "1（門前2）", "語尾が同じ語が2つ"],
  ["三槓子", "1（暗カン3）", "カンが3つ"],
  ["回文", "1／語", "とまと など回文の語"],
  ["二連", "2（門前3）", "頭以外の2語がしりとり"],
  ["五音", "2（門前4）", "5語の頭文字の母音があいうえお"],
  ["特文", "2（門前3）", "頭以外の全語に特殊文字"],
  ["四槓子", "2（暗カン4）", "カンが4つ"],
  ["オープンリーチ", "2（一巡目3）", "手牌を公開してリーチ"],
  ["七対子", "2", "2文字の語×7（異なる語）"],
  ["同頭同尾", "3（門前4）", "同頭と同尾を1組ずつ"],
  ["同種", "3（門前4）", "頭以外が同じテーマ（宣言・投票）"],
  ["同言", "3（門前4）", "まったく同じ語が2つ"],
  ["純特文", "3（門前4）", "全ての語に特殊文字"],
  ["重回文", "3＋α", "語をつなげて4文字以上の回文（＋文字数−4）"],
  ["天和／地和", "4", "配牌でアガる／親の第一打でロン"],
  ["三連", "4（門前5）", "頭以外の3語がしりとり"],
  ["純行", "4（門前5）", "5語の頭文字が同じ行（あいうえお等）"],
  ["純同種", "4（門前5）", "全ての語が同じテーマ"],
  ["作文", "4", "14牌で1つの文章（鳴きなし・投票）"],
  ["四連", "6（門前8）", "頭以外の4語がしりとり"],
  ["五連", "8（門前で役満）", "頭から5語すべてしりとり"],
  ["重言", "8（門前で役満）", "同じ語のペアが2組"],
  ["カンドラ", "副次", "カン1つにつき（文字数−3）翻"],
  ["特殊文字ドラ", "副次", "特殊文字4枚以上で（枚数−3）翻"],
];

export function YakuPanel() {
  return (
    <div className="panel-sec">
      <table className="yaku-table">
        <tbody>
          {YAKU_TABLE.map(([n, h, d]) => (
            <tr key={n}>
              <td className="yn">{n}</td>
              <td className="yh">{h}</td>
              <td className="yd">{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">13翻以上は数え役満。点数は1翻1本〜役満32本（親は1.5倍）。1本＝1,000点。</p>
    </div>
  );
}
