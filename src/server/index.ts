// HTTP + Socket.IO サーバー
import express from "express";
import { createServer } from "http";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Server, Socket } from "socket.io";
import type { Arrangement } from "../shared/arrange";
import type { BotLevel, GameAction, RoomSettings } from "../shared/protocol";
import { readAgariLog } from "./agariLog";
import { getWordList, getBaseLexicon } from "./dict";
import { Member, Room } from "./room";

const portArg = process.argv.indexOf("--port");
const PORT = Number(portArg > 0 ? process.argv[portArg + 1] : (process.env.PORT ?? 3001));
const app = express();
const http = createServer(app);
const io = new Server(http, { cors: { origin: true } });

const rooms = new Map<string, Room>();
/** socket.id → どの部屋の誰か */
const sessions = new Map<string, { room: Room; member: Member }>();

const roomIO = {
  broadcast(room: Room) {
    for (const m of room.members) {
      if (m.isBot) continue;
      const rv = room.view(m.id);
      const gv = room.gameView(m);
      for (const sid of m.sockets) {
        io.to(sid).emit("room:state", rv);
        io.to(sid).emit("game:state", gv);
      }
    }
  },
};

function newCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (;;) {
    let c = "";
    for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)];
    if (!rooms.has(c)) return c;
  }
}

