require('dotenv').config();

const { chromium } = require('playwright');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ==========================================
// 1. Configuration & State
// ==========================================

const LOCATIONS = [
  {
    key:   'observatoryHill',
    name:  'Observatory Hill',
    url:   'https://virginia.mydininghub.com/en/location/observatory-hill-dining-room',
  },
  {
    key:   'newcomb',
    name:  'Fresh Food Company (Newcomb)',
    url:   'https://virginia.mydininghub.com/en/location/fresh-food-company',
  },
  {
    key:   'runk',
    name:  'Runk',
    url:   'https://virginia.mydininghub.com/en/location/runk',
  },
];

// Word-boundary safe keywords — short tokens like "eat" use \b so they
// don't false-match inside words like "weather" or "feature".
const DINING_KEYWORDS = [
  { word: 'dining',           boundary: false },
  { word: 'menu',             boundary: false },
  { word: 'food',             boundary: false },
  { word: 'eat',              boundary: true  },  // \beat\b avoids "weather"
  { word: 'lunch',            boundary: false },
  { word: 'dinner',           boundary: false },
  { word: 'breakfast',        boundary: false },
  { word: 'brunch',           boundary: false },
  { word: 'meal',             boundary: false },
  { word: 'swipe',            boundary: false },
  { word: 'station',          boundary: false },
  { word: 'cafeteria',        boundary: false },
  { word: 'o-hill',           boundary: false },
  { word: 'ohill',            boundary: false },
  { word: 'observatory hill', boundary: false },
  { word: 'newcomb',          boundary: false },
  { word: 'fresh food',       boundary: false },
  { word: 'runk',             boundary: true  },  // \brunk\b avoids "drunk"
  { word: 'serving',          boundary: false },
  { word: 'hungry',           boundary: false },
];

const REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes
const PAGE_TIMEOUT_MS  = 30_000;
const SETTLE_MS        = 1_500;

// Global cache
let diningCache = {
  data:        null,   // { observatoryHill, newcomb, runk }  — formatted strings
  lastUpdated: null,
};

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// ==========================================
// 2. Scraping & Caching Logic
// ==========================================

/**
 * Scrapes one dining hall using a headless Chromium page.
 * virginia.mydininghub.com is a fully client-rendered React app (Aramark
 * Elevate DXP) — there is no public API and plain HTTP fetches return
 * skeleton HTML with no menu content. Playwright is required.
 *
 * @param {import('playwright').Browser} browser
 * @param {{ key: string, name: string, url: string }} location
 * @returns {Promise<string>}  Human-readable menu text, or an error message.
 */
