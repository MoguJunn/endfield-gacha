import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ResourceSummaryPanel from '../ResourceSummaryPanel.jsx';

vi.mock('../../../i18n/index.js', () => ({
  useI18n: () => ({
    locale: 'zh-CN',
    t: (key) => key,
    formatNumber: (value) => String(value),
  }),
}));

const resources = {
  jadeSpent: 100,
  originiteEquivalent: 2,
  arsenalGained: 2220,
  arsenalSpent: 198,
  aicQuotaDirect: 10,
  aicQuotaConvertible: 20,
  bondQuotaDirect: 30,
  endpointQuotaConvertible: 40,
};

describe('ResourceSummaryPanel', () => {
  it('shows arsenal quota gains for character and combined summaries', () => {
    const { rerender } = render(
      <ResourceSummaryPanel resources={resources} variant="character" />
    );

    expect(screen.getByText('dashboard.resources.arsenalGained')).toBeInTheDocument();
    expect(screen.getByText('2220')).toBeInTheDocument();

    rerender(<ResourceSummaryPanel resources={resources} variant="all" />);
    expect(screen.getByText('dashboard.resources.arsenalGained')).toBeInTheDocument();
  });

  it('keeps weapon summaries focused on arsenal quota spending', () => {
    render(<ResourceSummaryPanel resources={resources} variant="weapon" />);

    expect(screen.getByText('dashboard.resources.arsenalSpent')).toBeInTheDocument();
    expect(screen.queryByText('dashboard.resources.arsenalGained')).not.toBeInTheDocument();
  });
});
