// 別窓で開く役一覧のページ（/yaku）。対局サーバーにはつながない
import { YakuList } from "./components/YakuList";

export function YakuPage() {
  const extra = new URL(location.href).searchParams.get("extra");
  const extraTiles = extra === "1" ? true : extra === "0" ? false : null;
  document.title = "役一覧 - ひらがじゃん";
  return (
    <div className="yaku-page">
      <h1 className="yaku-page-title">ひらがじゃん 役一覧</h1>
      <div className="panel-sec yk">
        <YakuList extraTiles={extraTiles} />
      </div>
    </div>
  );
}
