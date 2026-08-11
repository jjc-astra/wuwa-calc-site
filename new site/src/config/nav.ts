// src/config/nav.ts
import type { ComponentType } from 'react';
import type { IconProps } from '../components/common/icons';
import { CalculatorIcon, BuilderIcon, RankingsIcon, GuideIcon } from '../components/common/icons';

export type ViewId = 'landing' | 'calculator' | 'builder' | 'rankings' | 'guide';

export interface NavItem {
  id: ViewId;
  label: string;
  description: string;
  icon: ComponentType<IconProps>;
  comingSoon?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  {
    id: 'calculator',
    label: 'Rotation Calculator',
    description: 'Build a team rotation and calculate its total damage output.',
    icon: CalculatorIcon
  },
  {
    id: 'builder',
    label: 'Mechanics Builder',
    description: 'Author and edit the DSL-driven character mechanics used by the calculator.',
    icon: BuilderIcon
  },
  {
    id: 'rankings',
    label: 'Rotation Rankings',
    description: 'Leaderboards comparing optimized rotations across teams and characters.',
    icon: RankingsIcon,
    comingSoon: true
  },
  {
    id: 'guide',
    label: 'Character Guide',
    description: 'In-depth character breakdowns, build recommendations, and playstyle tips.',
    icon: GuideIcon,
    comingSoon: true
  }
];
