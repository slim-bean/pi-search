import type { SearchResponse } from "./types";

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? trimmed.slice(0, max) + "…" : trimmed;
}

/** Format a search response as text for the LLM. */
export function formatSearchResponse(resp: SearchResponse): string {
  const lines: string[] = [];
  lines.push(`Web search via ${resp.provider} for: ${resp.query}`);
  lines.push("");

  if (resp.answer) {
    lines.push("Answer:");
    lines.push(resp.answer);
    lines.push("");
  }

  if (resp.results.length === 0) {
    lines.push("No source results returned.");
    return lines.join("\n");
  }

  lines.push(`Sources (${resp.results.length}):`);
  resp.results.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.title}`);
    lines.push(`   ${r.url}`);
    if (r.publishedDate) lines.push(`   published: ${r.publishedDate}`);
    const body = r.snippet ?? r.content;
    if (body) lines.push(`   ${truncate(body, 600).replace(/\n+/g, " ")}`);
  });

  return lines.join("\n");
}
