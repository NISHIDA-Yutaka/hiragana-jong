import { createRoot } from "react-dom/client";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

// /yaku は別窓の役一覧。対局サーバーにつながないよう、ゲーム本体（App）は読み込まない
if (location.pathname === "/yaku") {
  void import("./YakuPage").then(({ YakuPage }) => root.render(<YakuPage />));
} else if (import.meta.env.DEV && location.pathname === "/sounds") {
  // 開発中だけの効果音の試聴ページ
  void import("./SoundTest").then(({ SoundTest }) => root.render(<SoundTest />));
} else {
  void import("./App").then(({ App }) => root.render(<App />));
}
