// @vitest-environment node

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('dashboard performance guards', () => {
  it('does not derive the same pool history in collapsed dashboard helpers', () => {
    const workspace = readSource('src/components/app/DesktopDashboardWorkspace.jsx');

    expect(workspace).not.toContain('useCurrentPoolData');
    expect(workspace).toContain('const [recordsOpen, setRecordsOpen] = useState(false);');
    expect(workspace).toContain('onToggle={(event) => setRecordsOpen(event.currentTarget.open)}');
    expect(workspace).toContain('{recordsOpen && (');
  });

  it('reuses the dashboard timeline and delays custom-share calculations', () => {
    const dashboard = readSource('src/components/dashboard/DashboardView.jsx');
    const timelinePanel = readSource('src/components/dashboard/PoolTimelinePanel.jsx');

    expect(dashboard).toContain("const shouldBuildCustomShareData = shareMode === 'custom';");
    expect(dashboard).toContain('if (!shouldBuildCustomShareData || customShareSelectedPools.length === 0)');
    expect(dashboard).toContain('sections={timelineSections}');
    expect(timelinePanel).toContain('sections: precomputedSections = null');
    expect(timelinePanel).toContain('if (Array.isArray(precomputedSections))');
  });

  it('avoids repeated timeline copying and duplicate local roster requests', () => {
    const timeline = readSource('src/utils/poolTimelineView.js');
    const roster = readSource('src/utils/poolRoster.js');

    expect(timeline).toContain('pendingSupportItems.push(...summary.fiveStars);');
    expect(roster).toContain('const directBucketsCache = new Map();');
    expect(roster).toContain('const directBucketsInFlight = new Map();');
    expect(roster).toContain('if (directBucketsInFlight.has(cacheKey))');
  });
});
