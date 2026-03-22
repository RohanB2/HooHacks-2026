const { tavily } = require("@tavily/core");

// All domains Tavily is allowed to search.
// virginia.edu covers all official UVA subdomains (dining, lib, recsports, etc.)
// Non-virginia.edu sites are listed explicitly.
const UVA_DOMAINS = [
  // ── Official UVA (covers all subdomains) ──────────────────────────────────
  "virginia.edu",

  // ── Dining ────────────────────────────────────────────────────────────────
  "virginia.mydininghub.com",     // live menus & dining hours

  // ── Courses & academics ───────────────────────────────────────────────────
  "louslist.com",                 // THE course search tool — sections, profs, grade trends
  "thecourseforum.com",           // course reviews, grade distributions, professor history
  "ratemyprofessors.com",         // professor ratings

  // ── Student news & events ─────────────────────────────────────────────────
  "cavalierdaily.com",            // The Cavalier Daily — current events, campus news
  "virginiasports.com",           // UVA Athletics — schedules, tickets, scores

  // ── Housing & off-Grounds ─────────────────────────────────────────────────
  "offcampushousing.virginia.edu",// off-Grounds housing listings
];

let client;
function getClient() {
  if (!client) client = tavily({ apiKey: process.env.TAVILY_API_KEY });
  return client;
}

async function searchUVA(query) {
  const results = await getClient().search(query, {
    maxResults: 5,
    includeDomains: UVA_DOMAINS,
  });
  return results.results
    .map((r) => `Title: ${r.title}\nURL: ${r.url}\nContent: ${r.content}`)
    .join("\n\n---\n\n");
}

async function extractPage(url) {
  const result = await getClient().extract([url]);
  if (result.results?.length > 0) {
    let content = result.results[0].raw_content || "";
    if (content.length > 8000) content = content.slice(0, 8000) + "\n\n[Content truncated...]";
    return content;
  }
  return "Failed to fetch page content.";
}

module.exports = { searchUVA, extractPage };