function cleanName(raw: unknown): string | null {
  const s = String(raw ?? "")
    .replace(/[\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 12);
  return s || null;
}

function attach(socket: Socket, room: Room, member: Member) {
  const prev = sessions.get(socket.id);
  if (prev && (prev.room !== room || prev.member !== member)) detach(socket);
  member.sockets.add(socket.id);
  sessions.set(socket.id, { room, member });
  socket.join(room.code);
  room.lastActive = Date.now();
  room.setConnected(member);
  room.fixHost();
  roomIO.broadcast(room);
}

function detach(socket: Socket, leaving = false) {
  const s = sessions.get(socket.id);
  if (!s) return;
  sessions.delete(socket.id);
  socket.leave(s.room.code);
  s.member.sockets.delete(socket.id);
  s.room.setConnected(s.member);
  if (leaving && s.member.sockets.size === 0) s.room.removeMember(s.member.id);
  s.room.fixHost();
  roomIO.broadcast(s.room);
}

type Ack = (r: unknown) => void;
const safeAck = (ack: unknown): Ack => (typeof ack === "function" ? (ack as Ack) : () => {});

io.on("connection", (socket) => {
  const ctx = () => sessions.get(socket.id);
  const hostOnly = (fn: (room: Room, m: Member) => void) => {
    const s = ctx();
    if (!s) return;
    if (s.room.hostId !== s.member.id) return;
    fn(s.room, s.member);
    roomIO.broadcast(s.room);
  };

  socket.on("room:create", (p: { name?: string }, ack) => {
    const reply = safeAck(ack);
    const name = cleanName(p?.name);
    if (!name) return reply({ error: "名前を入力してください" });
    const room = new Room(newCode(), roomIO);
    rooms.set(room.code, room);
    const m = room.addHuman(name);
    attach(socket, room, m);
    reply({ code: room.code, token: m.token, id: m.id });
  });

  socket.on("room:join", (p: { code?: string; name?: string; token?: string }, ack) => {
    const reply = safeAck(ack);
    const code = String(p?.code ?? "")
      .toUpperCase()
      .trim();
    const room = rooms.get(code);
    if (!room) return reply({ error: "部屋が見つかりません" });
    let m = p?.token ? room.memberByToken(p.token) : undefined;
    if (!m) {
      const name = cleanName(p?.name);
      if (!name) return reply({ error: "名前を入力してください" });
      if (room.members.some((x) => x.name === name && !x.isBot)) return reply({ error: "同じ名前の人がいます" });
      if (room.humanCount >= 12) return reply({ error: "部屋がいっぱいです" });
      m = room.addHuman(name);
    }
    attach(socket, room, m);
    reply({ code: room.code, token: m.token, id: m.id });
  });

  socket.on("room:leave", () => detach(socket, true));

  socket.on("room:rename", (p: { name?: string }) => {
    const s = ctx();
    const name = cleanName(p?.name);
    if (!s || !name || s.room.game) return;
    if (s.room.members.some((x) => x.name === name && x !== s.member)) return;
    s.member.name = name;
    roomIO.broadcast(s.room);
  });

  socket.on("room:settings", (p: Partial<RoomSettings>) => hostOnly((room) => room.updateSettings(p ?? {})));
  socket.on("room:addBot", (p: { level?: BotLevel }) =>
    hostOnly((room) => {
      const level = (["weak", "normal", "strong"] as const).includes(p?.level as BotLevel) ? (p.level as BotLevel) : "normal";
      room.addBot(level);
    }),
  );
  socket.on("room:fillBots", (p: { level?: BotLevel }) =>
    hostOnly((room) => {
      const level = (["weak", "normal", "strong"] as const).includes(p?.level as BotLevel) ? (p.level as BotLevel) : "normal";
      room.fillBots(level);
    }),
  );
  socket.on("room:removeMember", (p: { id?: string }) =>
    hostOnly((room, me) => {
      const target = room.member(String(p?.id));
      if (!target || target.id === me.id) return;
      if (!target.isBot) for (const sid of target.sockets) io.to(sid).emit("room:kicked");
      for (const sid of [...target.sockets]) {
        const sock = io.sockets.sockets.get(sid);
        if (sock) detach(sock);
      }
      room.removeMember(target.id);
    }),
  );
  socket.on("room:transferHost", (p: { id?: string }) =>
    hostOnly((room) => {
      const t = room.member(String(p?.id));
      if (t && !t.isBot) room.hostId = t.id;
    }),
  );
  socket.on("room:start", (_p, ack) => {
    const reply = safeAck(ack);
    const s = ctx();
    if (!s) return reply({ error: "部屋に入っていません" });
    if (s.room.hostId !== s.member.id) return reply({ error: "ホストだけが開始できます" });
    const err = s.room.start();
    roomIO.broadcast(s.room);
    reply(err ? { error: err } : { ok: true });
  });
  socket.on("room:backToLobby", () => hostOnly((room) => room.backToLobby()));
  socket.on("room:abort", () => hostOnly((room) => room.abortGame()));

  socket.on("room:chat", (p: { text?: string }) => {
    const s = ctx();
    if (!s) return;
    s.room.say(s.member, String(p?.text ?? ""));
    roomIO.broadcast(s.room);
  });

  socket.on("spectate:watch", (p: { seat?: number }) => {
    const s = ctx();
    if (!s || !s.room.game) return;
    s.room.watch(s.member, Number(p?.seat));
    socket.emit("game:state", s.room.gameView(s.member));
  });
  socket.on("game:kuyouStart", () => ctx()?.room.kuyouStart(ctx()!.member));
  socket.on("game:kuyou", (p: { text?: string }, ack) => {
    const reply = safeAck(ack);
    const s = ctx();
    if (!s) return reply({ error: "部屋に入っていません" });
    const err = s.room.kuyou(s.member, String(p?.text ?? ""));
    if (!err) roomIO.broadcast(s.room);
    reply(err ? { error: err } : { ok: true });
  });

  socket.on("room:addWord", (p: { word?: string }, ack) => {
    const reply = safeAck(ack);
    const s = ctx();
    if (!s) return reply({ error: "部屋に入っていません" });
    const w = s.room.normalizeWord(String(p?.word ?? ""));
    if (!w) return reply({ error: "その語は牌で作れません" });
    s.room.addRoomWord(w, s.member.name);
    roomIO.broadcast(s.room);
    reply({ ok: true, word: w });
  });
  socket.on("room:removeWord", (p: { word?: string }) => hostOnly((room) => room.removeRoomWord(String(p?.word ?? ""))));

  socket.on("dict:lookup", (p: { word?: string }, ack) => {
    const reply = safeAck(ack);
    const s = ctx();
    if (!s) return reply(null);
    reply(s.room.lookupWord(String(p?.word ?? "")));
  });

  socket.on("player:myWords", (p: { words?: string[] }, ack) => {
    const reply = safeAck(ack);
    const s = ctx();
    if (!s || !Array.isArray(p?.words)) return reply({ words: [] });
    const words = s.room.setMyWords(s.member, p.words);
    reply({ words });
    roomIO.broadcast(s.room);
  });

  socket.on("player:theme", (p: { theme?: { name: string; pure: boolean } | null }) => {
    const s = ctx();
    if (!s) return;
    s.room.setTheme(s.member, p?.theme ?? null);
    roomIO.broadcast(s.room);
  });

  socket.on("game:action", (a: GameAction, ack) => {
    const reply = safeAck(ack);
    const s = ctx();
    if (!s) return reply({ error: "部屋に入っていません" });
    let err: string | null;
    try {
      err = s.room.gameAction(s.member, a);
    } catch (e) {
      console.error("[action]", e);
      err = "エラーが発生しました";
    }
    roomIO.broadcast(s.room);
    reply(err ? { error: err } : { ok: true });
  });

  socket.on("game:arrange", (arr: Arrangement) => {
    const s = ctx();
    if (!s) return;
    try {
      s.room.arrange(s.member, arr);
    } catch (e) {
      console.error("[arrange]", e);
    }
    // 自分にだけ送り直す（ボタンの状態が変わるため）。観戦者にも送り、理牌や並べ替えをその場で見せる
    if (s.room.game) {
      socket.emit("game:state", s.room.gameView(s.member));
      for (const m of s.room.members) {
        if (m.isBot || s.room.seatedIds.includes(m.id)) continue;
        const v = s.room.gameView(m);
        for (const sid of m.sockets) io.to(sid).emit("game:state", v);
      }
    }
  });

  socket.on("disconnect", () => detach(socket));
});

// 誰もいない部屋を片付ける
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.connectedHumans === 0 && now - room.lastActive > 30 * 60 * 1000) {
      room.game?.destroy();
      rooms.delete(code);
    } else if (room.connectedHumans > 0) room.lastActive = now;
  }
}, 60 * 1000);

