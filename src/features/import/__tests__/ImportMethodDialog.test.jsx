import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ImportMethodDialog from '../ImportMethodDialog.jsx';

const language = vi.hoisted(() => ({ locale: 'zh-CN' }));
vi.mock('../../../i18n/index.js', () => ({ useI18n: () => language }));
beforeEach(() => { language.locale = 'zh-CN'; });

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() {
    this.setAttribute('open', '');
    this.querySelector('button').focus();
  } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
});
afterEach(cleanup);
afterAll(() => {
  if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal);
  else delete HTMLDialogElement.prototype.showModal;
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  else delete HTMLDialogElement.prototype.close;
});

describe('ImportMethodDialog', () => {
  it.each([
    ['同步官方记录', 'onOfficial'], ['导入文件', 'onFile'], ['手动补录', 'onManual'],
  ])('offers all three choices and dispatches %s independently', (label, callback) => {
    const handlers = { onClose: vi.fn(), onOfficial: vi.fn(), onFile: vi.fn(), onManual: vi.fn() };
    render(<ImportMethodDialog {...handlers} />);
    expect(screen.getByRole('dialog', { name: '选择导入方式' })).toBeVisible();
    for (const choice of ['同步官方记录', '导入文件', '手动补录']) {
      expect(screen.getByRole('button', { name: new RegExp(choice) })).toBeEnabled();
    }
    fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }));
    for (const [name, handler] of Object.entries(handlers)) {
      expect(handler).toHaveBeenCalledTimes(name === callback ? 1 : 0);
    }
  });

  it('uses the application English locale for all import choices', () => {
    language.locale = 'en-US';
    render(<ImportMethodDialog onClose={vi.fn()} onOfficial={vi.fn()} onFile={vi.fn()} onManual={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Choose an import method' })).toBeVisible();
    for (const label of ['Sync official records', 'Import a file', 'Enter records manually']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeEnabled();
    }
  });

  it('handles native Escape cancellation through onClose', () => {
    const onClose = vi.fn();
    render(<ImportMethodDialog onClose={onClose} onOfficial={vi.fn()} onFile={vi.fn()} onManual={vi.fn()} />);
    const event = new Event('cancel', { cancelable: true });
    fireEvent(screen.getByRole('dialog'), event);
    expect(event.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('restores focus and body overflow when unmounted', () => {
    const { unmount: removeTrigger } = render(<button>入口</button>);
    const trigger = screen.getByRole('button', { name: '入口' });
    trigger.focus();
    const { unmount } = render(<ImportMethodDialog onClose={vi.fn()} onOfficial={vi.fn()} onFile={vi.fn()} onManual={vi.fn()} />);
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
    removeTrigger();
  });
});
