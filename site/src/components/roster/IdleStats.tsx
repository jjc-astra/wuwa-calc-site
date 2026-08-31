import React from 'react';
import { useRosterStore } from '../../store/useRosterStore';
import { DataLoader } from '../../utils/DataLoader';
import { CommonUtils, getCharacterThemeColor } from '../../utils/Common';

export const IdleStats: React.FC = () => {
  const { team, enemy, setEnemyField, getIdleStats } = useRosterStore();

  const renderRow = (lbl: string, val: number | string, suffix = '') => (
    <div className="stat-row-display">
      <span className="text-dim">{lbl}</span>
      <span className="stat-val">{val}{suffix}</span>
    </div>
  );

  return (
    <div id="idle-stats-container" className="idle-stats-wrapper">
      {team.map((slot, i) => {
        if (!slot.character) {
          return <div key={i} className="idle-stat-card opacity-0" style={{ pointerEvents: 'none' }}></div>;
        }

        const stats = getIdleStats(i);
        const dbUnit = DataLoader.characterDB[slot.character] || {};
        const eleName = dbUnit.element || 'Element';
        const eleKey = `${eleName.toLowerCase()}DmgBonus`;
        const eleVal = (stats as any)[eleKey] || 0;
        const themeColor = getCharacterThemeColor(dbUnit);

        return (
          <div key={i} className="idle-stat-card" style={{ '--char-theme-raw': themeColor } as React.CSSProperties}>
            <div className="idle-stat-header">
              <span className="text-gold text-bold">{slot.character.toUpperCase()}</span>
              <span className="text-dim text-xs" style={{ fontWeight: 'normal' }}>Idle Stats</span>
            </div>
            <div className="idle-stat-grid">
              {renderRow('HP', Math.floor(stats.hp || 0))}
              {renderRow('Res. Skill DMG', (stats.skillDmgBonus || 0).toFixed(1), '%')}
              {renderRow('ATK', Math.floor(stats.atk || 0))}
              {renderRow('Basic Attack DMG', (stats.basicDmgBonus || 0).toFixed(1), '%')}
              {renderRow('DEF', Math.floor(stats.def || 0))}
              {renderRow('Heavy Attack DMG', (stats.heavyDmgBonus || 0).toFixed(1), '%')}
              {renderRow('Energy Regen', (stats.energyRegen ?? 0).toFixed(1), '%')}
              {renderRow('Res. Liberation DMG', (stats.libDmgBonus || 0).toFixed(1), '%')}
              {renderRow('Crit. Rate', (stats.critRate ?? 0).toFixed(1), '%')}
              {renderRow(`${eleName} DMG Bonus`, eleVal.toFixed(1), '%')}
              {renderRow('Crit. DMG', (stats.critDamage ?? 0).toFixed(1), '%')}
              {renderRow('Healing Bonus', (stats.healingBonus || 0).toFixed(1), '%')}
            </div>
          </div>
        );
      })}

      {/* Enemy Config Card */}
      <div className="idle-stat-card enemy-stat-card" style={{ minWidth: '200px', flex: 0.5 }}>
        <div className="idle-stat-header">
          <span style={{ color: 'var(--danger)' }}>Enemy Target</span>
        </div>
        <div className="idle-stat-grid" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '8px' }}>
          <div className="stat-row-display">
            <span className="text-dim">Level</span>
            <input
              type="number"
              className="num-input enemy-level-input"
              value={enemy.level}
              onChange={e => setEnemyField('level', CommonUtils.clampToRange(parseInt(e.target.value) || 90, 1, 100))}
              style={{ width: '50px', background: 'transparent', border: '1px solid var(--border)', borderRadius: '3px', fontSize: '0.85rem', padding: '2px 4px', color: '#ff9999' }}
            />
          </div>
          <div className="stat-row-display">
            <span className="text-dim">Base RES</span>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <input
                type="number"
                className="num-input enemy-res-input"
                value={enemy.res}
                onChange={e => setEnemyField('res', CommonUtils.clampToRange(parseInt(e.target.value) || 10, -100, 100))}
                style={{ width: '50px', background: 'transparent', border: '1px solid var(--border)', borderRadius: '3px', fontSize: '0.85rem', padding: '2px 4px', color: '#ff9999' }}
              />
              <span className="text-dim ml-sm" style={{ marginLeft: '4px' }}>%</span>
            </div>
          </div>
          <div className="stat-row-display">
            <span className="text-dim">Max HP</span>
            <input
              type="number"
              className="num-input enemy-hp-input"
              value={enemy.hp}
              onChange={e => {
                const val = parseInt(e.target.value);
                setEnemyField('hp', val > 0 ? val : 3000000);
              }}
              style={{ width: '80px', background: 'transparent', border: '1px solid var(--border)', borderRadius: '3px', fontSize: '0.85rem', padding: '2px 4px', color: '#ff9999' }}
            />
          </div>
          <div className="text-dim text-xs" style={{ marginTop: 'auto', fontStyle: 'italic' }}>
            These default stats apply to all damage calculations.
          </div>
        </div>
      </div>
    </div>
  );
};