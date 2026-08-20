import { parseNewsFeed } from "../_shared/news.ts";
import { runItNewsRadar } from "../it-news-radar/job.ts";
import { assertEquals } from "./assert.ts";

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title><![CDATA[AI agent learns to pause before answering]]></title>
    <link>https://news.example.test/voice-agent</link>
    <description><![CDATA[<p>A short description about call quality.</p>]]></description>
    <pubDate>Mon, 17 Aug 2026 06:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Same item</title>
    <link>https://news.example.test/voice-agent</link>
  </item>
</channel></rss>`;

Deno.test("RSS parser stores safe, bounded news fields and deduplicates URLs", () => {
  const items = parseNewsFeed(RSS, "https://news.example.test/feed.xml", "Test news");
  assertEquals(items.length, 1);
  assertEquals(items[0].source_name, "Test news");
  assertEquals(items[0].title, "AI agent learns to pause before answering");
  assertEquals(items[0].summary, "A short description about call quality.");
  assertEquals(items[0].published_at, "2026-08-17T06:00:00.000Z");
});

Deno.test("IT news radar inserts only new feed items", async () => {
  const inserted: string[] = [];
  const result = await runItNewsRadar({
    feedUrl: "https://news.example.test/feed.xml",
    sourceName: "Test news",
    fetchFeed: () =>
      Promise.resolve(parseNewsFeed(
        RSS,
        "https://news.example.test/feed.xml",
        "Test news",
      )),
    database: {
      insertNewsItem: (item) => {
        inserted.push(item.url);
        return Promise.resolve(inserted.length === 1);
      },
    },
  });

  assertEquals(result, { inserted: 1, failed: 0 });
  assertEquals(inserted, ["https://news.example.test/voice-agent"]);
});

Deno.test("IT news radar is disabled without a configured feed", async () => {
  const result = await runItNewsRadar({
    database: { insertNewsItem: () => Promise.resolve(true) },
    feedUrl: "",
  });
  assertEquals(result, { skipped: true, inserted: 0, failed: 0 });
});
