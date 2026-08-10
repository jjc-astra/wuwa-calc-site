// src/App.tsx
import { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { MechanicsBuilder } from './components/builder/MechanicsBuilder';
import { TeamBuilder } from './components/roster/TeamBuilder';
import { RotationBuilder } from './components/rotation/RotationBuilder';
import { DataLoader } from './utils/DataLoader';
import './assets/css/layout.css';
import './assets/css/components.css';
import './assets/css/builder.css';

export default function App() {
  const [currentView, setCurrentView] = useState<'calculator' | 'builder'>('calculator');
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

  return (
    <div id="app-layout">
      <Header currentView={currentView} onNavClick={setCurrentView} />
      
      {currentView === 'calculator' ? (
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
      ) : (
        <MechanicsBuilder />
      )}
    </div>
  );
}