import { useCallback, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export function useImportMethodSelection({ onOpenFileImport } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [selectedMethod, setSelectedMethod] = useState('');
  const requestedMethod = new URLSearchParams(location.search).get('import');
  // The existing import=open URL now opens the same three choices as the button.
  const requested = requestedMethod === 'choose' || requestedMethod === 'open';
  const method = selectedMethod || (requested ? 'choose' : '');
  const clearRequest = useCallback(() => {
    if (!requested) return;
    const params = new URLSearchParams(location.search);
    params.delete('import');
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash }, { replace: true });
  }, [location.hash, location.pathname, location.search, navigate, requested]);
  const close = useCallback(() => {
    setSelectedMethod('');
    clearRequest();
  }, [clearRequest]);
  const openChooser = useCallback(() => setSelectedMethod('choose'), []);
  const chooseOfficial = useCallback(() => {
    clearRequest();
    setSelectedMethod('official');
  }, [clearRequest]);
  const chooseFile = useCallback(() => {
    clearRequest();
    if (typeof onOpenFileImport === 'function') {
      setSelectedMethod('');
      onOpenFileImport();
    } else {
      setSelectedMethod('file');
    }
  }, [clearRequest, onOpenFileImport]);
  const chooseManual = useCallback(() => {
    setSelectedMethod('');
    navigate(location.pathname.startsWith('/m/') ? '/m/data-workbench' : '/data-workbench');
  }, [location.pathname, navigate]);
  return { method, openChooser, close, chooseOfficial, chooseFile, chooseManual };
}
