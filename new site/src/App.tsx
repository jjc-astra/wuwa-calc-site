// src/App.tsx
import { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { LandingPage } from './components/LandingPage';
import { ComingSoonPage } from './components/ComingSoonPage';
import { MechanicsBuilder } from './components/builder/MechanicsBuilder';
import { TeamBuilder } from './components/roster/TeamBuilder';
import { RotationBuilder } from './components/rotation/RotationBuilder';
import { DataLoader } from './utils/DataLoader';
import { NAV_ITEMS } from './config/nav';
import type { ViewId } from './config/nav';
import './assets/css/layout.css';
import './assets/css/components.css';
import './assets/css/builder.css';
import './assets/css/landing.css';

export default function App() {
  const [currentView, setCurrentView] = useState<ViewId>('landing');
  const [activeStep, setActiveStep] = useState<1 | 2>(1);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    DataLoader.initDatabases().then(() => setIsLoaded(true));
  }, []);

  if (!isLoaded) {
    return (
      <div id="app-layout" className="flex-center" style={{ height: '100vh', color: 'var(--accent)' }}>
        Loading databases...
      </div>
    );
  }

  const rankingsItem = NAV_ITEMS.find(i => i.id === 'rankings')!;
  const guideItem = NAV_ITEMS.find(i => i.id === 'guide')!;

  return (
    <div id="app-layout">
      <Header currentView={currentView} onNavClick={setCurrentView} />

      {currentView === 'landing' && <LandingPage onNavigate={setCurrentView} />}

      {currentView === 'calculator' && (
        <>
          <TeamBuilder
            isOpen={activeStep === 1}
            onToggle={() => setActiveStep(activeStep === 1 ? 2 : 1)}
          />
          <RotationBuilder
            isOpen={activeStep === 2}
            onToggle={() => setActiveStep(activeStep === 2 ? 1 : 2)}
          />
        </>
      )}

      {currentView === 'builder' && <MechanicsBuilder />}

      {currentView === 'rankings' && (
        <ComingSoonPage title={rankingsItem.label} description={rankingsItem.description} icon={rankingsItem.icon} />
      )}

      {currentView === 'guide' && (
        <ComingSoonPage title={guideItem.label} description={guideItem.description} icon={guideItem.icon} />
      )}
    </div>
  );
}
