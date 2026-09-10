import React from 'react';
import { TooltipManager } from '../../utils/Common';

interface TypeTagProps {
  val: string;
  label: string;
  onRemove?: () => void;
  onClick?: (e: React.MouseEvent) => void;
  extraAttrs?: Record<string, string>;
  // Overrides default gold styling -- e.g. elemental/cast-type color, same pill shape/size.
  color?: string;
  // Uses shared TooltipManager (.global-tooltip) instead of native title, to match app hover styling.
  tooltip?: string;
}

export const TypeTag: React.FC<TypeTagProps> = ({
  val,
  label,
  onRemove,
  onClick,
  extraAttrs,
  color,
  tooltip
}) => {
  return (
    <div
      className="type-tag"
      data-val={val}
      onClick={onClick}
      onMouseEnter={tooltip ? (e: React.MouseEvent) => TooltipManager.show(e.currentTarget as Element, tooltip) : undefined}
      onMouseLeave={tooltip ? () => TooltipManager.hide() : undefined}
      style={color ? { borderColor: color, color, background: `${color}26` } : undefined}
      {...extraAttrs}
    >
      <span>{label}</span>
      {onRemove && (
        <button
          type="button"
          className="type-tag-remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      )}
    </div>
  );
};