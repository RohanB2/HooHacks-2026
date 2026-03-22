const { tavily } = require("@tavily/core");

let client;
function getClient() {
  if (!client) client = tavily({ apiKey: process.env.TAVILY_API_KEY });
  return client;
}

// Open web search — no domain restriction so Tavily's full index is available.
// Gemini always frames queries with UVA context from the system prompt,
// so results stay UVA-relevant without artificial domain locks.
async function searchUVA(query) {
  const results = await getClient().search(query, {
    maxResults: 6,
  });
  if (!results.results?.length) return "No results found.";
  return results.results
    .map((r) => `Title: ${r.title}\nURL: ${r.url}\nContent: ${r.content}`)
    .join("\n\n---\n\n");
}

// Read a specific URL in full — used after a search surfaces a promising link.
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
