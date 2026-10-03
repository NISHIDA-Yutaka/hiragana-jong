// サーバーとの接続と、画面で使う状態の保管
import { useSyncExternalStore } from "react";
import { io, Socket } from "socket.io-client";
import type { GameView, RoomView } from "../shared/protocol";

export const socket: Socket = io({ transports: ["websocket", "polling"] });

export interface Session {
  code: string;
  token: string;
  id: string;
  name: string;
}

interface State {
  connected: boolean;
  room: RoomView | null;
  game: GameView | null;
  session: Session | null;
  toast: { id: number; text: string; kind: "info" | "error" } | null;
}

let state: State = { connected: false, room: null, game: null, session: null, toast: null };
const listeners = new Set<() => void>();
function set(p: Partial<State>) {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sel(state),
  );
}
export const getState = () => state;

// ?as=名前 を付けると保存先を分けられる（同じPCで複数人を試すとき用）
const AS = new URL(location.href).searchParams.get("as");
const LS = "hiragajong:" + (AS ? AS + ":" : "");
function loadSession(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(LS + "session") || "null");
    return s && s.code && s.token ? s : null;
  } catch {
    return null;
  }
}
function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(LS + "session", JSON.stringify(s));
    else localStorage.removeItem(LS + "session");
  } catch {
    /* 保存できなくても続行 */
  }
}

export function lsGet<T>(key: string, def: T): T {
  try {
    const v = localStorage.getItem(LS + key);
    return v === null ? def : (JSON.parse(v) as T);
  } catch {
    return def;
  }
}
export function lsSet(key: string, v: unknown) {
  try {
    localStorage.setItem(LS + key, JSON.stringify(v));
  } catch {
    /* 無視 */
  }
}

state.session = loadSession();

let toastSeq = 0;
export function toast(text: string, kind: "info" | "error" = "info") {
  const id = ++toastSeq;
  set({ toast: { id, text, kind } });
  setTimeout(() => {
    if (state.toast?.id === id) set({ toast: null });
  }, 3200);
}

export function emit<T = { error?: string }>(event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, payload ?? {}, (err: unknown, res: T) => {
      if (err) resolve({ error: "サーバーが応答しません" } as T);
      else resolve(res);
    });
  });
}

export function send(event: string, payload?: unknown) {
  socket.emit(event, payload ?? {});
}

type JoinRes = { error?: string; code?: string; token?: string; id?: string };

function afterJoin(res: JoinRes, name: string): string | null {
  if (res.error || !res.code || !res.token || !res.id) return res.error ?? "参加できませんでした";
  const s = { code: res.code, token: res.token, id: res.id, name };
  saveSession(s);
  set({ session: s });
  const url = new URL(location.href);
  url.searchParams.set("room", res.code);
  history.replaceState(null, "", url.toString());
  pushMyWords();
  return null;
}

export async function createRoom(name: string) {
  lsSet("name", name);
  return afterJoin(await emit<JoinRes>("room:create", { name }), name);
}

export async function joinRoom(code: string, name: string) {
  lsSet("name", name);
  const prev = state.session;
  const token = prev && prev.code === code.toUpperCase() ? prev.token : undefined;
  return afterJoin(await emit<JoinRes>("room:join", { code, name, token }), name);
}

export function leaveRoom() {
  send("room:leave");
  saveSession(null);
  set({ session: null, room: null, game: null });
  const url = new URL(location.href);
  url.searchParams.delete("room");
  history.replaceState(null, "", url.toString());
}

// マイ単語（端末に保存し、部屋に入るたびに送る）
export function getMyWords(): string[] {
  return lsGet<string[]>("mywords", []);
}
export async function setMyWords(words: string[]) {
  const res = await emit<{ words: string[] }>("player:myWords", { words });
  const w = res.words ?? words;
  lsSet("mywords", w);
  return w;
}
function pushMyWords() {
  const w = getMyWords();
  if (w.length) send("player:myWords", { words: w });
}

socket.on("connect", async () => {
  set({ connected: true });
  const s = state.session;
  const urlCode = new URL(location.href).searchParams.get("room");
  if (s && (!urlCode || urlCode.toUpperCase() === s.code)) {
    const res = await emit<JoinRes>("room:join", { code: s.code, token: s.token, name: s.name });
    if (res.error) {
      saveSession(null);
      set({ session: null, room: null, game: null });
    } else pushMyWords();
  }
});
socket.on("disconnect", () => set({ connected: false }));
socket.on("room:state", (room: RoomView) => set({ room }));
socket.on("game:state", (game: GameView | null) => set({ game }));
socket.on("room:kicked", () => {
  leaveRoom();
  toast("部屋から退出しました", "error");
});
