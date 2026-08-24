import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AFDIAN_SUPPORT_TIERS, DONATION_LEDGER, DONATION_PLATFORM_URL } from '../../../constants/donations.js';
import DonationThanksCard from '../DonationThanksCard.jsx';
import DonationThanksPage from '../DonationThanksPage.jsx';

vi.mock('../../../i18n/index.js', () => ({
  useI18n: () => ({
    isEnglish: false,
    t: (key, params = {}) => `${key}:${JSON.stringify(params)}`,
  }),
}));

describe('DonationThanksCard', () => {
  it('renders a generic scrollable donation ledger with supporter avatars beside names', () => {
    render(
      <MemoryRouter>
        <DonationThanksCard />
      </MemoryRouter>
    );

    const supporterAvatar = screen.getByAltText('Neptune');
    expect(supporterAvatar).toHaveAttribute('src', '/neptune.jpg');
    expect(supporterAvatar).toHaveClass('h-5', 'w-5');
    expect(supporterAvatar.closest('article')).toHaveTextContent('Neptune');
    expect(supporterAvatar.closest('[class*="overflow-y-auto"]')).toBeInTheDocument();
    expect(screen.getByText(/home.donation.summary/)).toBeInTheDocument();
    expect(screen.getAllByText('¥200')).toHaveLength(2);
    expect(DONATION_LEDGER[0]).toMatchObject({ name: 'Neptune', pinned: true });
    expect(screen.getByText(/home.donation.pinned/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /home.donation.amountLink/ })).toHaveClass(
      'donation-rainbow-amount'
    );
    expect(screen.getByRole('link', { name: /home.donation.action/ })).toHaveAttribute(
      'href',
      DONATION_PLATFORM_URL
    );
    expect(screen.getByRole('link', { name: /home.donation.ledgerAction/ })).toHaveAttribute(
      'href',
      '/donations'
    );
    expect(screen.getByRole('button', { name: /home.donation.groupAction/ })).toBeInTheDocument();
  });

  it('renders the complete donation process and ledger page', () => {
    render(
      <MemoryRouter>
        <DonationThanksPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Neptune')).toBeInTheDocument();
    expect(screen.getAllByText('¥200').length).toBeGreaterThan(0);
    expect(screen.getByText(/donations.process.received.title/)).toBeInTheDocument();
    expect(screen.getByText(/donations.processTitle/)).toBeInTheDocument();
    expect(AFDIAN_SUPPORT_TIERS.map((tier) => tier.amountCny)).toEqual([6, 12, 32, 70, 125]);
    AFDIAN_SUPPORT_TIERS.forEach((tier) => {
      expect(screen.getByText(`¥${tier.amountCny}`)).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /donations.supportAction/ })).toHaveAttribute(
      'href',
      DONATION_PLATFORM_URL
    );
  });
});
