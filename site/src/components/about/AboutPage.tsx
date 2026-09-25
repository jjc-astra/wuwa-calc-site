import React, { useState } from 'react';
import { MermaidDiagram } from './MermaidDiagram';
import { ActualSizeContext, NODE_KINDS } from './mermaidSetup';
import { DIAGRAMS } from './aboutDiagrams';

// Jump bar entries, in page order.
const SECTIONS = [
  ['layers', 'Architecture'],
  ['boot', 'Boot + routing'],
  ['step1', 'Team'],
  ['step2', 'Rotation UI'],
  ['recalc', 'Recalc + worker'],
  ['engine', 'Engine'],
  ['events', 'Events + effects'],
  ['damage', 'Damage'],
  ['results', 'Results'],
  ['builder', 'Builder'],
  ['dsl', 'DSL'],
  ['rankings', 'Rankings + timeline'],
  ['guide', 'Character Guide'],
  ['data', 'Data + ops']
] as const;

const sectionEl = (id: string) => document.getElementById(`about-${id}`);
const scrollToSection = (id: string) => sectionEl(id)?.scrollIntoView({ block: 'start' });

// In-page link to another section.
const SectionLink: React.FC<{ to: string; children: React.ReactNode }> = ({ to, children }) => (
  <button type="button" className="about-link" onClick={() => scrollToSection(to)}>{children}</button>
);

// One area of the codebase: header with an Actual size toggle, then notes and diagrams.
const AboutSection: React.FC<{ id: string; title: string; tag: string; children: React.ReactNode }> = ({ id, title, tag, children }) => {
  const [actualSize, setActualSize] = useState(false);
  return (
    <section id={`about-${id}`} className="section-wrapper about-section">
      <div className="section-header">
        <div className="header-left">
          <h2 className="section-title">{title}</h2>
          <span className="caps-tag text-dim">{tag}</span>
        </div>
        <button type="button" className="base-btn about-size-btn caps-tag" onClick={() => setActualSize(v => !v)}>
          {actualSize ? 'Fit to width' : 'Actual size'}
        </button>
      </div>
      <div className="about-section-body">
        <ActualSizeContext.Provider value={actualSize}>{children}</ActualSizeContext.Provider>
      </div>
    </section>
  );
};

