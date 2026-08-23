import React, { useId, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

/**
 * 移动端图表容器（可折叠）
 */
function MobileChartContainer({ title, children, defaultExpanded = true, className = '', headerRight = null }) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const contentId = useId();

  return (
    <div className={`mobile-ux-card overflow-hidden ${className}`}>
      {/* 标题栏 */}
      <div className="flex w-full items-center gap-2 px-4 py-1.5">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          aria-expanded={isExpanded}
          aria-controls={contentId}
          className="flex min-h-11 flex-1 items-center justify-between gap-3 text-left touch-feedback focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          <span className="text-[12px] font-black tracking-[0.08em] text-slate-700 dark:text-zinc-300">{title}</span>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
          )}
        </button>
        {headerRight ? <div className="flex items-center">{headerRight}</div> : null}
      </div>

      {/* 图表内容 */}
      {isExpanded && (
        <div id={contentId} className="border-t border-zinc-200 px-4 pb-4 animate-fade-in-fast dark:border-zinc-800">
          {children}
        </div>
      )}
    </div>
  );
}

export default MobileChartContainer;
