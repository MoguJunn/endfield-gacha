import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useCloudSync, useDataExportImport, useToast } from '../../hooks';
import DataImportWizardModal from '../../components/modals/DataImportWizardModal.jsx';
import GachaModals from '../../components/modals/GachaModals.jsx';
import { Toast } from '../../components/ui';

// Reuse the existing parser, account confirmation and persistence flow on both platforms.
export default function WorkbenchFileImport({ initialFile = null, onClose }) {
  const { toasts, showToast, removeToast } = useToast();
  const cloudSync = useCloudSync({ showToast });
  const { pendingImport, setPendingImport, handleImportFile, confirmImport } = useDataExportImport({
    showToast,
    cloudSync,
  });
  const openedFile = useRef(null);
  const hadPreview = useRef(false);
  useEffect(() => {
    if (!initialFile || openedFile.current === initialFile) return;
    openedFile.current = initialFile;
    handleImportFile({ target: { files: [initialFile], value: '' } });
  }, [handleImportFile, initialFile]);
  useEffect(() => {
    if (pendingImport) hadPreview.current = true;
    else if (hadPreview.current) onClose();
  }, [onClose, pendingImport]);
  return (
    <>
      <DataImportWizardModal isOpen={!pendingImport} onClose={onClose} onImportFile={handleImportFile} />
      {pendingImport && createPortal(
        <GachaModals
          pendingImport={pendingImport}
          setPendingImport={setPendingImport}
          confirmImport={confirmImport}
          knownDrawers={[]}
          toasts={[]}
          confirmState={{ isOpen: false }}
          canEdit={false}
        />, document.body
      )}
      <Toast toasts={toasts} onRemove={removeToast} />
    </>
  );
}
