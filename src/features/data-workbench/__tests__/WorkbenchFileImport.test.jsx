import React, { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorkbenchFileImport from '../WorkbenchFileImport.jsx';

const state = vi.hoisted(() => ({ pendingImport: null, handleImportFile: vi.fn(), setPendingImport: vi.fn(), confirmImport: vi.fn() }));
vi.mock('../../../hooks', () => ({
  useToast: () => ({ toasts: [], showToast: vi.fn(), removeToast: vi.fn() }),
  useCloudSync: () => ({}),
  useDataExportImport: () => ({ ...state }),
}));
vi.mock('../../../components/ui', () => ({ Toast: () => null }));
vi.mock('../../../components/modals/DataImportWizardModal.jsx', () => ({ default: ({ isOpen }) => isOpen ? <div>文件选择</div> : null }));
vi.mock('../../../components/modals/GachaModals.jsx', () => ({ default: ({ setPendingImport }) => <div>
  <p>常规导入预览</p><button onClick={() => setPendingImport(null)}>取消预览</button>
</div> }));
afterEach(() => { cleanup(); state.pendingImport = null; vi.clearAllMocks(); });

describe('original file handoff', () => {
  it('parses a selected file only once under StrictMode and waits for confirmation', () => {
    const file = new File(['{}'], '抽卡记录.txt');
    const onClose = vi.fn();
    const view = render(<StrictMode><WorkbenchFileImport initialFile={file} onClose={onClose} /></StrictMode>);
    expect(state.handleImportFile).toHaveBeenCalledTimes(1);
    expect(state.handleImportFile.mock.calls[0][0].target.files).toEqual([file]);
    state.pendingImport = { data: { history: [{}] } };
    view.rerender(<StrictMode><WorkbenchFileImport initialFile={file} onClose={onClose} /></StrictMode>);
    expect(screen.getByText('常规导入预览')).toBeInTheDocument();
    expect(screen.queryByText('文件选择')).not.toBeInTheDocument();
    expect(state.confirmImport).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消预览' }));
    expect(state.setPendingImport).toHaveBeenCalledWith(null);
    state.pendingImport = null;
    view.rerender(<StrictMode><WorkbenchFileImport initialFile={file} onClose={onClose} /></StrictMode>);
    expect(state.handleImportFile).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
