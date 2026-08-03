import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  verify: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('../../../i18n/index.js', () => ({
  useI18n: () => ({
    locale: 'zh-CN',
    t: (key, values = {}) => `${key}${values.email ? `:${values.email}` : ''}`,
  }),
}));

vi.mock('../../../services/accountEmailService.js', () => ({
  prepareOAuthEmailArtifactMerge: mocks.prepare,
  verifyOAuthEmailArtifactMerge: mocks.verify,
  confirmOAuthEmailArtifactMerge: mocks.confirm,
}));

import OAuthEmailMergeFlow from '../OAuthEmailMergeFlow.jsx';

describe('OAuthEmailMergeFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prepare.mockResolvedValue({
      data: {
        mergeIntentId: 'intent-1',
        maskedEmail: 'l***y@example.com',
      },
    });
    mocks.verify.mockResolvedValue({
      data: {
        status: 'verified',
        maskedEmail: 'l***y@example.com',
      },
    });
    mocks.confirm.mockResolvedValue({
      data: {
        email: 'legacy@example.com',
      },
      session: {
        authenticated: true,
        user: { id: 'source-user', email: 'legacy@example.com' },
      },
    });
  });

  it('requires email proof and a separate explicit confirmation', async () => {
    const onCompleted = vi.fn();
    const onDone = vi.fn();
    render(
      <OAuthEmailMergeFlow
        targetEmail="legacy@example.com"
        initialMaskedEmail="l***y@example.com"
        onCompleted={onCompleted}
        onDone={onDone}
      />
    );

    fireEvent.click(screen.getByText('settings.oauthEmailMerge.startAction'));
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledWith({
      email: 'legacy@example.com',
      locale: 'zh-CN',
    }));

    const input = await screen.findByPlaceholderText('000000');
    fireEvent.change(input, { target: { value: '12-34-56' } });
    expect(input).toHaveValue('123456');
    expect(mocks.confirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('settings.oauthEmailMerge.verifyAction'));
    await waitFor(() => expect(mocks.verify).toHaveBeenCalledWith({
      intentId: 'intent-1',
      code: '123456',
    }));
    expect(await screen.findByText(/settings\.oauthEmailMerge\.confirm\.keepCurrent/)).toBeInTheDocument();
    expect(mocks.confirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('settings.oauthEmailMerge.confirmAction'));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith({
      intentId: 'intent-1',
    }));
    expect(onCompleted).toHaveBeenCalledWith(expect.objectContaining({
      session: expect.objectContaining({ authenticated: true }),
    }));

    fireEvent.click(await screen.findByText('settings.oauthEmailMerge.doneAction'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
