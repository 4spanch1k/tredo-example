import { optionalEnv, requiredEnv, supabaseAdminKey } from "../_shared/env.ts";
import { fetchNewsFeed } from "../_shared/news.ts";
import { SupabaseRestClient } from "../_shared/supabase.ts";
import type { JobResult, NewsItem } from "../_shared/types.ts";

export const DEFAULT_IT_NEWS_FEED_URL = "https://habr.com/ru/rss/news/?fl=ru&limit=100";
export const DEFAULT_IT_NEWS_SOURCE_NAME = "Habr";

interface ItNewsDatabase {
  insertNewsItem(item: NewsItem): Promise<boolean>;
}

export async function runItNewsRadar(options: {
  database?: ItNewsDatabase;
  feedUrl?: string;
  sourceName?: string;
  fetchFeed?: (feedUrl: string, sourceName: string) => Promise<NewsItem[]>;
} = {}): Promise<JobResult> {
  const feedUrl =
    (options.feedUrl !== undefined
      ? options.feedUrl
      : optionalEnv("IT_NEWS_FEED_URL") ?? DEFAULT_IT_NEWS_FEED_URL).trim();
  if (!feedUrl) return { skipped: true, inserted: 0, failed: 0 };
  if (!/^https?:\/\//iu.test(feedUrl)) {
    throw new Error("IT_NEWS_FEED_URL must start with http:// or https://");
  }

  const database = options.database ?? new SupabaseRestClient(
    requiredEnv("SUPABASE_URL"),
    supabaseAdminKey(),
  );
  const sourceName = (
    options.sourceName ?? optionalEnv("IT_NEWS_SOURCE_NAME") ?? DEFAULT_IT_NEWS_SOURCE_NAME
  ).trim();
  const items = await (options.fetchFeed ?? fetchNewsFeed)(feedUrl, sourceName);
  let inserted = 0;
  for (const item of items) {
    if (await database.insertNewsItem(item)) inserted += 1;
  }
  return { inserted, failed: 0 };
}
