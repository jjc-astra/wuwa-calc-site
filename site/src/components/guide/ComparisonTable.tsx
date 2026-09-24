// Variant rows, each showing raw values and their % of a baseline (100%). Shared by the Sequence,
// Weapon and Echo comparisons.
import React from 'react';
import { AvatarIcon } from '../common/AvatarIcon';
import { tip, TooltipManager } from '../../utils/Common';
import type { ImageFolder } from '../../data/db';

type Baseline = number | null | undefined;

export interface ComparisonColumn {
  label: string;
}

export interface ComparisonRow {
  key: string;
  label: React.ReactNode;
  icon?: { name: string; folder: ImageFolder; rect?: boolean };
  // Raw metric values, one per column. undefined = still calculating, null = not applicable.
  values: Array<number | null | undefined>;
  // Short note beside the label (e.g. "S2 rotation").
  tag?: string;
  tagTooltip?: string;
  isSelected?: boolean;
  error?: string;
  // Hover text for the label (e.g. the full set + main echo behind a shortened name).
  labelTooltip?: string;
  // Shows a remove (X) button on the row, calling the table's onRemoveRow.
  removable?: boolean;
}

interface ComparisonTableProps {
  columns: ComparisonColumn[];
  rows: ComparisonRow[];
  // The raw value that reads as 100%: one for all columns, or one per column.
  baseline: Baseline | Baseline[];
  onSelectRow?: (key: string) => void;
  onRemoveRow?: (key: string) => void;
  formatValue?: (value: number) => string;
  unitLabel?: string;
}

const formatFull = (v: number): string => Math.round(v).toLocaleString();

export const ComparisonTable: React.FC<ComparisonTableProps> = ({ columns, rows, baseline, onSelectRow, onRemoveRow, formatValue = formatFull, unitLabel }) => {
  const baselineFor = (col: number): Baseline => (Array.isArray(baseline) ? baseline[col] : baseline);
  const pctOf = (v: number | null | undefined, col: number): number | null => {
    const base = baselineFor(col);
    return v === null || v === undefined || !base ? null : (v / base) * 100;
  };

  return (
    // Multi-column tables stack each % under its value to fit a half-width panel.
    <div className={`guide-cmp-table ${columns.length > 1 ? 'is-multi' : ''}`} style={{ '--guide-cmp-cols': columns.length } as React.CSSProperties}>
      {/* A single column needs no heading; the panel title names it. */}
      {columns.length > 1 && (
        <div className="guide-cmp-head caps-label">
          <span />
          {columns.map(col => (
            <span key={col.label} className="guide-cmp-col-label">
              {col.label}
            </span>
          ))}
        </div>
      )}
      {rows.map(row => (
        <div
          key={row.key}
          className={`guide-cmp-row ${row.isSelected ? 'is-selected' : ''} ${onSelectRow ? 'is-clickable' : ''}`}
          onClick={onSelectRow ? () => onSelectRow(row.key) : undefined}
        >
          <span className="guide-cmp-label">
            {row.icon && (
              <AvatarIcon
                name={row.icon.name}
                folder={row.icon.folder}
                className={`avatar-sm ${row.icon.rect ? 'avatar-rect' : ''}`}
              />
            )}
            <span className="guide-cmp-label-text" {...(row.labelTooltip ? tip(row.labelTooltip) : {})}>{row.label}</span>
            {row.tag && (
              <span className="guide-cmp-tag caps-tag pill-badge" {...(row.tagTooltip ? tip(row.tagTooltip) : {})}>{row.tag}</span>
            )}
            {row.removable && onRemoveRow && (
              <button
                type="button"
                className="guide-cmp-remove"
                aria-label="Remove"
                {...tip('Remove')}
                onClick={e => { e.stopPropagation(); TooltipManager.hide(); onRemoveRow(row.key); }}
              >
                ×
              </button>
            )}
          </span>
          {row.values.map((value, i) => {
            const pct = pctOf(value, i);
            return (
              <span key={columns[i].label} className="guide-cmp-value">
                {row.error ? (
                  <span className="guide-cmp-error" {...tip(row.error)}>Error</span>
                ) : value === undefined ? (
                  <span className="guide-cmp-pending" />
                ) : pct === null ? (
                  <span className="text-dim">—</span>
                ) : (
                  <>
                    <span className="guide-cmp-raw">
                      <span className="guide-cmp-raw-value">{formatValue(value as number)}</span>
                      {unitLabel && <span className="guide-cmp-raw-unit caps-tag">{unitLabel}</span>}
                    </span>
                    <span className={`guide-cmp-pct ${pct > 100.05 ? 'is-up' : pct < 99.95 ? 'is-down' : ''}`}>
                      {pct.toFixed(2)}%
                    </span>
                  </>
                )}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};
