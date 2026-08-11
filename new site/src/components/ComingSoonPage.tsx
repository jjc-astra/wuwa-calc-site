// src/components/ComingSoonPage.tsx
import React from 'react';
import type { ComponentType } from 'react';
import type { IconProps } from './common/icons';

interface ComingSoonPageProps {
  title: string;
  description: string;
  icon: ComponentType<IconProps>;
}

export const ComingSoonPage: React.FC<ComingSoonPageProps> = ({ title, description, icon: Icon }) => {
  return (
    <div className="coming-soon-page">
      <span className="coming-soon-icon">
        <Icon size={48} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      <span className="coming-soon-badge">Coming Soon</span>
    </div>
  );
};
