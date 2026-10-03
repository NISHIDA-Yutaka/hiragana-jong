// 自分の手牌：並べ替え（ドラッグ）・区切り（すき間をクリック）・語の入力で集める・打牌
import { FormEvent, PointerEvent as RPointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Arrangement, groupIds } from "../../shared/arrange";
import { charOrder, normalizeInput, Tile as TileT } from "../../shared/tiles";
import { send, toast } from "../net";
import { shapeLabel } from "../shape";
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
  /** 離した直後の牌（CSSのtransitionを止めておき、FLIPで滑らせる） */
  const [settling, setSettling] = useState<number | null>(null);
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

  // 牌の位置を覚えておき、並びが変わったら前の位置から滑らせる（FLIP）
  const lastRects = useRef<Map<number, DOMRect>>(new Map());
  const snapshot = () => {
    const m = new Map<number, DOMRect>();
    rowRef.current?.querySelectorAll<HTMLElement>("[data-id]").forEach((el) => m.set(Number(el.dataset.id), el.getBoundingClientRect()));
    lastRects.current = m;
  };

  const commit = (next: Arrangement) => {
    if (locked) return;
    snapshot(); // ドラッグ中の位置も含めて記録してから並べ替える
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
    // 組ごとに組み直す：選んだ牌を元の組から抜き、入力済みの組の後ろに新しい組として置く
    const groups: number[][] = [];
    for (const g of groupIds(cur)) {
      const rest = g.filter((id) => !used.has(id));
      // 牌を抜かれた入力済みの組は、もう語ではないので入力済みの扱いをやめる
      if (rest.length < g.length) for (const id of rest) typedIds.current.delete(id);
      if (rest.length) groups.push(rest);
    }
    let insertAt = 0;
    groups.forEach((g, i) => {
      if (g.some((id) => typedIds.current.has(id))) insertAt = i + 1;
    });
    groups.splice(insertAt, 0, picks);
    for (const id of picks) typedIds.current.add(id);
    commit({ order: groups.flat(), breaks: groups.slice(0, -1).map((g) => g[g.length - 1]) });
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
    if (d.active) {
      setSettling(d.id);
      setTimeout(() => setSettling((x) => (x === d.id ? null : x)), 300);
    }
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

  const orderKey = cur.order.join(",") + "|" + cur.breaks.join(",");
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const prev = lastRects.current;
    const first = prev.size === 0;
    row.querySelectorAll<HTMLElement>("[data-id]").forEach((el) => {
      const id = Number(el.dataset.id);
      const r = el.getBoundingClientRect();
      const p = prev.get(id);
      if (p) {
        const dx = (p.left - r.left) / scale;
        const dy = (p.top - r.top) / scale;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" });
        }
      } else {
        // 新しく来た牌（配牌・ツモ）は上から落とす
        el.animate([{ transform: "translateY(-36px)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], {
          duration: 260,
          delay: first ? Math.random() * 120 : 0,
          easing: "ease-out",
          fill: "backwards",
        });
      }
    });
    snapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey, handKey]);

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
                      drag?.id === id || settling === id ? "no-trans" : "",
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
