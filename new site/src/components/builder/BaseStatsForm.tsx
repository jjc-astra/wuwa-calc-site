import React, { useState } from 'react';
import { useBuilderStore } from '../../store/useBuilderStore';
import { DataLoader } from '../../utils/DataLoader';
import { CommonUtils } from '../../utils/Common';
import { IMAGE_FOLDERS } from '../../data/db';

export const BaseStatsForm: React.FC = () => {
  const { activeChar, baseStats, setBaseStat } = useBuilderStore();
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  if (!activeChar) return null;

  const isChar = !!DataLoader.characterDB[activeChar];
  const isWep = !!DataLoader.weaponDB[activeChar];

  if (!isChar && !isWep) return null;

  const talentOpts = ['', 'ATK %', 'HP %', 'DEF %', 'CR Rate', 'CR DMG', 'Healing Bonus', 'Glacio DMG', 'Fusion DMG', 'Electro DMG', 'Aero DMG', 'Spectro DMG', 'Havoc DMG', 'Physical DMG'];
  const iconFolder = isChar ? IMAGE_FOLDERS.CHARACTERS : IMAGE_FOLDERS.WEAPONS;
  const iconPath = CommonUtils.getIconPath(activeChar, iconFolder);
  const forteCount = parseInt(baseStats.forteCount as any, 10) || 1;

  const makeInput = (key: string, label: string, defaultVal: string | number = '', placeholder = '') => (
    <div key={key} className="form-group flex-1" style={{ minWidth: '120px' }}>
      <label className="form-label text-dim">{label}</label>
      <input
        type="text"
        className="form-input base-stat-input w-100"
        value={baseStats[key] !== undefined ? baseStats[key] : defaultVal}
        placeholder={placeholder}
        onChange={e => {
          let val: any = e.target.value;
          if (val !== '' && !isNaN(Number(val))) val = parseFloat(val);
          setBaseStat(key, val);
        }}
      />
    </div>
  );

  const makeSelect = (key: string, label: string) => (
    <div className="form-group flex-1" style={{ minWidth: '120px' }}>
      <label className="form-label text-dim">{label}</label>
      <select
        className="base-select base-stat-input w-100"
        value={baseStats[key] || ''}
        onChange={e => setBaseStat(key, e.target.value)}
      >
        {talentOpts.map(opt => (
          <option key={opt} value={opt}>
            {opt || 'None'}
          </option>
        ))}
      </select>
    </div>
  );

  const renderGroupWrapper = (title: string, children: React.ReactNode) => (
    <div className="node-section mb-sm" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
      <div className="node-section-title text-gold" style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)', fontWeight: 'bold', textTransform: 'uppercase', fontSize: '0.8rem' }}>
        {title}
      </div>
      <div className="form-row" style={{ flexWrap: 'wrap', padding: '12px' }}>
        {children}
      </div>
    </div>
  );

  const extraForteInputs = [];
  for (let i = 1; i <= forteCount; i++) {
    extraForteInputs.push(makeInput(`maxForte${i}`, `Max Forte ${i}`, 100));
  }

  return (
    <div className="base-card" style={{ flexDirection: 'row', gap: '20px', alignItems: 'stretch' }}>
      <div id="editor-char-icon" className={`char-icon rarity-${baseStats.rarity || 5}`} style={{ width: '130px', height: 'auto', flexShrink: 0, margin: 0, alignSelf: 'flex-start' }}>
        {!imgError && (
          <img
            className={`char-grid-img ${imgLoaded ? 'opacity-1' : 'opacity-0'}`}
            src={iconPath}
            alt={activeChar}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
          />
        )}
        {(!imgLoaded || imgError) && (
          <span className="char-fallback">{activeChar.charAt(0)}</span>
        )}
      </div>

      <div style={{ flex: 1 }}>
        <div className="panel-header-tiny">{isChar ? 'Base Stats (Lvl 90)' : 'Weapon Stats (Lvl 90)'}</div>
        <div className="panel-content-grid" id="base-stats-form">
          {isChar ? (
            <>
              {renderGroupWrapper('Identity', (
                <>
                  {makeInput('weaponType', 'Weapon Type')}
                  {makeInput('element', 'Element')}
                  {makeInput('rarity', 'Rarity', 5)}
                </>
              ))}

              {renderGroupWrapper('Base Values', (
                <>
                  {makeInput('baseAtk', 'Base ATK')}
                  {makeInput('baseHP', 'Base HP')}
                  {makeInput('baseDef', 'Base DEF')}
                  {makeInput('baseCritRate', 'Base CR Rate', '5%')}
                  {makeInput('baseCritDmg', 'Base CR DMG', '150%')}
                </>
              ))}

              {renderGroupWrapper('Talent Nodes', (
                <>
                  {makeSelect('talentStat1', 'Stat Node 1')}
                  {makeInput('talentVal1', 'Value 1', '', 'e.g. 8%')}
                  {makeSelect('talentStat2', 'Stat Node 2')}
                  {makeInput('talentVal2', 'Value 2', '', 'e.g. 12%')}
                </>
              ))}

              {renderGroupWrapper('Resources', (
                <>
                  {makeInput('maxEnergy', 'Max Energy', 100)}
                  {makeInput('forteCount', 'Forte Count', 1)}
                  {extraForteInputs}
                </>
              ))}
            </>
          ) : (
            <>
              {renderGroupWrapper('Identity', (
                <>
                  {makeInput('weaponType', 'Weapon Type')}
                  {makeInput('rarity', 'Rarity', 5)}
                </>
              ))}
              {renderGroupWrapper('Base Stats', makeInput('baseAtk', 'Base ATK'))}
              {renderGroupWrapper('Sub Stat', (
                <>
                  {makeInput('subStatType', 'Type', '', 'e.g. CR Rate')}
                  {makeInput('subStatValue', 'Value', '', 'e.g. 24.3%')}
                </>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};