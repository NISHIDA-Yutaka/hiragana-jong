// 供養：局の終わりに、手牌に好きな牌を2枚まで足した完成形をみんなに見せる（点数には関係しない）
import { FormEvent, useState, useSyncExternalStore } from "react";
import { checkKuyou, KUYOU_EXTRA } from "../../shared/kuyou";
import type { GameView, KuyouPost } from "../../shared/protocol";
import { emit, lsGet, lsSet, toast } from "../net";
import { Tile } from "./Tile";

// ---------------------------------------------------------------- 各自の設定（いつでもOFFにできる）

let kuyouOn = lsGet("kuyou", true);
const listeners = new Set<() => void>();

export function setKuyouPref(v: boolean) {
  kuyouOn = v;
  lsSet("kuyou", v);
  listeners.forEach((f) => f());
}

/** 供養モードがONか。OFFなら供養ボタンも、他の人の供養も出さない */
export function useKuyouPref() {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => kuyouOn,
  );
}

// ---------------------------------------------------------------- 表示

/** 供養の完成形。足した牌は印をつける */
export function KuyouHand({ post, size = "sm" }: { post: KuyouPost; size?: "xs" | "sm" }) {
  // 足した文字は、後ろから見て最初に出てくるものに印をつける
  const marks = new Set<string>();
  const left = [...post.extra];
  for (let gi = post.groups.length - 1; gi >= 0 && left.length; gi--) {
    const chars = [...post.groups[gi]];
    for (let ci = chars.length - 1; ci >= 0 && left.length; ci--) {
      const k = left.indexOf(chars[ci]);
      if (k >= 0) {
        marks.add(`${gi}:${ci}`);
        left.splice(k, 1);
      }
    }
  }
  return (
    <div className="kuyou-hand">
      {post.groups.map((w, gi) => (
        <span key={gi} className="kuyou-group">
          {[...w].map((ch, ci) => (
            <Tile key={ci} ch={ch} size={size} className={marks.has(`${gi}:${ci}`) ? "kuyou-extra" : ""} />
          ))}
        </span>
      ))}
      {post.melds.map((w, i) => (
        <span key={`m${i}`} className="kuyou-group kuyou-meld">
          {[...w].map((ch, ci) => (
            <Tile key={ci} ch={ch} size={size} />
          ))}
        </span>
      ))}
    </div>
  );
}

/** 結果画面に出す、この局の供養の一覧 */
export function KuyouList({ posts }: { posts: { id: number; name: string; kuyou: KuyouPost }[] }) {
  if (!posts.length) return null;
  return (
    <div className="kuyou-list">
      {posts.map((p) => (
        <div key={p.id} className="kuyou-card">
          <div className="kuyou-who">
            🙏 {p.name}の供養<small>（光っている牌が足した牌）</small>
          </div>
          <KuyouHand post={p.kuyou} />
          <div className="kuyou-words">{[...p.kuyou.groups, ...p.kuyou.melds].join("・")}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- 入力

export function KuyouDialog({ g, hand, onClose }: { g: GameView; hand: number; onClose: () => void }) {
  const [text, setText] = useState("");
  const chars = g.myHand.map((t) => t.ch);
  const melds = g.mySeat !== null ? g.seats[g.mySeat].melds.map((m) => m.word) : [];
  const res = checkKuyou(chars, text);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (res.error) return;
    const r = await emit("game:kuyou", { text });
    if (r.error) toast(r.error, "error");
    else onClose();
  };
  return (
    <div className="modal-back kuyou-back">
      <form className="modal declare kuyou-modal" onSubmit={submit}>
        <div className="result-title small">🙏 供養</div>
        <p className="declare-lead">
          手牌に好きな牌を{KUYOU_EXTRA}枚まで足して、完成形をみんなに見せます（点数には関係しません）。
          <br />
          語は空白で区切って入力してください。作文ならそのまま1文で。
        </p>
        <div className="kuyou-mine">
          {chars.map((ch, i) => (
            <Tile key={i} ch={ch} size="sm" />
          ))}
          {melds.length > 0 && <span className="kuyou-meld-note">鳴き：{melds.join("・")}</span>}
        </div>
        <input className="kuyou-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="例：たぬき きつね さくら くるま ねこ" autoFocus maxLength={60} />
        {text.trim() && (res.error ? <p className="kuyou-err">{res.error}</p> : <KuyouHand post={{ hand, groups: res.groups, melds, extra: res.extra }} />)}
        <div className="modal-foot gap">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            やめる
          </button>
          <button className="btn btn-primary" disabled={!!res.error}>
            供養する
          </button>
        </div>
      </form>
    </div>
  );
}
