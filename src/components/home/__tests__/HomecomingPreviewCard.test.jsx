import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomecomingPreviewCard, {
  VERSION_PREVIEW_VIDEO_URL,
  VERSION_RESOURCE_IMAGE_URL,
} from '../HomecomingPreviewCard.jsx';

vi.mock('../../../i18n/index.js', () => ({
  useI18n: () => ({
    isEnglish: false,
    t: (key) => key,
  }),
}));

describe('HomecomingPreviewCard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the current version art, official video, and embedded launch countdown', () => {
    render(
      <HomecomingPreviewCard
        targetDate="2026-08-27T05:07:09.000Z"
        title="Version 1.2"
      />
    );

    expect(screen.getByRole('img')).toHaveAttribute('src', VERSION_RESOURCE_IMAGE_URL);
    expect(screen.getByRole('link', { name: /home.versionPreview.videoAction/ })).toHaveAttribute(
      'href',
      VERSION_PREVIEW_VIDEO_URL
    );
    expect(screen.getByText('02')).toBeInTheDocument();
    expect(screen.getByText('05')).toBeInTheDocument();
    expect(screen.getByText('07')).toBeInTheDocument();
    expect(screen.getByText('09')).toBeInTheDocument();
  });
});
