const { tavily } = require("@tavily/core");
const FirecrawlApp = require("@mendable/firecrawl-js");

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

module.exports = { searchUVA, extractPage };
