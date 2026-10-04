import type { CSSProperties, PointerEvent as RPointerEvent } from "react";
import { isSpecial } from "../../shared/tiles";

export type TileSize = "xl" | "lg" | "md" | "sm" | "xs";

interface Props {
  ch?: string;
  size?: TileSize;
  back?: boolean;
  sideways?: boolean;
  /** 文字だけを回す角度（卓の向きと逆に回して文字を正立させる） */
  glyphRotate?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
  onPointerDown?: (e: RPointerEvent<HTMLDivElement>) => void;
  dataId?: number;
}

export function Tile({ ch, size = "md", back, sideways, glyphRotate = 0, className = "", style, title, onPointerDown, dataId }: Props) {
  const cls = ["tile", `tile-${size}`, back ? "tile-back" : "", sideways ? "tile-sideways" : "", ch && isSpecial(ch) ? "tile-special" : "", className].filter(Boolean).join(" ");
  return (
    <div className={cls} style={style} title={title} onPointerDown={onPointerDown} data-id={dataId}>
      {!back && (
        <span className="tile-ch" style={glyphRotate ? { transform: `rotate(${glyphRotate}deg)` } : undefined}>
          {ch}
        </span>
      )}
    </div>
  );
}

/** 立てた牌を6面の箱として描く（他家の手牌用）。表（文字面）は持ち主側を向くので無地 */
export function TileBox({ className = "" }: { className?: string }) {
  return (
    <div className={`tbox ${className}`}>
      <i className="tf tf-back" />
      <i className="tf tf-face" />
      <i className="tf tf-top" />
      <i className="tf tf-bottom" />
      <i className="tf tf-left" />
      <i className="tf tf-right" />
    </div>
  );
}
