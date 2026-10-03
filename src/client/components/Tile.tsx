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