app.get("/healthz", (_req, res) => res.send("ok"));

// リリースしてよいかの確認用：進行中の対局とつながっている人の数だけを返す（名前などは出さない）
app.get("/api/status", (_req, res) => {
  let activeGames = 0;
  let players = 0;
  for (const room of rooms.values()) {
    players += room.connectedHumans;
    if (room.game && !room.game.isOver && room.connectedHumans > 0) activeGames++;
  }
  res.json({ activeGames, players, rooms: rooms.size, safeToRelease: activeGames === 0 });
});

// アガリの記録のダウンロード。LOG_KEY を設定したときは ?key= が必要、未設定ならこのPCからだけ
app.get("/api/agari-log", (req, res) => {
  const key = process.env.LOG_KEY;
  const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "");
  if (key ? req.query.key !== key : !local) {
    res.status(403).send("forbidden");
    return;
  }
  res.type("application/x-ndjson").attachment("agari.jsonl").send(readAgariLog());
});

// 本番ではビルドしたクライアントを配信
const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = [path.join(here, "public"), path.join(here, "../../dist/public")].find((p) => existsSync(path.join(p, "index.html")));
if (publicDir) {
  app.use(express.static(publicDir));
  app.get(/^\/(?!socket\.io).*/, (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
}

// 辞書を先に読み込んでおく
getWordList();
getBaseLexicon({ level: "full", seion: false, extraTiles: false });

http.listen(PORT, () => {
  console.log(`ひらがじゃん server listening on http://localhost:${PORT}${publicDir ? "" : " (client: run `npm run dev:client`)"}`);
});
