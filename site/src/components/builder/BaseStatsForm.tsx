import React, { useState } from 'react';
import { useBuilderStore } from '../../store/useBuilderStore';
import { DataLoader } from '../../utils/DataLoader';
import { CommonUtils } from '../../utils/Common';
import { IMAGE_FOLDERS } from '../../data/db';
import { Dropdown } from '../common/Dropdown';

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
    <div key={key} className="base-stat-field">
      <label className="base-stat-label">{label}</label>
      <input
        type="text"
        className="base-stat-value"
        value={baseStats[key] !== undefined ? baseStats[key] : defaultVal}
        placeholder={placeholder || '—'}
        onChange={e => {
          let val: any = e.target.value;
          if (val !== '' && !isNaN(Number(val))) val = parseFloat(val);
          setBaseStat(key, val);
        }}
      />
    </div>
  );

  const makeCheckbox = (key: string, label: string) => (
    <label key={key} className="checkbox-label base-stat-checkbox">
      <input
        type="checkbox"
        checked={!!baseStats[key]}
        onChange={e => setBaseStat(key, e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );

  const makeSelect = (key: string, label: string) => (
    <div className="base-stat-field">
      <label className="base-stat-label">{label}</label>
      <Dropdown
        className="base-select base-stat-value"
        value={baseStats[key] || ''}
        onChange={v => setBaseStat(key, v)}
        options={talentOpts.map(opt => ({ value: opt, label: opt || 'None' }))}
      />
    </div>
  );

  // Mirrors the mechanics table's own grouping language -- a small accent-underlined label
  // bracketing just its own fields, not a separate bordered/backgrounded box per group.
  const renderGroup = (title: string, children: React.ReactNode) => (
    <div className="base-stats-group">
      <div className="base-stats-group-title">{title}</div>
      <div className="base-stats-group-fields">{children}</div>
    </div>
  );

  const extraForteInputs = [];
  for (let i = 1; i <= forteCount; i++) {
    extraForteInputs.push(makeInput(`maxForte${i}`, `Max Forte ${i}`, 100));
  }

  return (
    <div className="base-card base-stats-card">
      <div className="base-stats-icon-col">
        <div id="editor-char-icon" className={`char-icon rarity-${baseStats.rarity || 5} base-stats-icon`}>
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

        {isChar && (
          <div className="base-stats-mode-panel">
            {makeCheckbox('isDualMode', 'Dual Mode')}
          </div>
        )}
      </div>

      <div className="base-stats-body">
        <div className="panel-header-tiny">{isChar ? 'Base Stats (Lvl 90)' : 'Weapon Stats (Lvl 90)'}</div>
        <div className="base-stats-strip" id="base-stats-form">
          {isChar ? (
            <>
              {renderGroup('Identity', (
                <>
                  {makeInput('weaponType', 'Weapon Type')}
                  {makeInput('element', 'Element')}
                  {makeInput('rarity', 'Rarity', 5)}
                  {!!baseStats.isDualMode && (
                    <>
                      {makeInput('mode1Name', 'Mode 1 Name', '', 'e.g. Strain')}
                      {makeInput('mode2Name', 'Mode 2 Name', '', 'e.g. Rupture')}
                    </>
                  )}
                </>
              ))}

              {renderGroup('Base Values', (
                <>
                  {makeInput('baseAtk', 'Base ATK')}
                  {makeInput('baseHP', 'Base HP')}
                  {makeInput('baseDef', 'Base DEF')}
                  {makeInput('baseCritRate', 'Base CR Rate', '5%')}
                  {makeInput('baseCritDmg', 'Base CR DMG', '150%')}
                </>
              ))}

              {renderGroup('Talent Nodes', (
                <>
                  {makeSelect('talentStat1', 'Stat Node 1')}
                  {makeInput('talentVal1', 'Value 1', '', 'e.g. 8%')}
                  {makeSelect('talentStat2', 'Stat Node 2')}
                  {makeInput('talentVal2', 'Value 2', '', 'e.g. 12%')}
                </>
              ))}

              {renderGroup('Resources', (
                <>
                  {makeInput('maxEnergy', 'Max Energy', 100)}
                  {makeInput('forteCount', 'Forte Count', 1)}
                  {extraForteInputs}
                </>
              ))}
            </>
          ) : (
            <>
              {renderGroup('Identity', (
                <>
                  {makeInput('weaponType', 'Weapon Type')}
                  {makeInput('rarity', 'Rarity', 5)}
                </>
              ))}
              {renderGroup('Base Stats', makeInput('baseAtk', 'Base ATK'))}
              {renderGroup('Sub Stat', (
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
