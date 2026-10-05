import { FormEvent, useState } from "react";
import { createRoom, joinRoom, lsGet, lsSet, toast, useStore } from "../net";
import { Tile } from "./Tile";
import { openYakuWindow, YakuList } from "./YakuList";

export function Home() {
  const connected = useStore((s) => s.connected);
  const urlCode = new URL(location.href).searchParams.get("room") ?? "";
  const [name, setName] = useState<string>(lsGet("name", ""));
  const [code, setCode] = useState(urlCode.toUpperCase());
  const [busy, setBusy] = useState(false);
  const [yakuOpen, setYakuOpen] = useState(false);

  const run = async (fn: () => Promise<string | null>) => {
    if (!name.trim()) return toast("名前を入力してください", "error");
    setBusy(true);
    const err = await fn();
    setBusy(false);
    if (err) toast(err, "error");
  };
  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return toast("部屋コードを入力してください", "error");
    void run(() => joinRoom(code.trim(), name.trim()));
  };

  return (
    <div className="home">
      <div className="home-bg" />
      <div className="home-card">
        <div className="logo">
          {[..."ひらがじゃん"].map((c, i) => (
            <Tile key={i} ch={c} size="lg" className="logo-tile" style={{ animationDelay: `${i * 0.08}s` }} />
          ))}
        </div>
        <div className="logo-sub">ONLINE ─ ひらがな牌で言葉をそろえる麻雀</div>

        <label className="field">
          <span>あなたの名前</span>
          <input
            value={name}
            maxLength={12}
            placeholder="例：たろう"
            onChange={(e) => {
              setName(e.target.value);
              // 部屋に入る前でも、次に開いたときのために覚えておく（このブラウザだけ）
              lsSet("name", e.target.value.trim());
            }}
            autoFocus
          />
        </label>

        {urlCode ? (
          <form onSubmit={onJoin} className="home-actions">
            <div className="invite-note">
              部屋 <b>{code}</b> に招待されています
            </div>
            <button className="btn btn-primary btn-big" disabled={busy || !connected}>
              部屋に入る
            </button>
          </form>
        ) : (
          <>
            <div className="home-actions">
              <button className="btn btn-primary btn-big" disabled={busy || !connected} onClick={() => run(() => createRoom(name.trim()))}>
                部屋を作る
              </button>
            </div>
            <div className="divider">
              <span>または</span>
            </div>
            <form onSubmit={onJoin} className="join-row">
              <input value={code} maxLength={4} placeholder="部屋コード" onChange={(e) => setCode(e.target.value.toUpperCase())} className="code-input" />
              <button className="btn" disabled={busy || !connected}>
                参加
              </button>
            </form>
          </>
        )}

        <details className="howto">
          <summary>あそびかた（かんたん）</summary>
          <ul>
            <li>
              手牌13枚＋ツモ1枚の14枚を、<b>2文字の語×1＋3文字の語×4</b>に並べればアガリです（例：ねこ／さくら／くるま／たぬき／きつね）。
            </li>
            <li>
              <b>言葉は自分で見つけます。</b>牌をドラッグして並べ、牌と牌のすき間をクリックすると区切れます。下の入力欄に語を打つと、その牌が集まります。
            </li>
            <li>麻雀みたいにロンやツモを自動判別してくれないので、自己判断と自己申告になるよ。</li>
            <li>
              アガリを宣言すると、他の人が投票で言葉を確認します。<b>認められないとチョンボ</b>（満貫払い）です。
            </li>
            <li>
              アガるには<b>役が1つ以上</b>必要です（リーチ・ツモ・同頭など）。役は対局中の「役」ボタンで見られます。
            </li>
            <li>局の始めに並べる時間（理牌タイム）があり、全員が「理牌完了」を押すと始まります。</li>
            <li>自分で捨てた文字や、見逃した文字ではロンできません（フリテン）。ツモならアガれます。</li>
            <li>2枚の組＋捨て牌で3文字の語ができるときはポン、3枚以上の組なら4文字以上の語でカンできます。</li>
          </ul>
        </details>
        <div className="home-yaku">
          <button className="btn btn-ghost" onClick={() => setYakuOpen(true)}>
            役一覧
          </button>
        </div>
      </div>
      {yakuOpen && (
        <div className="modal-back" onClick={() => setYakuOpen(false)}>
          <div className="modal yaku-modal" onClick={(e) => e.stopPropagation()}>
            <div className="yaku-modal-head">
              <span className="result-title small">役一覧</span>
              <button className="btn btn-xs btn-ghost" onClick={() => openYakuWindow(null)}>
                別窓で開く
              </button>
              <button className="btn btn-xs btn-ghost" onClick={() => setYakuOpen(false)}>
                閉じる
              </button>
            </div>
            <div className="panel-sec yk yaku-modal-body">
              <YakuList extraTiles={null} />
            </div>
          </div>
        </div>
      )}
      <div className="home-foot">友人と遊ぶための非公式オンライン版です。辞書データ: JMdict (EDRDG, CC BY-SA 4.0)</div>
    </div>
  );
}