/** About page: how the site works, one flowchart section per area of the codebase. */
export const AboutPage: React.FC = () => {
  // The jump bar highlights the last section whose top has scrolled past the top of the page.
  const [activeId, setActiveId] = useState<string | null>(null);
  // The jump bar's shadow only shows once content is scrolled under it.
  const [scrolled, setScrolled] = useState(false);
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrolled(e.currentTarget.scrollTop > 0);
    const top = e.currentTarget.getBoundingClientRect().top + 8;
    const passed = SECTIONS.filter(([id]) => (sectionEl(id)?.getBoundingClientRect().top ?? Infinity) <= top);
    setActiveId(passed.length ? passed[passed.length - 1][0] : null);
  };

  return (
    <div className="about-page">
      <nav className={`about-jump-bar ${scrolled ? 'is-scrolled' : ''}`}>
        {SECTIONS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`nav-item-btn ${activeId === id ? 'is-active' : ''}`}
            onClick={() => scrollToSection(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="about-scroll" onScroll={onScroll}>
        <div className="about-content">
          <div className="landing-hero about-hero">
            <h1><span className="accent">WuWa</span> Calculator Workflow</h1>
            <p>
              A React + Zustand app that simulates Wuthering Waves team rotations. Character, weapon and echo mechanics are data
              (JSON with a small DSL) fetched from a separate data repo; Web Workers run the simulation; everything a user builds
              persists to localStorage, and the Character Guide caches its results in IndexedDB. Each section below is one area of the codebase.
            </p>
            <div className="about-legend">
              {NODE_KINDS.map(k => (
                <span
                  key={k.id}
                  className="pill-badge caps-tag"
                  style={{ background: k.fill, borderColor: k.stroke, color: k.color, borderStyle: k.dash ? 'dashed' : 'solid' }}
                >
                  {k.label}
                </span>
              ))}
            </div>
          </div>

          <AboutSection id="layers" title="Architecture layers" tag="every folder in src/">
            <p className="about-note">Pages call stores; stores call the worker client and the data layer; the worker runs the pure logic. Some components also read logic and the DataLoader directly, for dropdowns and previews.</p>
            <MermaidDiagram source={DIAGRAMS.layers} />
          </AboutSection>

          <AboutSection id="boot" title="Boot, routing and shell" tag="main.tsx, App.tsx, useHashRoute, Header">
            <p className="about-note">Persisted stores restore as their modules load, before anything renders. Nothing but a loading line shows until <code>initDatabases</code> finishes. Views are hash routes (<code>#/calculator/step-2</code>, <code>#/guide/Lumi</code>), so back, forward and refresh work with no router. Refocus and poll checks are covered under <SectionLink to="data">Data + ops</SectionLink>.</p>
            <h3 className="about-subhead caps-tag">Startup</h3>
            <MermaidDiagram source={DIAGRAMS.bootStartup} />
            <h3 className="about-subhead caps-tag">Routing</h3>
            <MermaidDiagram source={DIAGRAMS.bootRouting} />
          </AboutSection>

          <AboutSection id="step1" title="Step 1: Build Team" tag="roster/, useRosterStore">
            <p className="about-note">Every roster edit lands in <code>useRotationStore.recalculate</code>. Most go through <code>commitTeam</code>, which first replays the team's Builder edits onto the DataLoader.</p>
            <h3 className="about-subhead caps-tag">Roster edits</h3>
            <MermaidDiagram source={DIAGRAMS.teamEdits} />
            <h3 className="about-subhead caps-tag">What the step shows</h3>
            <MermaidDiagram source={DIAGRAMS.teamDisplay} />
          </AboutSection>

          <AboutSection id="step2" title="Step 2: Build Rotation (the UI)" tag="rotation/, useRotationStore, HistoryManager">
            <p className="about-note">A rotation is a list of rows (unit, action, timing, offset) ending in a blank row. Every edit is a command, so it can be undone, and the undo history survives a reload. The action dropdown reads the row's state from the last engine run.</p>
            <h3 className="about-subhead caps-tag">The action dropdown</h3>
            <MermaidDiagram source={DIAGRAMS.rotationActions} />
            <h3 className="about-subhead caps-tag">Edits, commands and undo</h3>
            <MermaidDiagram source={DIAGRAMS.rotationEdits} />
            <h3 className="about-subhead caps-tag">Loop, repeat and Ending Rotation markers</h3>
            <MermaidDiagram source={DIAGRAMS.rotationMarkers} />
          </AboutSection>

          <AboutSection id="recalc" title="Live recalculation and the worker" tag="useRotationStore.runWorkerCalc, calcWorkerClient, calc.worker">
            <p className="about-note">Editing rows never prices damage: it sends a cheap <code>recalculate</code> for times, gauges, loop info and errors. Only Calculate sends <code>calculateDamage</code>. Each worker has its own DataLoader, so evictions and Builder edits travel with every request.</p>
            <h3 className="about-subhead caps-tag">The Calculator's round trip</h3>
            <MermaidDiagram source={DIAGRAMS.recalcRoundTrip} />
            <h3 className="about-subhead caps-tag">Inside calc.worker.ts</h3>
            <MermaidDiagram source={DIAGRAMS.recalcWorker} />
            <h3 className="about-subhead caps-tag">One-shot calcs and worker lanes</h3>
            <MermaidDiagram source={DIAGRAMS.recalcLanes} />
          </AboutSection>

          <AboutSection id="engine" title="Inside recalculateState" tag="logic/TimelineEngine.ts">
            <p className="about-note">One pass over the rows in order. Each row inherits the previous row's state, waits until it can go, works out how long it takes, is validated, then casts. Time only moves forward through <code>_decayState</code>, which lands queued hits and runs down timers on the way.</p>
            <h3 className="about-subhead caps-tag">The pass</h3>
            <MermaidDiagram source={DIAGRAMS.enginePass} />
            <h3 className="about-subhead caps-tag">Waits before a move</h3>
            <MermaidDiagram source={DIAGRAMS.engineWaits} />
            <h3 className="about-subhead caps-tag">Timings (_resolveTimings)</h3>
            <MermaidDiagram source={DIAGRAMS.engineTimings} />
            <h3 className="about-subhead caps-tag">Validation (_runValidation)</h3>
            <MermaidDiagram source={DIAGRAMS.engineValidation} />
            <h3 className="about-subhead caps-tag">The move and its hits</h3>
            <MermaidDiagram source={DIAGRAMS.engineMove} />
            <h3 className="about-subhead caps-tag">Finding and checking the loop</h3>
            <MermaidDiagram source={DIAGRAMS.engineLoop} />
          </AboutSection>

          <AboutSection id="events" title="Events, effects and the DSL at run time" tag="MechanicOwners, EventManager, ContextManager, TimelineEngine._processEffect">
            <p className="about-note">A mechanic node's <code>triggerRule</code> is a small language: <code>OnCast[Skill] IF condition</code>, or <code>ALWAYS</code>. Every engine run registers each owner's listeners again. The engine fires events as it goes, and whatever the listeners return runs as effects.</p>
            <h3 className="about-subhead caps-tag">Registering and emitting</h3>
            <MermaidDiagram source={DIAGRAMS.eventsEmit} />
            <h3 className="about-subhead caps-tag">Running an effect</h3>
            <MermaidDiagram source={DIAGRAMS.eventsEffects} />
          </AboutSection>

          <AboutSection id="damage" title="Pricing one hit" tag="logic/CombatCalculator.ts, combat/">
            <p className="about-note">The engine only queues hits with a snapshot of the state they landed in. Damage is priced afterwards, in order, so each hit sees the enemy HP the earlier hits left.</p>
            <MermaidDiagram source={DIAGRAMS.damage} />
          </AboutSection>

          <AboutSection id="results" title="Calculate, Results, History and Comparison" tag="ResultsCalculator, results/, useRotationHistoryStore, useComparisonStore">
            <p className="about-note">Only Calculate runs the full results. Results dim when rows change or a relevant Builder edit happens, until the next Calculate.</p>
            <h3 className="about-subhead caps-tag">Building RotationResults</h3>
            <MermaidDiagram source={DIAGRAMS.resultsCalculate} />
            <h3 className="about-subhead caps-tag">Results panel, History and comparison</h3>
            <MermaidDiagram source={DIAGRAMS.resultsPanel} />
            <h3 className="about-subhead caps-tag">Rotation files</h3>
            <MermaidDiagram source={DIAGRAMS.resultsFiles} />
          </AboutSection>

          <AboutSection id="builder" title="Mechanics Builder" tag="builder/, useBuilderStore">
            <p className="about-note">Edits are a log on top of the fetched (pristine) data. They apply to the live DataLoader right away and travel to the worker with every calculation, so the calculator always simulates the edited data.</p>
            <h3 className="about-subhead caps-tag">Opening an entity</h3>
            <MermaidDiagram source={DIAGRAMS.builderOpen} />
            <h3 className="about-subhead caps-tag">The edit log</h3>
            <MermaidDiagram source={DIAGRAMS.builderEditLog} />
          </AboutSection>

          <AboutSection id="dsl" title="DSL tooling" tag="logic/dsl/, combat/, utils/DSLHighlight">
            <p className="about-note"><code>dslRegistry.ts</code> is the single source of the language's vocabulary. The parser's translation maps, the autocomplete and the tooltips are all built from it, so a new property is added in one place.</p>
            <h3 className="about-subhead caps-tag">Compiling a rule</h3>
            <MermaidDiagram source={DIAGRAMS.dslCompile} />
            <h3 className="about-subhead caps-tag">One vocabulary</h3>
            <MermaidDiagram source={DIAGRAMS.dslVocabulary} />
          </AboutSection>

          <AboutSection id="rankings" title="Rotation Rankings and the Timeline" tag="rankings/, timeline/, useRankingsStore">
            <p className="about-note">The leaderboard reads one generated <code>index.json</code> of Default-build results, exported from the calculator and committed to the data repo. Nothing is simulated to build the list; a row's timeline recalculates that one entry when expanded.</p>
            <h3 className="about-subhead caps-tag">The list</h3>
            <MermaidDiagram source={DIAGRAMS.rankingsList} />
            <h3 className="about-subhead caps-tag">A row's timeline</h3>
            <MermaidDiagram source={DIAGRAMS.rankingsTimeline} />
          </AboutSection>

          <AboutSection id="guide" title="Character Guide" tag="guide/, useGuideSelectionStore, IndexedDB guide-cache">
            <p className="about-note">The guide has no data of its own. It regroups the ranked rotations that include a character, re-runs them on a chosen investment, and compares sequences, weapons, echo builds and set builds. Results are cached per character and dropped whole once anything they came from changes.</p>
            <h3 className="about-subhead caps-tag">From rankings to calc jobs</h3>
            <MermaidDiagram source={DIAGRAMS.guideJobs} />
            <h3 className="about-subhead caps-tag">Running and caching the jobs</h3>
            <MermaidDiagram source={DIAGRAMS.guideRun} />
          </AboutSection>

          <AboutSection id="data" title="Data, freshness, persistence and deployment" tag="DataLoader, dataFreshness, sw.js, GitHub Actions">
            <p className="about-note">Game data lives in its own repo and is fetched straight from GitHub. A manifest of content hashes tells the app when something it already loaded has changed, so a data update never needs a site redeploy.</p>
            <h3 className="about-subhead caps-tag">Loading</h3>
            <MermaidDiagram source={DIAGRAMS.dataLoading} />
            <h3 className="about-subhead caps-tag">Freshness: mechanics</h3>
            <MermaidDiagram source={DIAGRAMS.dataFreshness} />
            <h3 className="about-subhead caps-tag">Freshness: rankings and the guide cache</h3>
            <MermaidDiagram source={DIAGRAMS.dataResultsCache} />
            <h3 className="about-subhead caps-tag">Persistence and deployment</h3>
            <MermaidDiagram source={DIAGRAMS.dataPersistence} />
          </AboutSection>
        </div>
      </div>
    </div>
  );
};
