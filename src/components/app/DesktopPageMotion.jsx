import React, { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';
import './desktopPageLayout.css';

export default function DesktopPageMotion({ children }) {
  const location = useLocation();
  const view = new URLSearchParams(location.search).get('view') || '';
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname, view]);
  return (
    <div
      key={`${location.pathname}:${view}`}
      data-page={location.pathname}
      className={`dp-page-motion ${location.pathname === '/' ? 'dp-page-motion--home' : ''}`}
    >
      {children}
    </div>
  );
}
