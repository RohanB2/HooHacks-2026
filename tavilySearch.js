const { tavily } = require("@tavily/core");
const { default: FirecrawlApp } = require("@mendable/firecrawl-js");

// ── Tavily — web search ───────────────────────────────────────────────────────
// Finds relevant pages across the web. No domain restriction so the full
// index is available; Gemini adds "UVA" context to queries automatically.

let tavilyClient;
function getTavily() {
  if (!tavilyClient) tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY });
  return tavilyClient;
}

async function searchUVA(query) {
  const results = await getTavily().search(query, { maxResults: 6 });
  if (!results.results?.length) return "No results found.";
  return results.results
    .map((r) => `Title: ${r.title}\nURL: ${r.url}\nContent: ${r.content}`)
    .join("\n\n---\n\n");
}

// ── Firecrawl — JS-rendered page reader ──────────────────────────────────────
// Runs a real browser in the cloud and returns rendered markdown.
// Used after webSearch surfaces a promising URL, especially for React SPAs
// like virginia.mydininghub.com and hooslist.virginia.edu.

let firecrawlClient;
function getFirecrawl() {
  if (!firecrawlClient) {
    firecrawlClient = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });
  }
  return firecrawlClient;
}

async function extractPage(url) {
  const result = await getFirecrawl().scrapeUrl(url, { formats: ["markdown"] });
  if (result.success && result.markdown) {
    let content = result.markdown;
    if (content.length > 8000) content = content.slice(0, 8000) + "\n\n[Content truncated...]";
    return content;
  }
  return "Failed to fetch page content.";
}

// ── Dining menu fetcher ───────────────────────────────────────────────────────
// Direct Firecrawl scrape of virginia.mydininghub.com — the page auto-loads
// the current meal period so no dropdown interaction is needed.

const DINING_LOCATIONS = {
  "ohill": "observatory-hill-dining-room",
  "o-hill": "observatory-hill-dining-room",
  "observatory hill": "observatory-hill-dining-room",
  "newcomb": "fresh-food-company",
  "fresh food company": "fresh-food-company",
  "runk": "runk",
  "eatery at lambeth": "eatery-at-lambeth",
  "lambeth": "eatery-at-lambeth",
  "greenberrys": "greenberry-s-at-wilsdorf",
  "greenberry": "greenberry-s-at-wilsdorf",
  "greenberry's": "greenberry-s-at-wilsdorf",
  "wilsdorf": "greenberry-s-at-wilsdorf",
  "daily dose": "cafe-mcleod-daily-dose",
  "cafe mcleod": "cafe-mcleod-daily-dose",
  "zaatar": "za-atar-at-the-castle",
  "za'atar": "za-atar-at-the-castle",
  "the castle": "za-atar-at-the-castle",
};

// Returns YYYY-MM-DD in Eastern Time with an optional day offset
function getETDateString(dayOffset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // en-CA → YYYY-MM-DD
}

// Extract just the section for a given meal period from markdown content.
// Returns null if the section isn't found.
function extractMealSection(content, mealPeriod) {
  if (!mealPeriod) return content;
  const target = mealPeriod.toLowerCase().trim();
  const lines = content.split("\n");
  let inSection = false;
  const result = [];
  for (const line of lines) {
    const isHeading = /^#{1,4}\s/.test(line);
    if (isHeading && line.toLowerCase().includes(target)) {
      inSection = true;
      result.push(line);
    } else if (isHeading && inSection) {
      break;
    } else if (inSection) {
      result.push(line);
    }
  }
  return result.length > 0 ? result.join("\n") : null;
}

function findDiningSlug(location) {
  const normalized = location.toLowerCase().trim();
  if (DINING_LOCATIONS[normalized]) return DINING_LOCATIONS[normalized];
  // Fuzzy: check if the input contains a known key or vice versa
  for (const [key, slug] of Object.entries(DINING_LOCATIONS)) {
    if (normalized.includes(key) || key.includes(normalized)) return slug;
  }
  return null;
}

async function getDiningMenu(location, date = "today", mealPeriod = null) {
  const slug = findDiningSlug(location);
  if (!slug) {
    const known = Object.keys(DINING_LOCATIONS).filter((k) => !k.includes("-") && !k.includes("'")).join(", ");
    return `Unknown dining location "${location}". Known locations: ${known}.`;
  }

  const dayOffset = date === "tomorrow" ? 1 : 0;
  const dateStr = getETDateString(dayOffset);
  // Append date param so the SPA loads the correct day
  const url = `https://virginia.mydininghub.com/en/location/${slug}?date=${dateStr}`;

  const result = await getFirecrawl().scrapeUrl(url, { formats: ["markdown"], waitFor: 3000 });
  console.log(`[dining] ${slug} ${dateStr} ${mealPeriod ?? "all"} — success:${result.success} chars:${result.markdown?.length ?? 0}`);

  if (result.success && result.markdown) {
    let content = result.markdown;

    // Trim nav/header — start from Hours or Daily Menu section
    const hoursStart = content.indexOf("## Hours");
    const menuStart = content.indexOf("Daily Menu");
    const start = hoursStart !== -1 ? hoursStart : menuStart !== -1 ? menuStart : -1;
    if (start !== -1) content = content.slice(start);

    if (!content || content.trim().length < 100) {
      return "Menu page loaded but no menu content was found — the page may still be loading or no menu has been posted yet. Do NOT guess or invent menu items. Tell the student no menu is currently available and suggest checking hd.virginia.edu or the UVA Dining app.";
    }

    // Filter to requested meal period if specified
    if (mealPeriod) {
      const section = extractMealSection(content, mealPeriod);
      if (section) {
        return `Date: ${dateStr}\nMeal period: ${mealPeriod}\n\n${section}`;
      }
      // Section not found — return full content with a note so the model can explain
      return `Date: ${dateStr}\nRequested meal period "${mealPeriod}" was not found in the menu. The page may only be showing a different meal period right now. Full content below:\n\n${content.slice(0, 6000)}`;
    }

    if (content.length > 6000) content = content.slice(0, 6000) + "\n\n[Menu truncated...]";
    return `Date: ${dateStr}\n\n${content}`;
  }

  return "Failed to fetch dining menu. The page may be temporarily unavailable.";
}

module.exports = { searchUVA, extractPage, getDiningMenu };
