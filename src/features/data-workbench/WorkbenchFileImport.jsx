import React from 'react';
import { useCloudSync, useDataExportImport, useToast } from '../../hooks';
import DataImportWizardModal from '../../components/modals/DataImportWizardModal.jsx';
import GachaModals from '../../components/modals/GachaModals.jsx';
import { Toast } from '../../components/ui';

// Reuse the existing parser, account confirmation and persistence flow on both platforms.
export default function WorkbenchFileImport({ onClose }) {
  const { toasts, showToast, removeToast } = useToast();
  const cloudSync = useCloudSync({ showToast });
  const { pendingImport, setPendingImport, handleImportFile, confirmImport } = useDataExportImport({
    showToast,
    cloudSync,
  });
  return (
    <>
      <DataImportWizardModal isOpen={!pendingImport} onClose={onClose} onImportFile={handleImportFile} />
      {pendingImport && (
        <GachaModals
          pendingImport={pendingImport}
          setPendingImport={(next) => {
            setPendingImport(next);
            if (!next) onClose();
          }}
          confirmImport={confirmImport}
          knownDrawers={[]}
          toasts={[]}
          confirmState={{ isOpen: false }}
          canEdit={false}
        />
      )}
      <Toast toasts={toasts} onRemove={removeToast} />
    </>
  );
}
