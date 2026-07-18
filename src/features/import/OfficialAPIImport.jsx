import React, { useCallback, useState } from 'react';
import OfficialImportContent from './components/OfficialImportContent';
import { useOfficialImportController } from './useOfficialImportController';

export default function OfficialAPIImport({
  onImportComplete,
  onBack: _onBack,
  onOpenFileImport,
  onFetchStatusChange,
  userId,
  accountCompletionRequired = false,
  onOpenSettings,
}) {
  const [source, setSource] = useState('cn');

  const handleAutoSourceSwitch = useCallback((nextSource) => {
    setSource(nextSource);
  }, []);

  const {
    tokenInput,
    status,
    progress,
    statusMessage,
    importSummary,
    reviewRecords,
    reviewDecisions,
    userInfo,
    error,
    autoDetected,
    availableAccounts,
    queueStatus,
    retryInfo,
    sourceSwitchInfo,
    inputDetection,
    clipboardState,
    importMode,
    setImportMode,
    handleInputChange,
    handleClipboardRead,
    handleImport,
    handleAccountSelect,
    handleCancel,
    handleConfirmImport,
    handleReviewDecision,
    handleReset,
  } = useOfficialImportController({
    onImportComplete,
    onFetchStatusChange,
    onSourceSwitch: handleAutoSourceSwitch,
    userId,
    source
  });

  const handleSourceChange = useCallback((nextSource) => {
    if (nextSource === source) {
      return;
    }
    handleReset();
    setSource(nextSource);
  }, [handleReset, source]);

  return (
    <OfficialImportContent
      source={source}
      status={status}
      tokenInput={tokenInput}
      autoDetected={autoDetected}
      availableAccounts={availableAccounts}
      progress={progress}
      statusMessage={statusMessage}
      queueStatus={queueStatus}
      retryInfo={retryInfo}
      sourceSwitchInfo={sourceSwitchInfo}
      inputDetection={inputDetection}
      clipboardState={clipboardState}
      importMode={importMode}
      backendImportAvailable={Boolean(userId)}
      accountCompletionRequired={accountCompletionRequired}
      error={error}
      importSummary={importSummary}
      reviewRecords={reviewRecords}
      reviewDecisions={reviewDecisions}
      userInfo={userInfo}
      onSourceChange={handleSourceChange}
      onTokenChange={handleInputChange}
      onClipboardRead={handleClipboardRead}
      onImportModeChange={setImportMode}
      onStartImport={handleImport}
      onOpenSettings={onOpenSettings}
      onOpenFileImport={onOpenFileImport}
      onSelectAccount={handleAccountSelect}
      onCancel={handleCancel}
      onReset={handleReset}
      onConfirmImport={handleConfirmImport}
      onReviewDecision={handleReviewDecision}
    />
  );
}
