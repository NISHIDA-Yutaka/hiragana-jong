// チャットの発言を卓の上に右から左へ流す（名前＋発言）
import { useEffect, useRef, useState } from "react";
import { useStore } from "../net";
import { useKuyouPref } from "./Kuyou";

const LANES = 6;
const DURATION = 8000;
/** 同じ段に次の発言を流し始めるまでの間隔（前の発言と重ならないように） */
const LANE_GAP = 2600;

interface Flow {
  id: number;
  lane: number;
  delay: number;
  name: string;
  text: string;
}

export function ChatFlow() {
  const chat = useStore((s) => s.room?.chat ?? []);
  const kuyouOn = useKuyouPref();
  const [flows, setFlows] = useState<Flow[]>([]);
  // 画面を開く前の発言は流さない
  const seen = useRef(chat.length ? chat[chat.length - 1].id : 0);
  /** 各段が次に空く時刻 */
  const laneFree = useRef<number[]>(Array(LANES).fill(0));
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    const fresh = chat.filter((m) => m.id > seen.current && !m.system && (kuyouOn || !m.kuyou));
    if (chat.length) seen.current = Math.max(seen.current, chat[chat.length - 1].id);
    if (!fresh.length) return;
    const now = Date.now();
    const free = laneFree.current;
    const add: Flow[] = fresh.map((m) => {
      // 空いている段のうち一番上、なければ一番早く空く段で順番を待つ
      let lane = free.findIndex((t) => t <= now);
      if (lane < 0) lane = free.indexOf(Math.min(...free));
      const start = Math.max(now, free[lane]);
      free[lane] = start + LANE_GAP;
      return { id: m.id, lane, delay: start - now, name: m.kuyou ? `🙏 ${m.name}の供養` : m.name, text: m.text };
    });
    setFlows((f) => [...f, ...add]);
    for (const x of add) {
      timers.current.push(window.setTimeout(() => setFlows((f) => f.filter((y) => y.id !== x.id)), x.delay + DURATION + 200));
    }
  }, [chat]);

  return (
    <div className="chat-flow">
      {flows.map((f) => (
        <div key={f.id} className="cf-item" style={{ top: 64 + f.lane * 46, animationDelay: `${f.delay}ms`, animationDuration: `${DURATION}ms` }}>
          <b>{f.name}</b>
          {f.text}
        </div>
      ))}
    </div>
  );
}
