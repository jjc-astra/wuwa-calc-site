// src/components/rankings/RankingRow.tsx
import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TeamPreview } from '../common/TeamPreview';
import { StackedContributionBar } from './StackedContributionBar';
import { useRosterStore } from '../../store/useRosterStore';
import { useRotationStore } from '../../store/useRotationStore';
import { DataLoader } from '../../utils/DataLoader';
import { tip } from '../../utils/Common';
import type { RankingEntry } from '../../store/useRankingsStore';
import type { DpsWindowKey } from '../../types/results';

const DPS_FIELD: Record<DpsWindowKey, 'openerDps' | 'firstLoopDps' | 'avgLoopDps' | 'twoMinDps'> = {
  opener: 'openerDps',
  firstLoop: 'firstLoopDps',
  avgLoop: 'avgLoopDps',
  twoMin: 'twoMinDps'
};

interface RankingRowProps {
  rank: number;
  entry: RankingEntry;
  activeWindow: DpsWindowKey;
  maxDps: number;
}

export const RankingRow: React.FC<RankingRowProps> = ({ rank, entry, activeWindow, maxDps }) => {
  const dps = entry.dpsStats[DPS_FIELD[activeWindow]] ?? 0;
  const widthPct = maxDps > 0 ? (dps / maxDps) * 100 : 0;
  const unitNames = entry.team.filter(s => s.character).map(s => s.character);
  const label = unitNames.join(' · ');
  const segments = entry.contribution[activeWindow]?.team ?? [];
  const unitBreakdowns = entry.contribution[activeWindow]?.units ?? {};
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  // .pin-menu's default CSS (position:absolute inside a position:relative wrap) gets clipped
  // here -- unlike History's own copy of this menu, this row sits inside .rankings-tab-panel's
  // overflow:hidden (needed for its own rounded-corner tab shell). Portaling to <body> with a
  // fixed position computed from the trigger button's own rect (same approach Dropdown.tsx
  // already uses for its popup) sidesteps that entirely, while keeping the exact same
  // bottom-right-of-the-button placement the un-portaled version would have had.
  useLayoutEffect(() => {
    if (!menuOpen || !menuBtnRef.current) return;
    const rect = menuBtnRef.current.getBoundingClientRect();
    setMenuStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right
    });
  }, [menuOpen]);

  // entry.id is the submitted file's name -- DataLoader.characterResults still has the full
  // record (rotation/settings included) it was loaded from, since useRankingsStore.load() never
  // clears that cache. RankingEntry itself only carries the computed dpsStats/contribution, not
  // the raw rotation, so this is the only place left to get it from.
  const handleOpenInCalculator = async () => {
    const data = DataLoader.characterResults[entry.id];
    if (!data) return;
    setMenuOpen(false);
    await useRosterStore.getState().importTeam(entry.team);
    useRotationStore.getState().importRotation(data.rotation, data.settings);
    // Mirrors useHashRoute's routeToHash('calculator', 2) -- no navigate() prop reaches this
    // deep (Rankings doesn't otherwise need routing), and the hook's own hashchange listener
    // picks this up the same as if it had called navigate() itself.
    window.location.hash = '#/calculator/step-2';
  };

  const handleOpenGuide = () => {
    setMenuOpen(false);
    // Character Guide has no per-character route yet (still "Soon" in nav.ts) -- lands on its
    // coming-soon page for now rather than a dead link, and starts working for real the moment
    // that page exists.
    window.location.hash = '#/guide';
  };

  return (
    <div className="ranking-row">
      <div className="ranking-row-rank">{rank}</div>
      <div className="ranking-row-icons">
        <TeamPreview team={entry.team} />
      </div>
      <div className="ranking-row-main">
        <div className="ranking-row-label-line">
          <span className="ranking-row-label">{label || 'Empty Team'}</span>
          <span className={`ranking-row-type-badge ranking-row-type-${entry.rotationType ?? 'unclassified'}`}>
            {entry.rotationType === 'linear' ? 'Linear' : entry.rotationType === 'quickswap' ? 'Quickswap' : 'Unclassified'}
          </span>
        </div>
        <StackedContributionBar
          segments={segments}
          unitNames={unitNames}
          unitBreakdowns={unitBreakdowns}
          widthPct={widthPct}
          dpsValue={dps}
        />
      </div>
      <div className="ranking-row-menu-wrap">
        <button
          type="button"
          className="ranking-row-menu-btn"
          ref={menuBtnRef}
          onClick={() => setMenuOpen(o => !o)}
          {...tip('More actions')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="2"></circle>
            <circle cx="12" cy="12" r="2"></circle>
            <circle cx="12" cy="19" r="2"></circle>
          </svg>
        </button>
        {menuOpen && createPortal(
          <>
            <div className="pin-menu-backdrop" onClick={() => setMenuOpen(false)} />
            <div className="pin-menu" style={menuStyle}>
              <button type="button" className="pin-menu-item" onClick={handleOpenInCalculator}>
                Open in Rotation Calculator
              </button>
              {unitNames.map(name => (
                <button type="button" key={name} className="pin-menu-item" onClick={handleOpenGuide}>
                  Open {name} Guide
                </button>
              ))}
            </div>
          </>,
          document.body
        )}
      </div>
    </div>
  );
};
