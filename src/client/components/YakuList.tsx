// 役一覧（翻数ごとのカードと牌の見本）。対局サーバーにつながない別窓のページでも使う
import { Tile } from "./Tile";

interface YakuInfo {
  name: string;
  han: string;
  /** 門前・一巡目などのときの翻数 */
  sub?: string;
  desc: string;
  /** 見本。語は「・」、しりとりは「→」で区切り、[ ] で囲んだ文字を目立たせる */
  ex?: string;
}

const YAKU_GROUPS: { title: string; items: YakuInfo[] }[] = [
  {
    title: "1翻",
    items: [
      { name: "門前清自摸和", han: "1翻", desc: "鳴かずにツモでアガる" },
      { name: "立直", han: "1翻", sub: "一巡目 2翻", desc: "門前でテンパイを宣言。以後は手牌を変えられない" },
      { name: "一発", han: "1翻", desc: "リーチ後1巡以内にアガる" },
      { name: "清文", han: "1翻", sub: "門前 2翻", desc: "特殊文字（濁音・ー など）を1枚も使わない", ex: "あい・しんり・さかな・おやつ・はさみ" },
      { name: "同頭", han: "1翻", sub: "門前 2翻", desc: "語頭が同じ語が2つ", ex: "[さ]くら・[さ]かな" },
      { name: "同尾", han: "1翻", sub: "門前 2翻", desc: "語尾が同じ語が2つ", ex: "たぬ[き]・ゆう[き]" },
      { name: "回文", han: "1翻", sub: "1語につき", desc: "前から読んでも後ろから読んでも同じ語", ex: "[とまと]" },
      { name: "三槓子", han: "1翻", sub: "暗カン 3翻", desc: "カン（4文字以上の語）が3つ", ex: "さくせん・とういつ・ほうこく" },
    ],
  },
  {
    title: "2翻",
    items: [
      { name: "二連", han: "2翻", sub: "門前 3翻", desc: "頭以外の2語がしりとり", ex: "から[す]→[す]いか" },
      { name: "五音", han: "2翻", sub: "門前 4翻", desc: "5語の頭文字の母音が あ・い・う・え・お", ex: "[あ]い・[き]んか・[す]いか・[て]んき・[お]かゆ" },
      { name: "特文", han: "2翻", sub: "門前 3翻", desc: "頭以外の4語すべてに特殊文字", ex: "ねこ・ぎんか・きっぷ・げーむ・だいす" },
      { name: "七対子", han: "2翻", desc: "2文字の語×7（同じ語は不可）。ルール設定で「七対子あり」のときだけ", ex: "ねこ・いぬ・そら・やま・かさ・はな・いす" },
      { name: "オープンリーチ", han: "2翻", sub: "一巡目 3翻", desc: "手牌をすべて見せてリーチ" },
      { name: "四槓子", han: "2翻", sub: "暗カン 4翻", desc: "カンが4つ" },
    ],
  },
  {
    title: "3翻",
    items: [
      { name: "同頭同尾", han: "3翻", sub: "門前 4翻", desc: "同頭と同尾を別々の2組で", ex: "[お]やつ・[お]さけ・たぬ[き]・ゆう[き]" },
      { name: "同言", han: "3翻", sub: "門前 4翻", desc: "まったく同じ語が2つ", ex: "[さくら]・[さくら]" },
      { name: "同種", han: "3翻", sub: "門前 4翻", desc: "頭以外が同じテーマ（「同種」で宣言し、投票で判定）", ex: "うなぎ・すずめ・めばる・たがめ" },
      { name: "重回文", han: "3翻〜", sub: "＋（文字数−4）", desc: "隣り合う語をつなげて4文字以上の回文", ex: "[たしか]・[かした]" },
      { name: "純特文", han: "3翻", sub: "門前 4翻", desc: "頭も含めすべての語に特殊文字", ex: "ざい・ぎんか・だいす・きっぷ・げーむ" },
    ],
  },
  {
    title: "4翻",
    items: [
      { name: "三連", han: "4翻", sub: "門前 5翻", desc: "頭以外の3語がしりとり", ex: "から[す]→[す]い[か]→[か]もめ" },
      { name: "純同種", han: "4翻", sub: "門前 5翻", desc: "頭も含めすべての語が同じテーマ", ex: "いか・うさぎ・すずめ・めばる・かもめ" },
      { name: "作文", han: "3翻", desc: "14牌で1つの文章（鳴きなし・投票で判定）", ex: "きょうはとてもよいてんきだね" },
      { name: "天和・地和", han: "4翻", desc: "親が配牌でアガる・子が親の最初の捨て牌でロン" },
    ],
  },
  {
    title: "6翻〜役満",
    items: [
      { name: "四連", han: "6翻", sub: "門前 8翻", desc: "頭以外の4語がしりとり", ex: "から[す]→[す]い[か]→[か]も[め]→[め]いろ" },
      { name: "純行", han: "6翻", sub: "門前 8翻", desc: "5語の頭文字が同じ行で あいうえお（か行などでも可）", ex: "[あ]い・[い]なり・[う]きわ・[え]ほん・[お]かめ" },
      { name: "五連", han: "8翻", sub: "門前で役満", desc: "頭から始めて5語すべてしりとり", ex: "い[た]→[た]ん[す]→[す]い[か]→[か]ん[さ]→[さ]んま" },
      { name: "重言", han: "8翻", sub: "門前で役満", desc: "同じ語のペアが2組", ex: "[さくら]・[さくら]・かすみ・かすみ" },
    ],
  },
  {
    title: "副次役（これだけではアガれない）",
    items: [
      { name: "カンドラ", han: "副次", desc: "カン1つにつき1翻（長い語でも1翻）", ex: "さくせん" },
      { name: "特殊文字ドラ", han: "副次", desc: "特殊文字が4枚以上で（枚数−3）翻" },
    ],
  },
];

