import { useMemo } from 'react';
import useShareActionFeedback from '../../hooks/useShareActionFeedback.js';
import { useI18n } from '../../i18n/index.js';
import { copyToClipboard } from '../../utils/simulatorStorage.js';
import {
  buildSimulatorShareFile,
  buildSimulatorShareText,
  canCopyImageToClipboard,
  canNativeShareSimulatorFile,
  copyImageBlobToClipboard,
  downloadSimulatorShareCard,
  renderSimulatorShareCardToBlob,
  shareSimulatorShareCardFile,
} from '../../utils/simulatorShare.js';

export function useSimulatorSharing(sharePayload, showToastMessage) {
  const { t, locale } = useI18n();
  const feedback = useShareActionFeedback();
  const supportsClipboardImageCopy = useMemo(() => canCopyImageToClipboard(), []);
  const supportsNativeImageShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const copyText = async () => {
    if (!feedback.beginAction('copy-text', t('simulator.share.progress.copyText'))) return;
    try {
      const success = await copyToClipboard(buildSimulatorShareText(sharePayload, locale));
      const message = t(success ? 'simulator.share.copyTextSuccess' : 'simulator.share.copyTextFailure');
      if (success) feedback.finishAction('copy-text', message);
      else feedback.failAction('copy-text', message);
      showToastMessage(message);
    } catch {
      const message = t('simulator.share.copyTextFailure');
      feedback.failAction('copy-text', message);
      showToastMessage(message);
    }
  };
  const image = async (node, action) => {
    if (!feedback.beginAction(action, t('simulator.share.progress.generateImage'))) return;
    try {
      if (!node) throw new Error('not_ready');
      const blob = await renderSimulatorShareCardToBlob(node);
      let success;
      let message;
      if (
        action === 'share' &&
        supportsNativeImageShare &&
        canNativeShareSimulatorFile(buildSimulatorShareFile(blob, sharePayload))
      ) {
        feedback.updateAction(action, t('simulator.share.progress.openSystemShare'));
        await shareSimulatorShareCardFile(buildSimulatorShareFile(blob, sharePayload), sharePayload, locale);
        success = true;
        message = t('simulator.share.systemOpened');
      } else if (action === 'copy-image') {
        success = supportsClipboardImageCopy && (await copyImageBlobToClipboard(blob));
        message = t(success ? 'simulator.share.copyImageSuccess' : 'simulator.share.copyImageFailure');
      } else {
        success = downloadSimulatorShareCard(blob, sharePayload);
        message = t(success ? 'simulator.share.downloadSuccess' : 'simulator.share.downloadFailure');
      }
      if (success) feedback.finishAction(action, message);
      else feedback.failAction(action, message);
      showToastMessage(message);
    } catch (error) {
      if (error?.name === 'AbortError') {
        feedback.resetFeedback();
        return;
      }
      const message = t('simulator.share.generateFailure');
      feedback.failAction(action, message);
      showToastMessage(message);
    }
  };
  return {
    shareActionFeedback: feedback.feedback,
    isShareActionBusy: feedback.isBusy,
    supportsClipboardImageCopy,
    supportsNativeImageShare,
    handleCopyShareText: copyText,
    handleShareImage: (node) => image(node, 'share'),
    handleDownloadShareImage: (node) => image(node, 'download'),
    handleCopyShareImage: (node) => image(node, 'copy-image'),
  };
}
