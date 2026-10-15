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
  // Added after `type-tag`, for a variant (e.g. `is-removed`).
  className?: string;
}

/** A pill tag, optionally removable. */
export const TypeTag: React.FC<TypeTagProps> = ({
  val,
  label,
  onRemove,
  onClick,
  extraAttrs,
  color,
  tooltip,
  className
}) => {
  // A click often swaps this tag out (e.g. restoring a removed effect), so no mouseleave fires to hide it.
  const hideTooltip = () => { if (tooltip) TooltipManager.hide(); };
  return (
    <div
      className={className ? `type-tag ${className}` : 'type-tag'}
      data-val={val}
      onClick={onClick && (e => { hideTooltip(); onClick(e); })}
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
            hideTooltip();
            onRemove();
          }}
        >
          ×
        </button>
      )}
    </div>
  );
};