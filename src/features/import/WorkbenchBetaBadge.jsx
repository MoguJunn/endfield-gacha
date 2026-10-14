import React from 'react';
import { useI18n } from '../../i18n/index.js';

export default function WorkbenchBetaBadge() {
  const { isEnglish } = useI18n();
  return <span className="inline-flex shrink-0 items-center whitespace-nowrap border border-endfield-yellow bg-endfield-yellow px-1.5 py-0.5 text-[10px] font-bold leading-none text-black">
    {isEnglish ? 'BETA' : '测试版'}
  </span>;
}
