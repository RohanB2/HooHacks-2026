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

async function getDiningMenu(location) {
  const slug = DINING_LOCATIONS[location.toLowerCase().trim()];
  if (!slug) {
    const known = Object.keys(DINING_LOCATIONS).filter((k) => !k.includes("-") && !k.includes("'")).join(", ");
    return `Unknown dining location "${location}". Known locations: ${known}.`;
  }
  const url = `https://virginia.mydininghub.com/en/location/${slug}`;
  const result = await getFirecrawl().scrapeUrl(url, { formats: ["markdown"] });
  if (result.success && result.markdown) {
    let content = result.markdown;
    // Strip nav/header boilerplate — menus start after "Daily Menu"
    const menuStart = content.indexOf("Daily Menu");
    if (menuStart !== -1) content = content.slice(menuStart);
    if (content.length > 6000) content = content.slice(0, 6000) + "\n\n[Menu truncated...]";
    return content || "Menu page loaded but no menu content found.";
  }
  return "Failed to fetch dining menu. The page may be temporarily unavailable.";
}

module.exports = { searchUVA, extractPage, getDiningMenu };
