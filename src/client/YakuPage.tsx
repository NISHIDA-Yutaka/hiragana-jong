// 別窓で開く役一覧のページ（/yaku）。対局サーバーにはつながない
import { YakuList } from "./components/YakuList";

export function YakuPage() {
  const params = new URL(location.href).searchParams;
  const flag = (name: string) => (params.get(name) === "1" ? true : params.get(name) === "0" ? false : null);
  const extraTiles = flag("extra");
  const chiitoi = flag("chiitoi");
  document.title = "役一覧 - ひらがじゃん";
  return (
    <div className="yaku-page">
      <div className="yaku-page-inner">
        <h1 className="yaku-page-title">ひらがじゃん 役一覧</h1>
        <div className="panel-sec yk">
          <YakuList extraTiles={extraTiles} chiitoi={chiitoi} />
        </div>
      </div>
    </div>
  );
}
