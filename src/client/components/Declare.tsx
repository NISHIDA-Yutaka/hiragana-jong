// 自己申告の画面：ロン牌・ツモ牌を入れる位置の選択、ポン・カンの語の選択
import { useEffect, useState } from "react";
import { Arrangement, groupIds } from "../../shared/arrange";
import type { Tile as TileT } from "../../shared/tiles";
import { shapeLabel } from "../shape";
import { Tile } from "./Tile";

function useLeft(deadline: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [deadline]);
  return deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
}

export function toGroups(arr: Arrangement | null, hand: TileT[]): TileT[][] {
  if (!arr) return [hand];
  const byId = new Map(hand.map((t) => [t.id, t]));
  return groupIds(arr)
    .map((g) => g.map((id) => byId.get(id)!).filter(Boolean))
    .filter((g) => g.length);
}

const word = (g: TileT[]) => g.map((t) => t.ch).join("");

/** 牌を1枚、どの組のどこに入れるか選ぶ */
export function PlaceDialog(props: {
  title: string;
  lead: string;
  groups: TileT[][];
  extra: TileT;
  meldCount: number;
  deadline: number | null;
  confirmLabel: string;
  onConfirm: (group: number, pos: number) => void;
  cancelLabel: string;
  onCancel: () => void;
  danger?: boolean;
  /** 作文：区切りのない文章に入れる（形の判定はしない） */
  sentence?: boolean;
}) {
  const { groups, extra, meldCount } = props;
  const [pick, setPick] = useState<{ g: number; p: number } | null>(null);
  const left = useLeft(props.deadline);
  // 作文は14枚が1列に並ぶので小さめの牌にする
  const tsz = props.sentence ? "sm" : "md";
  const preview = groups.map((g, gi) => (pick && pick.g === gi ? [...g.slice(0, pick.p), extra, ...g.slice(pick.p)] : g));
  const shape = shapeLabel(
    preview.map((g) => g.map((t) => t.ch).join("")),
    meldCount,
  );
  const ok = !!pick && (props.sentence || shape.cls === "shape-win");
  return (
    <div className="modal-back">
      <div className="modal declare">
        <div className="result-title small">{props.title}</div>
        <p className="declare-lead">
          {props.lead}
          {left !== null && <b className="declare-left">{left}</b>}
        </p>
        <div className="declare-extra">
          <Tile ch={extra.ch} size="lg" className="win-tile" />
        </div>
        <div className="place-groups">
          {groups.map((g, gi) => (
            <div key={gi} className="place-group">
              <div className="place-tiles">
                {Array.from({ length: g.length + 1 }).map((_, p) => (
                  <span key={p} className="place-cell">
                    <button className={`slot ${pick?.g === gi && pick.p === p ? "on" : ""}`} onClick={() => setPick({ g: gi, p })} title="ここに入れる">
                      {pick?.g === gi && pick.p === p ? <Tile ch={extra.ch} size={tsz} className="win-tile" /> : <i>＋</i>}
                    </button>
                    {p < g.length && <Tile ch={g[p].ch} size={tsz} />}
                  </span>
                ))}
              </div>
              <div className="wword">{word(preview[gi])}</div>
            </div>
          ))}
        </div>
        <div className={`shape ${props.sentence ? (pick ? "shape-win" : "") : shape.cls}`}>
          {!pick ? "＋をクリックして、牌を入れる場所を選んでください" : props.sentence ? "作文（14牌で1つの文章）" : shape.text}
        </div>
        <div className="modal-foot gap">
          <button className={`btn ${props.danger ? "btn-danger" : "btn-ghost"}`} onClick={props.onCancel}>
            {props.cancelLabel}
          </button>
          <button className="btn btn-primary" disabled={!ok} onClick={() => pick && props.onConfirm(pick.g, pick.p)}>
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** ツモの確認。すでにアガリの形なら語を見せて確認、ツモ牌が1枚離れていれば入れる場所を選ぶ */
export function TsumoDialog({
  groups,
  meldCount,
  onConfirm,
  onClose,
}: {
  groups: TileT[][];
  meldCount: number;
  onConfirm: (insert: { tile: TileT; group: number; pos: number } | null) => void;
  onClose: () => void;
}) {
  const shape = shapeLabel(
    groups.map((g) => g.map((t) => t.ch).join("")),
    meldCount,
  );
  if (shape.cls === "shape-win") {
    return (
      <div className="modal-back">
        <div className="modal declare">
          <div className="result-title small">ツモを宣言しますか？</div>
          <div className="win-hand">
            {groups.map((g, i) => (
              <div key={i} className="wgroup">
                <div className="wtiles">
                  {g.map((t) => (
                    <Tile key={t.id} ch={t.ch} size="md" />
                  ))}
                </div>
                <div className="wword">{word(g)}</div>
              </div>
            ))}
          </div>
          <p className="hint center">宣言すると手牌が公開され、他の人が言葉を確認します。認められないとチョンボ（満貫払い）です。</p>
          <div className="modal-foot gap">
            <button className="btn btn-ghost" onClick={onClose}>
              やめる
            </button>
            <button className="btn btn-primary" onClick={() => onConfirm(null)}>
              ツモを宣言
            </button>
          </div>
        </div>
      </div>
    );
  }
  const last = groups[groups.length - 1];
  const rest = groups.slice(0, -1);
  if (last?.length === 1 && rest.length) {
    return (
      <PlaceDialog
        title="ツモ"
        lead="ツモ牌を入れる場所を選んで宣言します。認められないとチョンボです。"
        groups={rest}
        extra={last[0]}
        meldCount={meldCount}
        deadline={null}
        confirmLabel="ツモを宣言"
        onConfirm={(group, pos) => onConfirm({ tile: last[0], group, pos })}
        cancelLabel="やめる"
        onCancel={onClose}
      />
    );
  }
  return (
    <div className="modal-back">
      <div className="modal declare">
        <div className="result-title small">ツモ</div>
        <p className="declare-lead">
          手牌を「2文字×1＋3文字×4」（七対子なら異なる2文字×7）に区切ってから宣言してください。
          <br />
          今の形：{shape.text}
        </p>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

/** ポン・カンの語を選ぶ。並べた組（ポンは2枚、カンは3枚以上）に捨て牌を入れた形から選ぶ */
export function CallDetailDialog({
  call,
  tile,
  groups,
  deadline,
  onPick,
  onCancel,
}: {
  call: "pon" | "kan";
  tile: TileT;
  groups: TileT[][];
  deadline: number | null;
  onPick: (tileIds: number[]) => void;
  onCancel: () => void;
}) {
  const left = useLeft(deadline);
  const options: { word: string; ids: number[] }[] = [];
  for (const g of groups) {
    if (call === "pon" ? g.length !== 2 : g.length < 3) continue;
    for (let p = 0; p <= g.length; p++) {
      const ts = [...g.slice(0, p), tile, ...g.slice(p)];
      const w = word(ts);
      if (!options.some((o) => o.word === w)) options.push({ word: w, ids: ts.map((t) => t.id) });
    }
  }
  const label = call === "pon" ? "ポン" : "カン";
  return (
    <div className="modal-back light">
      <div className="modal declare">
        <div className="result-title small">{label}する語</div>
        <p className="declare-lead">
          {call === "pon" ? "2枚の組" : "3枚以上の組"}に <Tile ch={tile.ch} size="xs" /> を入れた語を選んでください。辞書にない語だと鳴けず、この局はアガリ放棄になります。
          {left !== null && <b className="declare-left">{left}</b>}
        </p>
        {options.length === 0 ? (
          <p className="declare-lead bad">{call === "pon" ? "2枚の組がありません。手牌を区切ってください（このまま選べます）。" : "3枚以上の組がありません。"}</p>
        ) : (
          <div className="detail-options">
            {options.map((o) => (
              <button key={o.word + o.ids.join()} className="abtn abtn-word" onClick={() => onPick(o.ids)}>
                {o.word}
              </button>
            ))}
          </div>
        )}
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onCancel}>
            {label}をやめる
          </button>
        </div>
      </div>
    </div>
  );
}
