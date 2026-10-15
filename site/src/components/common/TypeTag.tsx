import React from 'react';
import { TooltipManager } from '../../utils/Common';

interface TypeTagProps {
  val: string;
  label: string;
  onRemove?: () => void;
  onClick?: (e: React.MouseEvent) => void;
  extraAttrs?: Record<string, string>;
  // Overrides the default gold.
  color?: string;
  tooltip?: string;
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
  // A click may unmount the tag before mouseleave.
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