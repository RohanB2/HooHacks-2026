const { tavily } = require("@tavily/core");

// All domains Tavily is allowed to search
const UVA_DOMAINS = [
  "virginia.edu",
  "dining.virginia.edu",
  "virginia.mydininghub.com",   // live menus & dining hours
  "lib.virginia.edu",
  "recsports.virginia.edu",
  "hrl.virginia.edu",
  "parking.virginia.edu",       // UTS bus schedules & transit
  "registrar.virginia.edu",     // add/drop, academic calendar
  "studenthealth.virginia.edu", // CAPS, health center hours
  "career.virginia.edu",        // Career Center
  "sfs.virginia.edu",           // Student Financial Services
  "madisonhouse.virginia.edu",  // Hoos Helping Hoos, volunteering
  "commerce.virginia.edu",      // McIntire
  "engineering.virginia.edu",   // SEAS
  "batten.virginia.edu",        // Batten School
  "law.virginia.edu",           // School of Law
  "darden.virginia.edu",        // Darden MBA
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
