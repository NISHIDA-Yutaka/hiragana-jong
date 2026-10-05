// 効果音の試聴ページ（開発中だけ /sounds で開ける）
import { callSound, chime, clack, fanfare, gameStart, riichiSound, riipaiStart, say, shuffle, tick, tilePick, tilePlace } from "./sound";

const SOUNDS: [string, string, () => void][] = [
  ["配牌", "haipai.wav", shuffle],
  ["理牌の始まり", "ポロン", riipaiStart],
  ["対局の始まり（新）", "ドドン＋和音", gameStart],
  ["対局の始まり（代用案）", "以前の配牌のピンポン", chime],
  ["牌をつまむ", "tumamu.wav", tilePick],
  ["牌を置く（並べ直し）", "oku.mp3", tilePlace],
  ["打牌", "dahai.wav", () => clack()],
  ["ポン・カン・ロン・ツモ", "", callSound],
  ["リーチ", "", riichiSound],
  ["アガリ", "", () => fanfare()],
  ["アガリ（役満など）", "", () => fanfare(true)],
  ["持ち時間の残り5秒", "", tick],
  ["発声", "ロン", () => say("ロン")],
];

export function SoundTest() {
  return (
    <div className="yaku-page">
      <div className="yaku-page-inner">
        <h1 style={{ color: "var(--gold)", fontSize: 22 }}>効果音の試聴</h1>
        <div style={{ display: "grid", gap: 8 }}>
          {SOUNDS.map(([label, sub, play]) => (
            <button key={label} className="btn" style={{ justifyContent: "space-between", display: "flex" }} onClick={play}>
              <span>{label}</span>
              <small style={{ opacity: 0.7 }}>{sub}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
