import React from 'react';
import { TooltipManager } from '../../utils/Common';

interface TypeTagProps {
  val: string;
  label: string;
  onRemove?: () => void;
  onClick?: (e: React.MouseEvent) => void;
  extraAttrs?: Record<string, string>;
  // Overrides the default gold styling -- e.g. an elemental color for a dmg-type tag, or a
  // cast-type color -- keeping the same pill shape/size so tags stay visually consistent.
  color?: string;
  // Uses the site's shared TooltipManager (.global-tooltip) instead of a native title
  // attribute, so it matches the rest of the app's hover styling instead of the browser default.
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