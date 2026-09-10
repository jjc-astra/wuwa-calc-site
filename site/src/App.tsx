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

  // Re-checks the Builder's open entity against the manifest, replaying setActiveChar if it
  // changed. `force` skips the "did anything change" gate -- needed at mount (mechanics/baseStats
  // aren't persisted), but elsewhere a no-op replay still flickers JsonOutputPane's highlight.
  const refreshActiveBuilderItem = async (force = false) => {
    const { activeChar, activeFolder, activeRarity, setActiveChar } = useBuilderStore.getState();
    if (!activeChar) return;
    const evicted = await checkBuilderItemFreshness(mechFolderFor(activeFolder), activeChar);
    if (force || evicted.length > 0) await setActiveChar(activeChar, activeFolder, activeRarity);
  };

  useEffect(() => {
    DataLoader.initDatabases().then(async () => {
      // A reload only persists activeChar, not the derived `mechanics` working copy, so it
      // needs the same freshness-check + replay a grid click normally does.
      await refreshActiveBuilderItem(true);
      setIsLoaded(true);
    });
  }, []);

  // "Tab regains focus" freshness check, scoped to whatever the active page has loaded.
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

  // visibilitychange doesn't fire for a side-by-side editor window, the Builder's most common
  // live-editing setup, so it needs its own poll instead. Cheap: refreshManifest self-throttles.
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
