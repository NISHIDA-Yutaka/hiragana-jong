import { useEffect, useState } from "react";
import { Home } from "./components/Home";
import { Lobby } from "./components/Lobby";
import { Table } from "./components/Table";
import { useStore } from "./net";

export function App() {
  const room = useStore((s) => s.room);
  const game = useStore((s) => s.game);
  const connected = useStore((s) => s.connected);
  const toast = useStore((s) => s.toast);
  const [everConnected, setEver] = useState(false);
  useEffect(() => {
    if (connected) setEver(true);
  }, [connected]);

  return (
    <>
      {!room ? <Home /> : game ? <Table /> : <Lobby />}
      {toast && (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>
          {toast.text}
        </div>
      )}
      {!connected && <div className="conn-banner">{everConnected ? "再接続しています…" : "サーバーに接続しています…"}</div>}
    </>
  );
}
