import type { NewsItem } from "./types.ts";

const MAX_FEED_BYTES = 500_000;
const MAX_ITEMS = 20;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function textForElement(element: string, names: readonly string[]): string {
  for (const name of names) {
    const tag = escapeRegExp(name);
    const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "iu").exec(element);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function linkForElement(element: string, feedUrl: string): string {
  const href = /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/iu.exec(element)?.[1]?.trim();
  const raw = href || textForElement(element, ["link"]);
  if (!raw) return "";
  try {
    const resolved = new URL(raw, feedUrl);
    return /^https?:$/u.test(resolved.protocol) ? resolved.toString() : "";
  } catch {
    return "";
  }
}

function cleanText(value: string, maximum: number): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/giu, "$1")
    .replace(/<[^>]*>/gu, " ")
    .replace(/&(?:nbsp|#160);/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum);
}

function publishedAt(value: string): string | null {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

export function parseNewsFeed(
  xml: string,
  feedUrl: string,
  sourceName: string,
): NewsItem[] {
  if (!/<(?:rss|feed)\b[^>]*>/iu.test(xml)) {
    throw new Error("IT news feed returned invalid XML");
  }
  const entries = xml.match(/<(?:item|entry)\b[^>]*>[\s\S]*?<\/(?:item|entry)>/giu)?.slice(
    0,
    MAX_ITEMS,
  ) ?? [];
  const items: NewsItem[] = [];
  const seenUrls = new Set<string>();
  for (const entry of entries) {
    const title = cleanText(textForElement(entry, ["title"]), 240);
    const url = linkForElement(entry, feedUrl);
    if (title.length < 8 || !url || seenUrls.has(url)) continue;
    seenUrls.add(url);

    const summary = cleanText(
      textForElement(entry, ["description", "summary", "content", "encoded"]),
      800,
    );
    const date = textForElement(entry, ["pubdate", "published", "updated", "date"]);
    items.push({
      source_name: cleanText(sourceName, 120) || "IT news",
      source_url: feedUrl,
      title,
      url,
      summary,
      published_at: publishedAt(date),
    });
  }
  return items;
}

export async function fetchNewsFeed(
  feedUrl: string,
  sourceName: string,
  fetcher: typeof fetch = fetch,
): Promise<NewsItem[]> {
  let response: Response;
  try {
    response = await fetcher(feedUrl, {
      headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error("IT news feed request failed");
  }
  if (!response.ok) throw new Error(`IT news feed returned ${response.status}`);
  const raw = await response.text();
  if (new TextEncoder().encode(raw).length > MAX_FEED_BYTES) {
    throw new Error("IT news feed is too large");
  }
  return parseNewsFeed(raw, feedUrl, sourceName);
}