async function scrapeLocation(browser, location) {
  let page;
  try {
    page = await browser.newPage();

    // Block images/fonts — we only need DOM text, this cuts load time ~60%
    await page.route('**/*.{png,jpg,jpeg,webp,gif,svg,woff,woff2,ttf,otf}', r => r.abort());

    await page.goto(location.url, {
      waitUntil: 'domcontentloaded',
      timeout:   PAGE_TIMEOUT_MS,
    });

    // Wait for React to render meal-period headings. The app fires an internal
    // XHR for menu data after hydration, so domcontentloaded is not enough.
    try {
      await page.waitForFunction(
        () => [...document.querySelectorAll('h2,h3,h4')]
                .some(h => /breakfast|brunch|lunch|dinner|late night/i.test(h.textContent)),
        { timeout: PAGE_TIMEOUT_MS }
      );
    } catch {
      // Hall may be closed today with no meal periods — still continue
      await page.waitForSelector('main', { timeout: 5_000 }).catch(() => {});
    }

    // Small buffer for late-populating station/item content
    await page.waitForTimeout(SETTLE_MS);

    const menuText = await page.evaluate(() => {
      const lines = [];
      const now   = Date.now();

      // ── Time helper ──────────────────────────────────────────────────────
      function parseRange(str) {
        // Matches "11:00 AM – 3:00 PM" with en-dash or hyphen
        const parts = str.split(/\s*[–\-]\s*/);
        if (parts.length !== 2) return null;
        const toMs = s => {
          const m = s.trim().match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
          if (!m) return null;
          let h = +m[1], min = +m[2];
          const mer = m[3].toUpperCase();
          if (mer === 'PM' && h !== 12) h += 12;
          if (mer === 'AM' && h === 12) h = 0;
          const d = new Date(); d.setHours(h, min, 0, 0);
          return d.getTime();
        };
        const s = toMs(parts[0]), e = toMs(parts[1]);
        return (s !== null && e !== null) ? { start: s, end: e } : null;
      }

      // ── Find meal-period containers ──────────────────────────────────────
      // Strategy A: explicit data-testid (Aramark Elevate DXP)
      let periodEls = [...document.querySelectorAll('[data-testid="meal-period"]')];

      // Strategy B: any section/div whose first heading matches a meal name
      if (!periodEls.length) {
        periodEls = [...document.querySelectorAll('section, article, [class*="period"], [class*="Period"]')]
          .filter(el => {
            const h = el.querySelector('h2,h3,h4');
            return h && /^\s*(breakfast|brunch|lunch|dinner|late\s*night)/i.test(h.textContent);
          });
      }

      // Strategy C: use the headings themselves and collect siblings
      if (!periodEls.length) {
        periodEls = [...document.querySelectorAll('h2,h3')]
          .filter(h => /^\s*(breakfast|brunch|lunch|dinner|late\s*night)/i.test(h.textContent));
      }

      if (!periodEls.length) {
        return 'No menu data available today.';
      }

      for (const el of periodEls) {
        const headingEl = el.matches('h2,h3,h4') ? el : el.querySelector('h2,h3,h4');
        if (!headingEl) continue;
        const raw = headingEl.textContent.trim();

        // Extract hours from heading, e.g. "Lunch · 11:00 AM – 3:00 PM"
        const hoursMatch = raw.match(/(\d{1,2}:\d{2}\s*[AP]M\s*[–\-]\s*\d{1,2}:\d{2}\s*[AP]M)/i);
        const hours  = hoursMatch ? hoursMatch[1].trim() : null;
        const range  = hours ? parseRange(hours) : null;
        const isOpen = range ? (now >= range.start && now <= range.end) : false;

        const periodName = raw
          .replace(/[·|—–\-].*/, '')
          .replace(/\d{1,2}:\d{2}.*/, '')
          .trim() || 'Menu';

        const label = hours
          ? `${periodName} (${hours})${isOpen ? ' ← OPEN NOW' : ''}`
          : periodName;
        lines.push(label);

        // Collect items, grouped by station
        const container = el.matches('h2,h3,h4') ? el.parentElement : el;
        if (!container) { lines.push('  (No items listed)'); continue; }

        const stationEls = [...container.querySelectorAll(
          '[data-testid="station"], [class*="station"], [class*="Station"]'
        )];

        if (stationEls.length) {
          for (const stEl of stationEls) {
            const snEl    = stEl.querySelector('h3,h4,h5,[class*="name"],[class*="Name"]');
            const station = snEl?.textContent?.trim() ?? 'General';
            if (station !== 'General') lines.push(`  [${station}]`);

            for (const iEl of stEl.querySelectorAll('li,[class*="item"],[class*="Item"],[class*="product"]')) {
              const nameEl = iEl.querySelector('strong,b,[class*="name"],p,span');
              const name   = (nameEl ?? iEl).textContent?.trim();
              if (!name || name.length < 2) continue;

              const tagEls = [...iEl.querySelectorAll('[class*="tag"],[class*="badge"],[class*="label"]')];
              const tags   = tagEls.flatMap(t =>
                t.textContent.split(/[,;|·]/).map(s => s.trim()).filter(Boolean)
              );
              lines.push(`  • ${name}${tags.length ? '  (' + tags.join(' · ') + ')' : ''}`);
            }
          }
        } else {
          // No station wrappers — list items directly
          const items = [...container.querySelectorAll('li')]
            .map(li => li.textContent?.trim())
            .filter(t => t && t.length >= 2);

          if (items.length) {
            items.forEach(i => lines.push(`  • ${i}`));
          } else {
            lines.push('  (No items listed)');
          }
        }

        lines.push(''); // blank line between periods
      }

      return lines.join('\n').trim() || 'No menu data available today.';
    });

    return menuText;

  } catch (err) {
    return `Error fetching menu: ${err.message}`;
  } finally {
    await page?.close();
  }
}

/**
 * Launches one shared Chromium browser, scrapes all three halls in parallel,
 * closes the browser, and writes results to diningCache.
 */
async function fetchDiningMenus() {
  console.log(`[${new Date().toLocaleTimeString()}] Fetching latest dining data...`);

  const browser = await chromium.launch({ headless: true });
  try {
    const results = await Promise.all(
      LOCATIONS.map(loc => scrapeLocation(browser, loc))
    );

    diningCache.data = {
      observatoryHill: results[0],
      newcomb:         results[1],
      runk:            results[2],
    };
    diningCache.lastUpdated = new Date();
    console.log('Cache successfully updated.');

  } catch (err) {
    console.error('Failed to fetch dining data:', err.message);
  } finally {
    await browser.close();
  }
}

// Initial fetch + 30-minute refresh cycle
fetchDiningMenus();
setInterval(fetchDiningMenus, REFRESH_INTERVAL);

// ==========================================
// 3. Gemini Injection Logic
// ==========================================

