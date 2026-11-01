import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderDashboardShareCardMarkup } from '../_generated/dashboardShareCardRenderer.mjs';
import { buildDashboardShareCardFileName } from '../../src/utils/dashboardShare.js';
import {
  SHARE_BRAND_LINK,
  SHARE_CARD_EXPORT_PIXEL_RATIO,
  SHARE_CARD_WIDTH,
} from '../../src/utils/shareBranding.js';

let playwrightBrowserPromise = null;
const fontDataUrlPromises = new Map();
const SERVER_FONT_FILES = {
  harmonyMedium: {
    mimeType: 'font/woff2',
    url: new URL('../../src/assets/fonts/harmony/HarmonyOS_Sans_Medium.woff2', import.meta.url),
  },
  harmonyBold: {
    mimeType: 'font/woff2',
    url: new URL('../../src/assets/fonts/harmony/HarmonyOS_Sans_Bold.woff2', import.meta.url),
  },
  harmonyScMedium: {
    mimeType: 'font/woff2',
    url: new URL('../../src/assets/fonts/harmony/HarmonyOS_Sans_SC_Medium.woff2', import.meta.url),
  },
  harmonyScBold: {
    mimeType: 'font/woff2',
    url: new URL('../../src/assets/fonts/harmony/HarmonyOS_Sans_SC_Bold.woff2', import.meta.url),
  },
  novecentoBold: {
    mimeType: 'font/otf',
    url: new URL('../../src/assets/fonts/novecento/Novecento-Wide-Bold.otf', import.meta.url),
  },
  novecentoTabular: {
    mimeType: 'font/otf',
    url: new URL('../../src/assets/fonts/novecento/Novecento-Wide-Bold-Tabular.otf', import.meta.url),
  },
};

function isServerlessChromiumRuntime() {
  return process.platform === 'linux' && Boolean(
    process.env.VERCEL
    || process.env.AWS_EXECUTION_ENV
    || process.env.AWS_LAMBDA_FUNCTION_NAME
  );
}

function getSafeErrorInfo(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error || 'Unknown error'),
    stack: error?.stack || null,
  };
}

async function launchPlaywrightBrowser() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    const { chromium } = await import('playwright-core');
    return chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  }
  if (isServerlessChromiumRuntime()) {
    const [
      { chromium: playwrightChromium },
      { default: serverlessChromium },
    ] = await Promise.all([
      import('playwright-core'),
      import('@sparticuz/chromium'),
    ]);

    return playwrightChromium.launch({
      args: serverlessChromium.args,
      executablePath: await serverlessChromium.executablePath(),
      headless: true,
    });
  }

  const { chromium } = await import('playwright');
  return chromium.launch({ headless: true });
}

async function getPlaywrightBrowser() {
  if (!playwrightBrowserPromise) {
    playwrightBrowserPromise = launchPlaywrightBrowser()
      .catch((error) => {
        playwrightBrowserPromise = null;
        throw error;
      });
  }

  return playwrightBrowserPromise;
}

function escapeHtmlAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fontFileUrl(relativePath) {
  return new URL(relativePath, import.meta.url);
}

function fontFilePath(relativePath) {
  return fileURLToPath(fontFileUrl(relativePath));
}

function getFontDataUrl(fontFile) {
  const cacheKey = `${fontFile.mimeType}:${fontFile.url.href}`;
  if (!fontDataUrlPromises.has(cacheKey)) {
    fontDataUrlPromises.set(
      cacheKey,
      readFile(fontFile.url)
        .then((buffer) => `data:${fontFile.mimeType};base64,${buffer.toString('base64')}`)
    );
  }

  return fontDataUrlPromises.get(cacheKey);
}

async function buildServerFontCss() {
  const [
    harmonyMedium,
    harmonyBold,
    harmonyScMedium,
    harmonyScBold,
    novecentoBold,
    novecentoTabular,
  ] = await Promise.all([
    getFontDataUrl(SERVER_FONT_FILES.harmonyMedium),
    getFontDataUrl(SERVER_FONT_FILES.harmonyBold),
    getFontDataUrl(SERVER_FONT_FILES.harmonyScMedium),
    getFontDataUrl(SERVER_FONT_FILES.harmonyScBold),
    getFontDataUrl(SERVER_FONT_FILES.novecentoBold),
    getFontDataUrl(SERVER_FONT_FILES.novecentoTabular),
  ]);

  return `
    @font-face {
      font-family: 'Harmony Sans App';
      src: url("${harmonyMedium}") format('woff2');
      font-display: block;
      font-style: normal;
      font-weight: 400 600;
      unicode-range: U+0000-024F, U+1E00-1EFF, U+2000-206F, U+20A0-20CF, U+2100-214F, U+2190-21FF, U+2200-22FF, U+25A0-27BF, U+FE00-FE0F;
    }
    @font-face {
      font-family: 'Harmony Sans App';
      src: url("${harmonyBold}") format('woff2');
      font-display: block;
      font-style: normal;
      font-weight: 700 900;
      unicode-range: U+0000-024F, U+1E00-1EFF, U+2000-206F, U+20A0-20CF, U+2100-214F, U+2190-21FF, U+2200-22FF, U+25A0-27BF, U+FE00-FE0F;
    }
    @font-face {
      font-family: 'Harmony Sans App';
      src: url("${harmonyScMedium}") format('woff2');
      font-display: block;
      font-style: normal;
      font-weight: 400 600;
    }
    @font-face {
      font-family: 'Harmony Sans App';
      src: url("${harmonyScBold}") format('woff2');
      font-display: block;
      font-style: normal;
      font-weight: 700 900;
    }
    @font-face {
      font-family: 'Novecento Sans Wide App';
      src: url("${novecentoBold}") format('opentype');
      font-display: block;
      font-style: normal;
      font-weight: 700 900;
    }
    @font-face {
      font-family: 'Novecento Sans Wide Digits App';
      src: url("${novecentoBold}") format('opentype');
      font-display: block;
      font-style: normal;
      font-weight: 700 900;
      unicode-range: U+0023, U+0025, U+002B, U+002D, U+002E, U+002F, U+0030-0039, U+003A, U+00B1;
    }
    @font-face {
      font-family: 'Novecento Sans Wide Tabular App';
      src: url("${novecentoTabular}") format('opentype');
      font-display: block;
      font-style: normal;
      font-weight: 700 900;
      unicode-range: U+0023, U+0025, U+002B, U+002D, U+002E, U+002F, U+0030-0039, U+003A, U+00B1;
    }
  `;
}

