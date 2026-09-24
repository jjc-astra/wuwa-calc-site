// The icon-grid library shared by the Mechanics Builder and the Character Guide.
import React from 'react';
import { CommonUtils, TooltipManager, tip } from '../../utils/Common';
import { useImageStatus } from '../../hooks/useImageStatus';
import { IMAGE_FOLDERS } from '../../data/db';
import type { ImageFolder } from '../../data/db';

interface LibrarySearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

/** The library's search box. */
export const LibrarySearchInput: React.FC<LibrarySearchInputProps> = ({ value, onChange, placeholder }) => (
  <div style={{ padding: '1.25rem 1.25rem 1rem 1.25rem', flexShrink: 0 }}>
    <input
      type="text"
      className="form-input library-search-input"
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        width: '100%',
        maxWidth: '25rem',
        padding: '0.625rem 0.9375rem',
        fontSize: '0.9rem',
        background: 'var(--bg-well)',
        borderRadius: '0.375rem'
      }}
    />
  </div>
);

// Case-insensitive substring match against the trimmed search box.
export const matchesLibrarySearch = (item: string, search: string): boolean =>
  item.toLowerCase().includes(search.toLowerCase().trim());

interface LibrarySectionProps {
  title: string;
  children: React.ReactNode;
}

/** A titled grid of library cards. */
export const LibrarySection: React.FC<LibrarySectionProps> = ({ title, children }) => (
  <div className="grid-section" style={{ width: '100%' }}>
    <div
      className="text-gold mb-4px"
      style={{ fontSize: '1.1em', fontWeight: 'bold', borderBottom: '1px solid #444', paddingBottom: '0.25rem' }}
    >
      {title}
    </div>
    <div
      className="item-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(5.3125rem, 1fr))',
        gap: '0.75rem',
        marginTop: '0.75rem',
        width: '100%'
      }}
    >
      {children}
    </div>
  </div>
);

interface LibraryCardProps {
  itemName: string;
  imgFolder: ImageFolder;
  // Characters/weapons get a rarity-colored frame; other folders ignore it.
  rarity?: number;
  // Greys the card out; dimmedTooltip explains why.
  dimmed?: boolean;
  dimmedTooltip?: string;
  onClick: () => void;
  // Corner overlay, e.g. the Builder's unsaved-changes badge.
  badge?: React.ReactNode;
}

/** One entity's card: its icon (rarity-framed for characters and weapons) and name. */
export const LibraryCard: React.FC<LibraryCardProps> = ({ itemName, imgFolder, rarity = 5, dimmed = false, dimmedTooltip, onClick, badge }) => {
  const iconPath = CommonUtils.getIconPath(itemName, imgFolder);
  const { loaded: imgLoaded, errored: imgError, onLoad: onImgLoad, onError: onImgError } = useImageStatus(iconPath);

  const hasRarityFrame = imgFolder === IMAGE_FOLDERS.CHARACTERS || imgFolder === IMAGE_FOLDERS.WEAPONS;
  const rarityClass = hasRarityFrame ? `rarity-${rarity}` : 'rarity-none';
  const iconClass = imgFolder === IMAGE_FOLDERS.ECHO_SETS || imgFolder === IMAGE_FOLDERS.SYSTEM ? 'char-icon echo-set-icon' : 'char-icon';
  const fontSize = imgFolder === IMAGE_FOLDERS.CHARACTERS ? '0.8em' : '0.65em';

  return (
    <div
      className={`char-grid-card ${dimmed ? 'is-unimplemented' : ''}`}
      onClick={() => {
        // Grid unmounts on selection -- no natural mouseleave fires, so hide tooltip explicitly.
        TooltipManager.hide();
        onClick();
      }}
      {...(dimmed && dimmedTooltip ? tip(dimmedTooltip) : {})}
    >
      {badge}
      <div className={`${iconClass} ${rarityClass}`}>
        {!imgError && (
          <img
            className={`char-grid-img ${imgLoaded ? 'opacity-1' : 'opacity-0'}`}
            src={iconPath}
            alt={itemName}
            onLoad={onImgLoad}
            onError={onImgError}
          />
        )}
        {(!imgLoaded || imgError) && (
          <span className="char-fallback">{itemName.charAt(0)}</span>
        )}
      </div>
      <div
        className="char-name-label"
        style={{
          fontSize,
          lineHeight: 1.2,
          whiteSpace: 'normal',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical'
        }}
      >
        {itemName}
      </div>
    </div>
  );
};
