import fs from 'node:fs';
import { chromium } from 'playwright';

const SKLAND_CATALOG_URLS = Object.freeze({
  character: 'https://wiki.skland.com/endfield/catalog?typeMainId=1&typeSubId=1',
  weapon: 'https://wiki.skland.com/endfield/catalog?typeMainId=1&typeSubId=2'
});

const ASSOCIATE_TYPE_MAP = Object.freeze({
  character: 'char',
  weapon: 'weapon'
});

const EXCLUDED_NAME_PATTERNS = [/^管理员/];
const PAGE_RENDER_WAIT_MS = 8000;
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function findEdgeExecutable() {
  const candidates = [
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function extractFromPage(page, itemType) {
  const associateType = ASSOCIATE_TYPE_MAP[itemType];

  return page.evaluate((filterType) => {
    const root = window.__CHIMERA_STORE__?.dataMap;
    if (!root || typeof root !== 'object') {
      return { records: [], error: '未找到 __CHIMERA_STORE__.dataMap' };
    }

    const records = [];
    const seenNodes = new WeakSet();
    const seenKeys = new Set();

    const visit = (node, depth = 0) => {
      if (!node || typeof node !== 'object' || seenNodes.has(node) || depth > 20) {
        return;
      }

      seenNodes.add(node);

      if (Array.isArray(node)) {
        node.forEach((item) => visit(item, depth + 1));
        return;
      }

      if (typeof node.name === 'string' && typeof node.brief?.cover === 'string') {
        const row = {
          itemId: node.itemId || null,
          name: node.name.trim(),
          cover: node.brief.cover,
          associateId: node.brief?.associate?.id || null,
          associateType: node.brief?.associate?.type || null,
          sourceLabel: node.brief.dotType || null,
        };

        const key = [row.itemId || '', row.name, row.cover].join('::');
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          records.push(row);
        }
      }

      Object.values(node).forEach((value) => visit(value, depth + 1));
    };

    visit(root);

    return {
      records: records.filter((record) => !record.associateType || record.associateType === filterType),
      error: null
    };
  }, associateType);
}

export async function loadSklandCatalogRecords(types = ['character', 'weapon'], { logger = () => {} } = {}) {
  const requestedTypes = Array.from(new Set(
    (Array.isArray(types) ? types : [types]).filter((itemType) => SKLAND_CATALOG_URLS[itemType])
  ));
  const result = {
    character: [],
    weapon: []
  };

  if (requestedTypes.length === 0) {
    return result;
  }

  const edgeExecutable = findEdgeExecutable();
  const browser = await chromium.launch({
    headless: true,
    ...(edgeExecutable ? { executablePath: edgeExecutable } : {})
  });

  try {
    const context = await browser.newContext({
      userAgent: DEFAULT_USER_AGENT
    });

    for (const itemType of requestedTypes) {
      const page = await context.newPage();

      try {
        const url = SKLAND_CATALOG_URLS[itemType];
        logger(`加载森空岛 ${itemType} 图鉴: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(PAGE_RENDER_WAIT_MS);

        const { records, error } = await extractFromPage(page, itemType);
        if (error) {
          throw new Error(error);
        }

        result[itemType] = records.filter(
          (record) => !EXCLUDED_NAME_PATTERNS.some((pattern) => pattern.test(String(record.name || '').trim()))
        );
        logger(`森空岛 ${itemType} 图鉴已提取 ${result[itemType].length} 条记录`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  return result;
}

export default {
  loadSklandCatalogRecords
};
