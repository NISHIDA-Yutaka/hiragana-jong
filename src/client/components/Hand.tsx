// 自分の手牌：並べ替え（ドラッグ）・区切り（すき間をクリック）・語の入力で集める・打牌
import { FormEvent, PointerEvent as RPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { Arrangement, groupIds } from "../../shared/arrange";
import { charOrder, normalizeInput, Tile as TileT } from "../../shared/tiles";
import { send, toast } from "../net";
import { Tile } from "./Tile";

interface Props {
  hand: TileT[];
  serverArr: Arrangement | null;
  drawnId: number | null;
  locked: boolean;
  /** クリックで打牌できる牌（null=打牌できない） */
  discardable: Set<number> | null;
  highlight: Set<number> | null;
  oneClick: boolean;
  onDiscard: (id: number) => void;
  scale: number;
  meldCount: number;
}

function withoutId(arr: Arrangement, id: number): Arrangement {
  const i = arr.order.indexOf(id);
  if (i < 0) return arr;
  const order = arr.order.filter((x) => x !== id);
  const breaks = new Set(arr.breaks.filter((x) => x !== id));
  if (arr.breaks.includes(id) && i > 0) breaks.add(arr.order[i - 1]);
  if (order.length) breaks.delete(order[order.length - 1]);
  return { order, breaks: [...breaks] };
}

export function Hand({ hand, serverArr, drawnId, locked, discardable, highlight, oneClick, onDiscard, scale, meldCount }: Props) {
  const handKey = useMemo(
    () =>
      hand
        .map((t) => t.id)
        .sort((a, b) => a - b)
        .join(","),
    [hand],
  );
  const [arr, setArr] = useState<Arrangement>(serverArr ?? { order: hand.map((t) => t.id), breaks: [] });
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ id: number; x0: number; y0: number; dx: number; dy: number; active: boolean } | null>(null);
  const [typed, setTyped] = useState("");
  const typedIds = useRef<Set<number>>(new Set());
  const rowRef = useRef<HTMLDivElement>(null);

  // 手牌が変わったらサーバーの並び（前回送った並びを元に直したもの）を採用
  useEffect(() => {
    if (serverArr) setArr(serverArr);
    setSelected(null);
    const ids = new Set(hand.map((t) => t.id));
    for (const id of [...typedIds.current]) if (!ids.has(id)) typedIds.current.delete(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handKey]);
  useEffect(() => {
    if (locked && serverArr) setArr(serverArr);
  }, [locked, serverArr]);

  const byId = useMemo(() => new Map(hand.map((t) => [t.id, t])), [hand]);
  const valid = arr.order.length === hand.length && arr.order.every((id) => byId.has(id));
  const cur: Arrangement = valid ? arr : (serverArr ?? { order: hand.map((t) => t.id), breaks: [] });

  const commit = (next: Arrangement) => {
    if (locked) return;
    setArr(next);
    send("game:arrange", next);
  };

  const toggleBreak = (id: number) => {
    const br = new Set(cur.breaks);
    if (br.has(id)) br.delete(id);
    else br.add(id);
    commit({ order: cur.order, breaks: [...br] });
  };

  const resetSort = () => {
    typedIds.current.clear();
    const order = [...hand].sort((a, b) => charOrder(a.ch) - charOrder(b.ch) || a.id - b.id).map((t) => t.id);
    commit({ order, breaks: [] });
  };

  const splitAll = () => {
    commit({ order: cur.order, breaks: cur.order.slice(0, -1) });
  };

  /** 入力した語の牌を集めて、左から順に1つの組にする */
  const gather = (e: FormEvent) => {
    e.preventDefault();
    const w = normalizeInput(typed);
    if (!w) return;
    if (locked) return toast("リーチ中は並べ替えできません", "error");
    const chars = [...w];
    const used = new Set<number>();
    const picks: number[] = [];
    // 既に入力で作った組の牌は後回しにする
    const pref = [...cur.order].reverse().sort((a, b) => Number(typedIds.current.has(a)) - Number(typedIds.current.has(b)));
    for (const ch of chars) {
      const id = pref.find((x) => !used.has(x) && byId.get(x)?.ch === ch);
      if (id === undefined) {
        toast(`「${ch}」の牌が足りません`, "error");
        return;
      }
      used.add(id);
      picks.push(id);
    }
    let base = cur;
    for (const id of picks) base = withoutId(base, id);
    // 入力済みの組の後ろに置く
    let insertAt = 0;
    base.order.forEach((id, i) => {
      if (typedIds.current.has(id) && !used.has(id)) insertAt = i + 1;
    });
    const order = [...base.order.slice(0, insertAt), ...picks, ...base.order.slice(insertAt)];
    const breaks = new Set(base.breaks);
    if (insertAt > 0) breaks.add(base.order[insertAt - 1]);
    if (insertAt < base.order.length) breaks.add(picks[picks.length - 1]);
    for (const id of picks) typedIds.current.add(id);
    commit({ order, breaks: [...breaks] });
    setTyped("");
  };

  // ---------------------------------------------------------------- ドラッグ
  const onDown = (e: RPointerEvent<HTMLDivElement>, id: number) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, active: false });
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    const active = drag.active || (!locked && Math.hypot(dx, dy) > 7);
    setDrag({ ...drag, dx, dy, active });
  };
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (!d.active) {
      clickTile(d.id);
      return;
    }
    // 手牌から大きく上に離したら打牌
    if (d.dy < -120 * scale && discardable?.has(d.id)) {
      onDiscard(d.id);
      return;
    }
    dropAt(d.id, e.clientX);
  };

  const clickTile = (id: number) => {
    if (!discardable) {
      setSelected(selected === id ? null : id);
      return;
    }
    if (!discardable.has(id)) return;
    if (oneClick || selected === id) {
      setSelected(null);
      onDiscard(id);
    } else setSelected(id);
  };

  const dropAt = (id: number, x: number) => {
    const row = rowRef.current;
    if (!row) return;
    const els = [...row.querySelectorAll<HTMLElement>("[data-id]")].filter((el) => Number(el.dataset.id) !== id);
    const rects = els.map((el) => ({ id: Number(el.dataset.id), r: el.getBoundingClientRect() }));
    let slot = rects.findIndex((q) => q.r.left + q.r.width / 2 > x);
    if (slot < 0) slot = rects.length;
    const left = rects[slot - 1];
    const right = rects[slot];
    let base = withoutId(cur, id);
    const order = [...base.order];
    const insertIdx = left ? order.indexOf(left.id) + 1 : 0;
    order.splice(insertIdx, 0, id);
    const breaks = new Set(base.breaks);
    if (left && right) {
      const gapBreak = breaks.has(left.id);
      if (gapBreak) {
        const gs = left.r.right;
        const ge = right.r.left;
        const t = (x - gs) / Math.max(1, ge - gs);
        if (t < 0.3) {
          breaks.delete(left.id);
          breaks.add(id);
        } else if (t <= 0.7) {
          breaks.add(id);
        }
      }
    } else if (left && !right) {
      // 末尾：最後の組に付けるか、少し離せば新しい組
      if (x > left.r.right + 16 * scale) breaks.add(left.id);
    } else if (!left && right) {
      if (x < right.r.left - 16 * scale) breaks.add(id);
    }
    base = { order, breaks: [...breaks].filter((b) => b !== order[order.length - 1]) };
    commit(base);
  };

  const groups = groupIds(cur);
  const lastGroup = groups[groups.length - 1];
  const shape = shapeLabel(groups.map((x) => x.length), meldCount);
  const drawnAlone = drawnId !== null && lastGroup?.length === 1 && lastGroup[0] === drawnId;

  return (
    <div className="my-hand-wrap">
      <div className={`my-hand ${locked ? "locked" : ""}`} ref={rowRef} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}>
        {groups.map((g, gi) => (
          <div key={gi} className={`hgroup ${g.length >= 2 && g.length <= 8 ? "hgroup-word" : ""} ${drawnAlone && gi === groups.length - 1 ? "hgroup-drawn" : ""}`}>
            {g.map((id, i) => {
              const t = byId.get(id);
              if (!t) return null;
              const isDrag = drag?.active && drag.id === id;
              const dim = discardable && !discardable.has(id);
              return (
                <div key={id} className="htile-slot">
                  <Tile
                    ch={t.ch}
                    size="xl"
                    dataId={id}
                    className={[
                      "htile",
                      selected === id ? "selected" : "",
                      isDrag ? "dragging" : "",
                      dim ? "dim" : "",
                      highlight?.has(id) ? "hl" : "",
                      id === drawnId ? "drawn" : "",
                    ].join(" ")}
                    style={isDrag ? { transform: `translate(${drag!.dx / scale}px, ${drag!.dy / scale}px)` } : undefined}
                    onPointerDown={(e) => onDown(e, id)}
                  />
                  {!locked && (i < g.length - 1 || gi < groups.length - 1) && (
                    <button
                      className={`seam ${i === g.length - 1 ? "seam-open" : ""}`}
                      title={i === g.length - 1 ? "つなげる" : "ここで区切る"}
                      onClick={() => toggleBreak(id)}
                      tabIndex={-1}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="hand-tools">
        <span className={`shape ${shape.cls}`} title="区切った語の文字数（言葉として正しいかは判定しません）">
          {shape.text}
        </span>
        <form onSubmit={gather} className="gather">
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="語を入力 → Enterで牌を集める" disabled={locked} />
        </form>
        <button className="btn btn-xs btn-ghost" onClick={splitAll} disabled={locked} title="全ての牌を1枚ずつに区切る">
          全部区切る
        </button>
        <button className="btn btn-xs btn-ghost" onClick={resetSort} disabled={locked} title="五十音順に並べ直す（区切りも消えます）">
          リセット
        </button>
      </div>
    </div>
  );
}

/** 区切りの形（文字数の並び）だけを見た目で知らせる。辞書の判定はしない */
function shapeLabel(lens: number[], meldCount: number): { text: string; cls: string } {
  const total = lens.reduce((a, b) => a + b, 0);
  const need3 = 4 - meldCount;
  const twos = lens.filter((l) => l === 2).length;
  const threes = lens.filter((l) => l === 3).length;
  const text = lens.join("・");
  const full = 2 + 3 * need3;
  if (total === full) {
    if ((twos === 1 && threes === need3 && lens.length === need3 + 1) || (meldCount === 0 && twos === 7 && lens.length === 7)) return { text: `${text}　アガリの形`, cls: "shape-win" };
    // ツモ牌を別にしている場合：残りがテンパイの形か
    if (lens[lens.length - 1] === 1 && lens.length > 1) {
      const r = shapeLabel(lens.slice(0, -1), meldCount);
      if (r.cls === "shape-tenpai") return { text: `${text}　テンパイの形＋1枚`, cls: "shape-tenpai" };
    }
  }
  if (total === full - 1) {
    const ones = lens.filter((l) => l === 1).length;
    const groupsOk = lens.length === need3 + 1;
    // 2・3・3・3・2（3文字の語が1枚足りない）／3・3・3・3・1（頭が1枚足りない）／七対子の1枚足りない形
    const tenpai = (groupsOk && twos === 2 && threes === need3 - 1) || (groupsOk && threes === need3 && ones === 1) || (meldCount === 0 && lens.length === 7 && twos === 6 && ones === 1);
    if (tenpai) return { text: `${text}　テンパイの形`, cls: "shape-tenpai" };
  }
  return { text: lens.length > 1 ? text : "語ごとに区切りましょう", cls: "" };
}
