// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  rejectDisallowedBrowserOrigin: vi.fn(() => false),
  resolveSupabaseServerKey: vi.fn(() => 'service-role-key'),
  resolveSupabaseUrl: vi.fn(() => 'https://db.example.test'),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: mocks.createClient,
}));

vi.mock('../_lib/http.js', () => ({
  rejectDisallowedBrowserOrigin: mocks.rejectDisallowedBrowserOrigin,
}));

vi.mock('../_lib/supabaseEnv.js', () => ({
  resolveSupabaseServerKey: mocks.resolveSupabaseServerKey,
  resolveSupabaseUrl: mocks.resolveSupabaseUrl,
}));

vi.mock('../_lib/gameAnnouncementDigest.js', () => ({
  getStoredGameAnnouncementDigest: vi.fn(async () => null),
}));

import announcementsHandler, { __internal as announcementsInternal } from '../_routes/root/announcements.js';

function createJsonResponseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

function createRequest(url = 'https://example.com/api/announcements') {
  return {
    method: 'GET',
    url,
    headers: {},
  };
}

function matchesFilters(row, filters = []) {
  return filters.every((filter) => {
    if (filter.op === 'eq') return row?.[filter.column] === filter.value;
    if (filter.op === 'is') return (row?.[filter.column] ?? null) === filter.value;
    if (filter.op === 'not' && filter.operator === 'is') return (row?.[filter.column] ?? null) !== filter.value;
    if (filter.op === 'neq') return row?.[filter.column] !== filter.value;
    if (filter.op === 'gte') return String(row?.[filter.column] || '') >= String(filter.value);
    if (filter.op === 'like' || filter.op === 'ilike') {
      const pattern = new RegExp(`^${filter.value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/%/gu, '.*')}$`, filter.op === 'ilike' ? 'iu' : 'u');
      return pattern.test(String(row?.[filter.column] || ''));
    }
    return true;
  });
}

class PublicAnnouncementQuery {
  constructor(rows) {
    this.rows = rows;
    this.filters = [];
    this.limitValue = null;
  }

  select() {
    return this;
  }

  eq(column, value) {
    this.filters.push({ op: 'eq', column, value });
    return this;
  }

  is(column, value) {
    this.filters.push({ op: 'is', column, value });
    return this;
  }

  not(column, operator, value) {
    this.filters.push({ op: 'not', column, operator, value });
    return this;
  }

  neq(column, value) {
    this.filters.push({ op: 'neq', column, value });
    return this;
  }

  gte(column, value) {
    this.filters.push({ op: 'gte', column, value });
    return this;
  }

  like(column, value) {
    this.filters.push({ op: 'like', column, value });
    return this;
  }

  ilike(column, value) {
    this.filters.push({ op: 'ilike', column, value });
    return this;
  }

  order() {
    return this;
  }

  limit(value) {
    this.limitValue = Number(value);
    return this;
  }

  maybeSingle() {
    return Promise.resolve({ data: null, error: null });
  }

  then(resolve, reject) {
    let rows = this.rows.filter(row => matchesFilters(row, this.filters));
    if (Number.isFinite(this.limitValue)) {
      rows = rows.slice(0, this.limitValue);
    }
    return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
  }
}

function createSupabaseClient(rows) {
  return {
    from(table) {
      if (table === 'site_config') {
        return new PublicAnnouncementQuery([]);
      }
      if (table === 'announcements') {
        return new PublicAnnouncementQuery(rows);
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

describe('/api/announcements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    announcementsInternal.cacheByKey.clear();
  });

  it('includes legacy manual site announcements whose source_id is an empty string', async () => {
    mocks.createClient.mockReturnValue(createSupabaseClient([
      {
        id: 'manual-null',
        title: '新站内公告',
        content: '公告内容',
        announcement_type: 'update',
        severity: 'info',
        is_active: true,
        priority: 10,
        source_id: null,
        updated_at: '2026-06-05T00:00:00.000Z',
      },
      {
        id: 'manual-empty',
        title: '旧站内公告',
        content: '旧公告内容',
        announcement_type: 'temporary',
        severity: 'warning',
        is_active: true,
        priority: 9,
        source_id: '',
        updated_at: '2026-06-04T00:00:00.000Z',
      },
      {
        id: 'game-real',
        title: '游戏公告',
        content: '同步公告',
        is_active: true,
        source_id: 'game-bulletin:1',
        published_at: '2026-06-04T00:00:00.000Z',
      },
    ]));

    const res = createJsonResponseRecorder();
    await announcementsHandler(createRequest('https://example.com/api/announcements?limit=5&cutoffIso=2026-06-01T00:00:00.000Z'), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.siteAnnouncements.map(item => item.id)).toEqual(['manual-null', 'manual-empty']);
    expect(res.body.data.recentGameAnnouncements.map(item => item.id)).toEqual(['game-real']);
    expect(res.body.data.latestGameAnnouncements.map(item => item.id)).toEqual(['game-real']);
    expect(res.body.partial).toBe(false);
  });

  it('returns official briefing records even after they fall outside recent and latest announcement windows', async () => {
    const recent = Array.from({ length: 5 }, (_, index) => ({
      id: `recent-${index}`, source_id: `recent-${index}`, title: '普通公告',
      is_active: true, published_at: '2026-11-01T00:00:00Z',
    }));
    const old = { id: 'briefing', source_id: '4774', title: '「丹青渡」新版本导览上线',
      source_url: 'https://endfield.hypergryph.com/news/4774', is_active: true,
      published_at: '2026-10-06T12:00:00Z', content: '![新版本导览封面](/cover.png)' };
    mocks.createClient.mockReturnValue(createSupabaseClient([...recent, old,
      { ...old, id: 'inactive', source_id: 'inactive', is_active: false },
      { ...old, id: 'unofficial', source_id: 'unofficial', source_url: 'https://other.test/news/1' },
    ]));
    const res = createJsonResponseRecorder();
    await announcementsHandler(createRequest('https://example.com/api/announcements?limit=5&cutoffIso=2026-10-25T00:00:00Z'), res);
    expect(res.body.data.latestGameAnnouncements).toHaveLength(5);
    expect(res.body.data.recentGameAnnouncements).toHaveLength(5);
    expect(res.body.data.versionBriefingAnnouncements.map(item => item.id)).toEqual(['briefing']);
    expect(res.body.partial).toBe(false);
  });
});
