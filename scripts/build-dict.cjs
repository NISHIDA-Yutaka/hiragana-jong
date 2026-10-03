// JMdict (jmdict-simplified JSON) からひらがなの単語リストを作る。
// 使い方: node scripts/build-dict.cjs path/to/jmdict-eng-x.y.z.json
// 出力: data/words.txt.gz （1行1語。常用語は "語\t1"）
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const src = process.argv[2];
if (!src) {
  console.error("usage: node scripts/build-dict.cjs jmdict-eng.json");
  process.exit(1);
}
const j = JSON.parse(fs.readFileSync(src, "utf8"));
// 助詞・接辞・助数詞・助動詞などだけの語は除外
const BAD_POS = new Set(["prt", "suf", "pref", "ctr", "aux", "aux-v", "aux-adj", "cop", "n-suf", "n-pref", "conj"]);
// 不規則・古い・検索専用・稀なかな表記は除外
const BAD_KTAG = new Set(["ik", "ok", "sk", "rk"]);
const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const ok = /^[ぁ-ゔー]+$/;
const m = new Map();
for (const w of j.words) {
  if (w.sense.every((s) => s.partOfSpeech.every((p) => BAD_POS.has(p)))) continue;
  for (const k of w.kana) {
    if (k.tags.some((t) => BAD_KTAG.has(t))) continue;
    const h = toHira(k.text);
    if (!ok.test(h) || h.length < 2 || h.length > 12 || h[0] === "ー") continue;
    m.set(h, Math.max(m.get(h) || 0, k.common ? 2 : 1));
  }
}
const arr = [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
const text = arr.map(([w, c]) => (c === 2 ? w + "\t1" : w)).join("\n") + "\n";
const out = path.join(__dirname, "..", "data", "words.txt.gz");
fs.writeFileSync(out, zlib.gzipSync(text, { level: 9 }));
console.log(`${arr.length} words -> ${out}`);