/**
 * Returns true if the query mentions food/dining topics.
 * Uses word-boundary checks for short tokens to avoid false positives
 * (e.g. "eat" inside "weather", "runk" inside "drunk").
 *
 * @param {string} query
 * @returns {boolean}
 */
function containsDiningKeywords(query) {
  const lower = query.toLowerCase();
  return DINING_KEYWORDS.some(({ word, boundary }) =>
    boundary
      ? new RegExp(`\\b${word}\\b`).test(lower)
      : lower.includes(word)
  );
}

/**
 * Handles a user query, injecting live dining context into Gemini's system
 * prompt when the query is dining-related.
 *
 * @param {string} userQuery
 * @returns {Promise<string>}
 */
async function handleUserQuery(userQuery) {
  let systemPrompt = 'You are a helpful UVA assistant.';

  if (containsDiningKeywords(userQuery) && diningCache.data) {
    const updated = diningCache.lastUpdated?.toLocaleTimeString() ?? 'unknown';
    systemPrompt += `

CURRENT DINING MENUS (last updated: ${updated}):

Observatory Hill:
${diningCache.data.observatoryHill}

Fresh Food Company (Newcomb):
${diningCache.data.newcomb}

Runk:
${diningCache.data.runk}

Use this information to answer the student's question. If a hall shows no data or an error, say so.`;
  }

  try {
    const result = await model.generateContent({
      contents:          [{ role: 'user', parts: [{ text: userQuery }] }],
      systemInstruction: systemPrompt,
    });
    return result.response.text();
  } catch (err) {
    console.error('Gemini API Error:', err);
    return 'Sorry, I had trouble processing that request.';
  }
}

// ==========================================
// Exports
// ==========================================

module.exports = {
  handleUserQuery,
  containsDiningKeywords,
  getDiningCache: () => diningCache,
};

// TEST(DELETE AFTER CHECK)
// ==========================================
// Playwright Smoke Test
// Run directly to verify Chromium can reach
// the site and render real menu content:
//   node diningData.js --test
// ==========================================
 
if (process.argv.includes('--test')) {
  (async () => {
    console.log('\n── Playwright smoke test ──────────────────────────────────');
    console.log('Launching headless Chromium...');
 
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
 
      await page.route('**/*.{png,jpg,jpeg,webp,gif,svg,woff,woff2,ttf,otf}', r => r.abort());
 
      console.log('Navigating to Runk...');
      await page.goto('https://virginia.mydininghub.com/en/location/runk', {
        waitUntil: 'domcontentloaded',
        timeout:   PAGE_TIMEOUT_MS,
      });
 
      // Wait up to 30s for any meal-period heading to appear
      console.log('Waiting for React to render menu content...');
      try {
        await page.waitForFunction(
          () => [...document.querySelectorAll('h2,h3,h4')]
                  .some(h => /breakfast|brunch|lunch|dinner|late night/i.test(h.textContent)),
          { timeout: PAGE_TIMEOUT_MS }
        );
        console.log('✓ Meal period headings detected — React rendered successfully.\n');
      } catch {
        console.warn('⚠ No meal-period headings found within timeout.');
        console.warn('  The hall may be closed today, or the site structure has changed.\n');
      }
 
      await page.waitForTimeout(SETTLE_MS);
 
      // Print first 1000 chars of the rendered body text
      const bodyText = await page.evaluate(() => document.body.innerText);
      const preview  = bodyText.replace(/\s+/g, ' ').trim().slice(0, 1000);
 
      console.log('── Page text preview (first 1000 chars) ──────────────────');
      console.log(preview);
      console.log('\n──────────────────────────────────────────────────────────');
 
      if (/grilled|chicken|pasta|salad|burger|pizza|soup|rice|vegan|halal/i.test(bodyText)) {
        console.log('✓ PASS — Real menu items detected in page content.');
        console.log('  The scraper will be able to read today\'s menus.\n');
      } else if (/loading/i.test(bodyText)) {
        console.log('✗ FAIL — Page still shows "Loading..." after timeout.');
        console.log('  Try increasing SETTLE_MS (currently ' + SETTLE_MS + 'ms) in the config.\n');
      } else {
        console.log('⚠ UNCERTAIN — No recognisable menu items found, but no "Loading..." either.');
        console.log('  The hall may simply be closed with no menu posted for today.\n');
      }
 
    } catch (err) {
      console.error('\n✗ FAIL — Smoke test threw an error:');
      console.error(' ', err.message);
      if (err.message.includes('Executable doesn\'t exist')) {
        console.error('\n  Chromium binary not found. Run:');
        console.error('    npx playwright install chromium\n');
      }
    } finally {
      await browser?.close();
      // Exit cleanly — don't let the setInterval keep the process alive
      process.exit(0);
    }
  })();
}