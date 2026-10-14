import React from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useImportMethodSelection } from '../useImportMethodSelection.js';

afterEach(cleanup);
function renderSelection(url, options) {
  function Wrapper({ children }) { return <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>; }
  return renderHook(() => ({ ...useImportMethodSelection(options), location: useLocation() }), { wrapper: Wrapper });
}

describe('useImportMethodSelection', () => {
  it('keeps the default view closed and opens choices before official import', () => {
    const { result } = renderSelection('/dashboard');
    expect(result.current.method).toBe('');
    act(() => result.current.openChooser());
    expect(result.current.method).toBe('choose');
    act(() => result.current.chooseOfficial());
    expect(result.current.method).toBe('official');
    expect(result.current.location.pathname).toBe('/dashboard');
    act(() => result.current.close());
    expect(result.current.method).toBe('');
  });

  it.each(['choose', 'open'])('opens choices for import=%s and clears only that query on close', (query) => {
    const { result } = renderSelection(`/dashboard?import=${query}&poolId=p1#records`);
    expect(result.current.method).toBe('choose');
    act(() => result.current.close());
    expect(result.current.method).toBe('');
    expect(result.current.location.search).toBe('?poolId=p1');
    expect(result.current.location.hash).toBe('#records');
  });

  it('delegates file import to the existing callback and dismisses choices', () => {
    const onOpenFileImport = vi.fn();
    const { result } = renderSelection('/dashboard?import=choose', { onOpenFileImport });
    act(() => result.current.chooseFile());
    expect(onOpenFileImport).toHaveBeenCalledOnce();
    expect(result.current.method).toBe('');
    expect(result.current.location.search).toBe('');
  });

  it('opens the existing file module locally when the selector has no file callback', () => {
    const { result } = renderSelection('/m/details?import=choose');
    act(() => result.current.chooseFile());
    expect(result.current.method).toBe('file');
    expect(result.current.location.pathname).toBe('/m/details');
    expect(result.current.location.search).toBe('');
    act(() => result.current.close());
    expect(result.current.method).toBe('');
  });

  it.each([
    ['/dashboard', '/data-workbench'], ['/m/details', '/m/data-workbench'],
  ])('navigates manual import from %s to the correct workbench', (from, to) => {
    const { result } = renderSelection(`${from}?import=choose`);
    act(() => result.current.chooseManual());
    expect(result.current.location.pathname).toBe(to);
    expect(result.current.location.search).toBe('');
    expect(result.current.method).toBe('');
  });
});
