import React from 'react';
import { createRoot } from 'react-dom/client';
import '../registerAppFonts.js';
import '../index.css';
import '../components/home/homeLandingDemo.css';
import '../components/app/desktopPageLayout.css';
import '../components/ui/experienceFoundation.css';
import StatisticsExperiencePreview from './StatisticsExperiencePreview.jsx';

// 独立 Vite 开发入口；不接认证、bootstrap、账号记录或生产路由。
if (import.meta.env.DEV) {
  createRoot(document.getElementById('root')).render(<StatisticsExperiencePreview />);
}
