import React from 'react';

interface FormulaRowProps {
  formulaStr?: string;
}

export const FormulaRow: React.FC<FormulaRowProps> = ({ formulaStr }) => {
  if (!formulaStr) return null;
  return (
    <div className="dmg-formula-container">
      <div className="panel-header-tiny">Calculation Breakdown</div>
      <div className="dmg-formula-box text-dim" style={{ userSelect: 'text', WebkitUserSelect: 'text', cursor: 'text' }}>
        {formulaStr}
      </div>
    </div>
  );
};