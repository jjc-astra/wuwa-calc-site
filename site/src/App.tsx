// src/App.tsx
import { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { LandingPage } from './components/LandingPage';
import { ComingSoonPage } from './components/ComingSoonPage';
import { MechanicsBuilder } from './components/builder/MechanicsBuilder';
import { TeamBuilder } from './components/roster/TeamBuilder';
import { RotationBuilder } from './components/rotation/RotationBuilder';
import { ResultsPanel } from './components/results/ResultsPanel';
import { RotationRankingsPage } from './components/rankings/RotationRankingsPage';
import { FreshnessConflictDialog } from './components/common/FreshnessConflictDialog';
import { DataLoader } from './utils/DataLoader';
import { checkTeamFreshness, checkBuilderItemFreshness } from './utils/dataFreshness';
import { useRosterStore } from './store/useRosterStore';
import { useRankingsStore } from './store/useRankingsStore';
import { useBuilderStore, mechFolderFor } from './store/useBuilderStore';
import { NAV_ITEMS } from './config/nav';
import { useHashRoute } from './hooks/useHashRoute';
import './assets/css/palette.css';
import './assets/css/components.css';
import './assets/css/calculator.css';
import './assets/css/builder.css';
import './assets/css/landing.css';
import './assets/css/results.css';
import './assets/css/rankings.css';
import './assets/css/timeline.css';

export default function App() {
  const [{ view: currentView, step: activeStep }, navigate] = useHashRoute();
  const [isLoaded, setIsLoaded] = useState(false);

  // Shared by the initial load and the tab-refocus check below -- re-checks whatever entity the
  // Mechanics Builder currently has open against the manifest and, if it changed upstream (and
  // there's no conflicting local edit -- see checkBuilderItemFreshness/useFreshnessConflictStore),
  // replays setActiveChar so the Builder's own `mechanics` working copy actually picks up
  // whatever checkItems just evicted+refetched into DataLoader.mechanicsDB. A no-op re-derive
  // when nothing changed, so it's cheap to call unconditionally.
  const refreshActiveBuilderItem = async () => {
    const { activeChar, activeFolder, activeRarity, setActiveChar } = useBuilderStore.getState();
    if (!activeChar) return;
    await checkBuilderItemFreshness(mechFolderFor(activeFolder), activeChar);
    await setActiveChar(activeChar, activeFolder, activeRarity);
  };

  useEffect(() => {
    DataLoader.initDatabases().then(async () => {
      // The Mechanics Builder only persists activeChar/editedMechanics across reloads, not the
      // derived `mechanics` working copy itself (see useBuilderStore's partialize) -- so a
      // reload that lands back on a previously-open entity needs this same freshness-check +
      // setActiveChar replay a grid click normally does, to rebuild it from a real fetch rather
      // than leaving the builder showing an empty/stale view for whatever was last open.
      await refreshActiveBuilderItem();
      setIsLoaded(true);
    });
  }, []);

  // "Tab regains focus" freshness check, scoped to whatever the active page actually has
  // loaded -- the Calculator checks the current roster's mechanic JSONs (silently evicting or,
  // if locally edited, raising a conflict via useFreshnessConflictStore); Rankings just
  // re-invokes load(), which now does its own freshness check internally and only actually
  // re-fetches if something changed; the Builder re-checks whatever entity is currently open the
  // same way. Other views have nothing worth checking on focus alone.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (currentView === 'calculator') {
        checkTeamFreshness(useRosterStore.getState().team);
      } else if (currentView === 'rankings') {
        useRankingsStore.getState().load();
      } else if (currentView === 'builder') {
        refreshActiveBuilderItem();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [currentView]);

  // Visibilitychange only fires on actual tab occlusion (switching tabs, minimizing) -- it does
  // NOT fire from simply clicking into another *window* (e.g. an editor open side-by-side with
  // the browser) since the page never actually stops being shown on screen. That's exactly the
  // Mechanics Builder's most common live-editing workflow, so it needs its own lightweight poll
  // rather than depending on a focus/visibility event that may never come. Cheap to run often:
  // DataLoader.refreshManifest() internally throttles the actual manifest.json fetch to once per
  // 5s no matter how many times it's called, so this just piggybacks on that.
  useEffect(() => {
    if (currentView !== 'builder') return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') refreshActiveBuilderItem();
    }, 3000);
    return () => clearInterval(interval);
  }, [currentView]);

  if (!isLoaded) {
    return (
      <div id="app-layout" className="flex-center" style={{ height: '100vh', color: 'var(--accent)' }}>
        Loading databases...
      </div>
    );
  }

  const guideItem = NAV_ITEMS.find(i => i.id === 'guide')!;

  return (
    <div id="app-layout">
      <Header currentView={currentView} onNavClick={navigate} />

      {currentView === 'landing' && <LandingPage onNavigate={navigate} />}

      {currentView === 'calculator' && (
        <div className="calculator-layout">
          <ResultsPanel collapsed={activeStep === 1} />
          <div className="calculator-steps">
            <TeamBuilder
              isOpen={activeStep === 1}
              onToggle={() => navigate('calculator', activeStep === 1 ? 2 : 1)}
            />
            <RotationBuilder
              isOpen={activeStep === 2}
              onToggle={() => navigate('calculator', activeStep === 2 ? 1 : 2)}
            />
          </div>
        </div>
      )}

      {currentView === 'builder' && <MechanicsBuilder />}

      {currentView === 'rankings' && <RotationRankingsPage />}

      {currentView === 'guide' && (
        <ComingSoonPage title={guideItem.label} description={guideItem.description} icon={guideItem.icon} />
      )}

      <FreshnessConflictDialog />
    </div>
  );
}
