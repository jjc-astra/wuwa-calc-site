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
import { checkTeamFreshness } from './utils/dataFreshness';
import { useRosterStore } from './store/useRosterStore';
import { useRankingsStore } from './store/useRankingsStore';
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

  useEffect(() => {
    DataLoader.initDatabases().then(() => setIsLoaded(true));
  }, []);

  // "Tab regains focus" freshness check, scoped to whatever the active page actually has
  // loaded -- the Calculator checks the current roster's mechanic JSONs (silently evicting or,
  // if locally edited, raising a conflict via useFreshnessConflictStore); Rankings just
  // re-invokes load(), which now does its own freshness check internally and only actually
  // re-fetches if something changed. Other views have nothing worth checking on focus alone.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (currentView === 'calculator') {
        checkTeamFreshness(useRosterStore.getState().team);
      } else if (currentView === 'rankings') {
        useRankingsStore.getState().load();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
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
