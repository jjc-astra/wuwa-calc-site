import React from 'react';

interface TypeTagProps {
  val: string;
  label: string;
  onRemove?: () => void;
  onClick?: () => void;
  extraAttrs?: Record<string, string>;
}

export const TypeTag: React.FC<TypeTagProps> = ({
  val,
  label,
  onRemove,
  onClick,
  extraAttrs
}) => {
  return (
    <div className="type-tag" data-val={val} onClick={onClick} {...extraAttrs}>
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
          {' '}
        </button>
      )}
    </div>
  );
};