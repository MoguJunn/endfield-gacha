// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import SimpleMarkdown from '../SimpleMarkdown.jsx';

function renderMarkdown(content) {
  return render(
    <MemoryRouter>
      <SimpleMarkdown content={content} />
    </MemoryRouter>
  );
}

describe('SimpleMarkdown security boundary', () => {
  it('drops scripts, event handlers, arbitrary styles, and private images', () => {
    const { container } = renderMarkdown([
      '<script>window.__xss = true</script>',
      '<img src="https://127.0.0.1/private.png" onerror="window.__xss=true" style="position:fixed;inset:0" alt="private">',
    ].join('\n'));

    expect(container.querySelector('script')).toBeNull();
    expect(screen.queryByAltText('private')).toBeNull();
    expect(globalThis.__xss).toBeUndefined();
  });

  it('keeps approved images bounded and strips unsafe links', () => {
    renderMarkdown([
      '![safe](/avatars/characters/example.webp "=9999x9999")',
      '[unsafe](javascript:alert(1))',
    ].join('\n'));

    const image = screen.getByAltText('safe');
    expect(image.getAttribute('src')).toBe('/avatars/characters/example.webp');
    expect(image.style.width).toBe('1600px');
    expect(image.style.height).toBe('1600px');
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(screen.getByText('unsafe').closest('a')).toBeNull();
  });
});
