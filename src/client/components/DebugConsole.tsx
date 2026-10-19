// デバッグ用のコンソール。Ctrl+Esc か Ctrl+Alt+D で開閉する（サーバーが DEBUG_COMMANDS=1 で動いているときだけコマンドが通る）
import { FormEvent, KeyboardEvent as RKeyboardEvent, useEffect, useRef, useState } from "react";
import { emit } from "../net";

interface Line {
  kind: "in" | "out" | "err";
  text: string;
}

const CSS = `
.dbg {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 95;
  width: min(560px, calc(100vw - 32px));
  border-radius: 10px;
  background: rgba(6, 12, 16, 0.96);
  border: 1px solid rgba(120, 200, 140, 0.5);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
  font: 13px/1.5 ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace;
  color: #cfe8d4;
}
.dbg-head {
  padding: 6px 10px;
  border-bottom: 1px solid rgba(120, 200, 140, 0.25);
  color: #8fc79c;
  font-size: 12px;
}
.dbg-log {
  max-height: 240px;
  overflow-y: auto;
  padding: 6px 10px;
  white-space: pre-wrap;
}
.dbg-in { color: #ffffff; }
.dbg-err { color: #ff9a8a; }
.dbg-form { display: flex; border-top: 1px solid rgba(120, 200, 140, 0.25); }
.dbg-form span { padding: 8px 0 8px 10px; color: #8fc79c; }
.dbg-form input {
  flex: 1;
  min-width: 0;
  padding: 8px 10px 8px 6px;
  border: 0;
  outline: 0;
  background: transparent;
  color: inherit;
  font: inherit;
}
`;

export default function DebugConsole() {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([{ kind: "out", text: "/help でコマンドの一覧を出します" }]);
  const [text, setText] = useState("");
  const history = useRef<string[]>([]);
  const histPos = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Windows では Ctrl+Esc をOSが取ってしまうので、Ctrl+Alt+D でも開けるようにする
      if ((e.ctrlKey && e.key === "Escape") || (e.ctrlKey && e.altKey && e.code === "KeyD")) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [lines, open]);

  if (!open) return null;

  const run = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    history.current.push(t);
    histPos.current = history.current.length;
    setText("");
    setLines((ls) => [...ls, { kind: "in", text: `> ${t}` }]);
    const res = await emit<{ lines?: string[]; error?: string }>("debug:command", { text: t });
    setLines((ls) => [...ls, ...(res.error ? [{ kind: "err" as const, text: res.error }] : (res.lines ?? []).map((text) => ({ kind: "out" as const, text })))].slice(-200));
  };

  const onInputKey = (e: RKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && !e.ctrlKey) setOpen(false);
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const h = history.current;
      histPos.current = Math.max(0, Math.min(h.length, histPos.current + (e.key === "ArrowUp" ? -1 : 1)));
      setText(h[histPos.current] ?? "");
    }
  };

  return (
    <div className="dbg">
      <style>{CSS}</style>
      <div className="dbg-head">デバッグコンソール（Esc で閉じる）</div>
      <div className="dbg-log" ref={logRef}>
        {lines.map((l, i) => (
          <div key={i} className={`dbg-${l.kind}`}>
            {l.text}
          </div>
        ))}
      </div>
      <form className="dbg-form" onSubmit={run}>
        <span>&gt;</span>
        <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onInputKey} spellCheck={false} autoComplete="off" />
      </form>
    </div>
  );
}