/** 見本の文字列を、語ごとの牌の並びにする */
function YakuExample({ ex }: { ex: string }) {
  return (
    <div className="yk-ex">
      {ex.split(/(・|→)/).map((part, i) => {
        if (part === "・" || part === "") return null;
        if (part === "→") return <span key={i} className="yk-arrow">→</span>;
        const tiles: { ch: string; hl: boolean }[] = [];
        let hl = false;
        for (const ch of part) {
          if (ch === "[") hl = true;
          else if (ch === "]") hl = false;
          else tiles.push({ ch, hl });
        }
        return (
          <span key={i} className="yk-word">
            {tiles.map((t, j) => (
              <Tile key={j} ch={t.ch} size="xs" className={t.hl ? "yk-hl" : ""} />
            ))}
          </span>
        );
      })}
    </div>
  );
}

/** 基本の牌（特殊文字が「ー」1枚だけ）では成り立たないので数えない役 */
const SPECIAL_YAKU = new Set(["清文", "特文", "純特文", "特殊文字ドラ"]);

/**
 * 役一覧。extraTiles=null のときは牌の設定が分からないので全部出し、追加牌が要る役に印を付ける
 */
export function YakuList({ extraTiles }: { extraTiles: boolean | null }) {
  return (
    <>
      {extraTiles === false && <p className="hint">基本の牌（濁音などの追加なし）では、清文・特文・純特文・特殊文字ドラはありません。</p>}
      {YAKU_GROUPS.map((g) => {
        const items = g.items.filter((y) => extraTiles !== false || !SPECIAL_YAKU.has(y.name));
        if (!items.length) return null;
        return (
          <section key={g.title} className="yk-group">
            <h4 className="yk-title">{g.title}</h4>
            {items.map((y) => (
              <div key={y.name} className="yk-item">
                <div className="yk-head">
                  <span className="yk-name">{y.name}</span>
                  <span className="yk-han">{y.han}</span>
                  {y.sub && <span className="yk-sub">{y.sub}</span>}
                  {extraTiles === null && SPECIAL_YAKU.has(y.name) && <span className="yk-only">追加牌ありのみ</span>}
                </div>
                <div className="yk-desc">{y.desc}</div>
                {y.ex && <YakuExample ex={y.ex} />}
              </div>
            ))}
          </section>
        );
      })}
      <p className="hint">「門前」は鳴いていない（暗カンは可）とき。13翻以上は数え役満。点数は1翻1本〜役満32本（親は1.5倍）、1本＝1,000点。</p>
    </>
  );
}

/** 役一覧を別窓で開く（対局を見ながら確かめられるように） */
export function openYakuWindow(extraTiles: boolean | null) {
  const q = extraTiles === null ? "" : `?extra=${extraTiles ? 1 : 0}`;
  window.open(`/yaku${q}`, "hiragajong-yaku", "width=480,height=860");
}
