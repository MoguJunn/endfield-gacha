import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AiCollaboratorGrid from '../AiCollaboratorGrid.jsx';

vi.mock('../../../i18n/index.js', () => ({
  useI18n: () => ({ t: (key) => key }),
}));

describe('AiCollaboratorGrid', () => {
  it('renders the five current collaboration units in one desktop row', () => {
    const { container } = render(<AiCollaboratorGrid />);

    ['Claude', 'Gemini', 'Codex', 'DeepSeek', 'Kimi'].forEach((name) => {
      expect(screen.getByText(name)).toBeInTheDocument();
    });
    ['OPUS 5', '3.7 FLASH', 'GPT-5.6 SOL', 'V4 PRO', 'K3'].forEach((version) => {
      expect(screen.getByText(version)).toBeInTheDocument();
    });
    expect(container.firstChild).toHaveClass('grid-cols-5');
    const officialIcons = screen.getAllByRole('img');
    expect(officialIcons).toHaveLength(5);
    expect(screen.getByLabelText('Claude official icon').tagName).toBe('svg');
    expect(screen.getByAltText('Codex official icon')).toHaveAttribute(
      'data-brand-source',
      'https://marketplace.visualstudio.com/items?itemName=openai.chatgpt'
    );
    expect(screen.getByAltText('DeepSeek official icon')).toHaveAttribute(
      'src',
      'https://api-docs.deepseek.com/img/favicon.svg'
    );
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });

  it('keeps all five mobile cards in a single horizontally scrollable row', () => {
    const { container } = render(<AiCollaboratorGrid mobile />);

    expect(container.firstChild).toHaveClass('flex-nowrap', 'overflow-x-auto');
    expect(container.querySelectorAll('article')).toHaveLength(5);
  });
});
