import { useState, useEffect, useCallback } from 'react';
import { MOBILE_BREAKPOINT } from '../constants/index.js';
import { readStorageValue, removeStorageValue, STORAGE_KEYS, writeStorageValue } from '../utils/storageUtils.js';

const MQ_STRING = `(max-width: ${MOBILE_BREAKPOINT}px)`;
const MOBILE_UA_RE = /Mobile|Android|iPhone|iPod|iPad|webOS|BlackBerry|Opera Mini|IEMobile/i;
const SESSION_PLATFORM_KEY = 'platform-choice-session-v1';

function normalizePreference(value) {
  return value === 'mobile' || value === 'desktop' ? value : null;
}

function readSessionPreference() {
  try {
    return normalizePreference(window.sessionStorage.getItem(SESSION_PLATFORM_KEY));
  } catch {
    return null;
  }
}

function saveSessionPreference(preference) {
  try {
    if (preference) window.sessionStorage.setItem(SESSION_PLATFORM_KEY, preference);
    else window.sessionStorage.removeItem(SESSION_PLATFORM_KEY);
  } catch {
    // The current page still uses React state when browser storage is disabled.
  }
}

function detectMobile() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia(MQ_STRING).matches ||
    window.innerWidth <= MOBILE_BREAKPOINT ||
    MOBILE_UA_RE.test(navigator.userAgent)
  );
}

export function useDeviceDetection() {
  const [isMobile, setIsMobile] = useState(detectMobile);

  const [platformPreference, setPlatformPreference] = useState(() => {
    if (typeof window === 'undefined') return null;
    return normalizePreference(readStorageValue(STORAGE_KEYS.PLATFORM_PREFERENCE, null, { raw: true }));
  });
  const [sessionPreference, setSessionPreference] = useState(readSessionPreference);

  useEffect(() => {
    const mql = window.matchMedia(MQ_STRING);
    const update = () => setIsMobile(detectMobile());

    mql.addEventListener('change', update);
    window.addEventListener('resize', update);

    return () => {
      mql.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  const setPreference = useCallback((pref) => {
    pref = normalizePreference(pref);
    if (pref === null) {
      removeStorageValue(STORAGE_KEYS.PLATFORM_PREFERENCE, { raw: true });
    } else {
      writeStorageValue(STORAGE_KEYS.PLATFORM_PREFERENCE, pref, { raw: true });
    }
    setPlatformPreference(pref);
    saveSessionPreference(pref);
    setSessionPreference(pref);
  }, []);

  const clearPreference = useCallback(() => {
    setPreference(null);
  }, [setPreference]);

  const effectivePreference = sessionPreference || platformPreference;
  const shouldUseMobile = effectivePreference
    ? effectivePreference === 'mobile'
    : isMobile;

  return {
    isMobile,
    platformPreference,
    needsPlatformChoice: isMobile && !sessionPreference,
    shouldUseMobile,
    setPreference,
    clearPreference,
  };
}

export default useDeviceDetection;