export async function buildDashboardShareCardHtml({
  payload,
  sections,
  theme = 'dark',
  locale = 'zh-CN',
} = {}) {
  const markup = renderDashboardShareCardMarkup({
    payload,
    sections,
    theme,
    locale,
  });
  const baseUrl = process.env.PUBLIC_SITE_URL
    || process.env.VITE_PUBLIC_SITE_URL
    || SHARE_BRAND_LINK;
  const fontCss = await buildServerFontCss();

  return `<!doctype html>
<html lang="${escapeHtmlAttribute(locale)}">
  <head>
    <meta charset="utf-8" />
    <base href="${escapeHtmlAttribute(baseUrl)}" />
    <style>
      ${fontCss}
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        padding: 0;
        background: transparent;
      }
      body {
        width: ${SHARE_CARD_WIDTH}px;
        min-height: 100vh;
        font-family: var(--share-font-sans);
      }
      .share-card-capture-root {
        display: inline-block;
        width: ${SHARE_CARD_WIDTH}px;
        background: transparent;
      }
      .share-card-capture-root img {
        -webkit-user-drag: none;
      }
    </style>
  </head>
  <body>
    <div class="share-card-capture-root">${markup}</div>
  </body>
</html>`;
}

async function waitForShareCardAssets(page, timeout = 12000) {
  await page.evaluate(async (assetTimeout) => {
    const pageDocument = globalThis.document;
    const waitWithTimeout = (promise) => Promise.race([
      promise,
      new Promise((resolve) => setTimeout(resolve, assetTimeout)),
    ]);

    if (pageDocument.fonts?.ready) {
      await waitWithTimeout(pageDocument.fonts.ready.catch(() => null));
    }

    const images = Array.from(pageDocument.images);
    await waitWithTimeout(Promise.all(images.map((image) => {
      if (image.complete && image.naturalWidth > 0) {
        return null;
      }

      return new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      });
    })));

    await waitWithTimeout(Promise.all(images.map((image) => {
      if (typeof image.decode !== 'function' || image.naturalWidth <= 0) {
        return null;
      }
      return image.decode().catch(() => null);
    })));
  }, timeout);
}

export async function renderDashboardShareCardImage(detail, {
  theme = 'dark',
  locale = 'zh-CN',
} = {}) {
  const payload = detail?.share_payload || null;
  const sections = Array.isArray(detail?.timeline_sections) ? detail.timeline_sections : [];
  if (!payload || sections.length === 0) {
    throw {
      status: 404,
      message: 'Share payload or timeline sections not found',
    };
  }

  let browser;
  try {
    browser = await getPlaywrightBrowser();
  } catch (error) {
    console.error('[dashboard-share-image] Browser launch failed', getSafeErrorInfo(error));
    throw {
      status: 503,
      message: 'Share card rendering environment is not ready',
    };
  }

  const page = await browser.newPage({
    viewport: {
      width: SHARE_CARD_WIDTH,
      height: 1400,
      deviceScaleFactor: SHARE_CARD_EXPORT_PIXEL_RATIO,
    },
  });

  try {
    await page.setContent(await buildDashboardShareCardHtml({ payload, sections, theme, locale }), {
      waitUntil: 'load',
    });
    await waitForShareCardAssets(page);

    const buffer = await page.locator('.share-card-capture-root').screenshot({
      type: 'png',
    });

    return {
      buffer,
      mime_type: 'image/png',
      file_name: buildDashboardShareCardFileName(payload, locale),
    };
  } finally {
    await page.close();
  }
}

export default {
  buildDashboardShareCardHtml,
  renderDashboardShareCardImage,
};

export const __dashboardShareImageInternals = {
  buildServerFontCss,
  waitForShareCardAssets,
  fontFilePath,
  SERVER_FONT_FILES,
};
