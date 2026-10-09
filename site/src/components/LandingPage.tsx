import React from 'react';
import { NAV_ITEMS } from '../config/nav';
import type { ViewId } from '../config/nav';
import { guidePath, viewPath } from '../config/routes';
import { goTo } from '../hooks/useRoute';
import { IMAGE_FOLDERS, LATEST_CHARACTERS, SITE_LINKS } from '../data/db';
import { DataLoader } from '../utils/DataLoader';
import { RouteLink } from './common/RouteLink';
import { LibraryCard } from './common/LibraryGrid';

interface LandingPageProps {
  onNavigate: (view: ViewId) => void;
  // The databases have loaded: Latest Characters reads rarities from the character DB.
  dataReady: boolean;
}

// An in-app page link inside an FAQ answer.
const PageLink: React.FC<{ view: ViewId; children: React.ReactNode }> = ({ view, children }) => (
  <RouteLink href={viewPath(view)} onNavigate={() => goTo(viewPath(view))}>{children}</RouteLink>
);

const DataRepoLink: React.FC = () => (
  <a href={SITE_LINKS.DATA_REPO_URL} target="_blank" rel="noopener noreferrer">wuwa-calc-data</a>
);

// Also the page's crawlable description of what the calculator does, and where to go for what.
const FAQ: { question: string; answer: React.ReactNode }[] = [
  {
    question: 'What is WuWa Calculator?',
    answer: 'A free Wuthering Waves rotation simulator. It plays a team’s rotation hit by hit and reports total damage, DPS, damage over time, per-character and per-skill contribution, substat worth, and a timeline of the whole fight. The questions below cover where to start, depending on what you’re after.'
  },
  {
    question: 'I just want to see results. Where do I look?',
    answer: <>
      The <PageLink view="guide">Character Guide</PageLink> turns ranked rotations into per-character builds and team
      comparisons, including sequence, weapon and echo comparisons. <PageLink view="rankings">Rotation Rankings</PageLink> are
      the leaderboards behind it, comparing optimized rotations and DPS across teams and characters.
    </>
  },
  {
    question: 'How do I design a rotation for a character?',
    answer: <>
      Open the <PageLink view="calculator">Rotation Calculator</PageLink>. In Build Team, pick up to three characters and set
      each one’s weapon, sequence, echo layout, main echo and sonata sets, or load a recommended build. In Build Rotation,
      add each move (basic and heavy attacks, skills, liberations, intros, outros, echo skills) in the order you play them.
      Results update as you edit, and you can pin a rotation to compare it against another. Rotations that are legal in game
      can be submitted to the rankings as a pull request on <DataRepoLink />.
    </>
  },
  {
    question: 'How do I add or edit a character’s mechanics?',
    answer: <>
      Use the <PageLink view="builder">Mechanics Builder</PageLink>: every character, weapon, echo and sonata set the
      calculator runs on is authored there, and you can inspect or edit any of them. Edits apply to your own calculator
      straight away. Finished implementations can be contributed as a pull request on <DataRepoLink />.
    </>
  },
  {
    question: 'How does the Wuthering Waves damage calculation work?',
    answer: 'Each character, weapon, echo and sonata set is described as mechanics data: its skill multipliers, buffs, resources and conditions. The calculator plays the rotation through those mechanics in order, tracking which buffs are active at each hit, then applies the damage formula: the scaling stat (ATK, HP or DEF) times the skill multiplier, damage bonus, amplification, crit, and the enemy DEF and RES multipliers.'
  },
  {
    question: 'Is it free? Do I need an account?',
    answer: 'It is free, with no account or sign-in. Your teams, rotations and settings are saved in your browser.'
  }
];

// LATEST_CHARACTERS, each opening its guide.
const LatestCharacters: React.FC = () => (
  <>
    {LATEST_CHARACTERS.map(name => (
      <LibraryCard
        key={name}
        itemName={name}
        imgFolder={IMAGE_FOLDERS.CHARACTERS}
        rarity={DataLoader.characterDB[name]?.rarity || 5}
        onClick={() => goTo(guidePath(name))}
      />
    ))}
  </>
);

/** The home page: hero and a card per page on the left; latest characters and an FAQ on the right. */
export const LandingPage: React.FC<LandingPageProps> = ({ onNavigate, dataReady }) => {
  return (
    <div className="landing-page">
      <div className="landing-main">
        <div className="landing-hero">
          <h1>
            <span className="accent">WuWa</span> Calculator
          </h1>
          <p>A Wuthering Waves damage calculator and team rotation simulator, for planning, building, and optimizing team rotations.</p>
        </div>

        <div className="landing-grid">
          {NAV_ITEMS.map(item => (
            <RouteLink
              key={item.id}
              className="landing-card"
              href={viewPath(item.id)}
              onNavigate={() => onNavigate(item.id)}
            >
              <span className="landing-card-icon">
                <item.icon size={24} />
              </span>
              <h3>{item.label}</h3>
              <p>{item.description}</p>
            </RouteLink>
          ))}
        </div>
      </div>

      <div className="landing-side">
        <section className="landing-section">
          <h2 className="panel-header-main">Latest added characters</h2>
          <div className="landing-latest-grid">
            {dataReady && <LatestCharacters />}
          </div>
        </section>

        <section className="landing-section landing-faq">
          <h2 className="panel-header-main">FAQ</h2>
          {FAQ.map(({ question, answer }) => (
            // Shared name: the browser keeps only one answer open at a time.
            <details key={question} name="landing-faq">
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
        </section>
      </div>
    </div>
  );
};
