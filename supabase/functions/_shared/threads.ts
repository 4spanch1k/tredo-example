import { fetchJson } from "./http.ts";

interface IdResponse {
  id?: string;
}

export interface ThreadsSearchPost {
  id?: string;
  text?: string;
  username?: string;
  permalink?: string;
  timestamp?: string;
}

export interface ThreadsOwnPost {
  id?: string;
  text?: string;
  username?: string;
  timestamp?: string;
  has_replies?: boolean;
}

export interface ThreadsReply {
  id?: string;
  text?: string;
  username?: string;
  timestamp?: string;
  is_reply_owned_by_me?: boolean;
  root_post?: { id?: string };
  replied_to?: { id?: string };
}

export interface ThreadsMention {
  id?: string;
  text?: string;
  username?: string;
  permalink?: string;
  timestamp?: string;
}

interface ThreadsListResponse<T> {
  data?: T[];
}

export type ReplyContextResult =
  | { status: "ready"; text: string }
  | { status: "unavailable" | "too_large"; reason: string };

function cleanContextText(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

export function buildReplyContext(
  rootPost: ThreadsOwnPost,
  replies: ThreadsReply[],
  targetReplyId: string,
  ownUsername = "mononyx",
  maximumCharacters = 2_400,
  maximumMessages = 8,
): ReplyContextResult {
  const rootId = rootPost.id?.trim();
  const rootText = cleanContextText(rootPost.text);
  if (!rootId || !rootText) {
    return { status: "unavailable", reason: "Исходный пост не найден" };
  }

  const byId = new Map(
    replies
      .filter((reply) => reply.id?.trim() && cleanContextText(reply.text))
      .map((reply) => [reply.id!.trim(), reply]),
  );
  const chain: ThreadsReply[] = [];
  const seen = new Set<string>();
  let currentId = targetReplyId.trim();

  while (currentId && currentId !== rootId) {
    if (seen.has(currentId)) {
      return { status: "unavailable", reason: "В ветке обнаружена циклическая ссылка" };
    }
    seen.add(currentId);

    const reply = byId.get(currentId);
    if (!reply) {
      return { status: "unavailable", reason: "Не найден родительский комментарий" };
    }
    chain.push(reply);
    if (chain.length > maximumMessages) {
      return { status: "too_large", reason: "Ветка длиннее безопасного лимита" };
    }

    const parentId = reply.replied_to?.id?.trim() || rootId;
    currentId = parentId;
  }

  if (chain.length === 0) {
    return { status: "unavailable", reason: "Текущий комментарий отсутствует в ветке" };
  }

  const rootAuthor = rootPost.username?.trim() || ownUsername;
  const lines = [
    `Исходный пост @${rootAuthor}: ${rootText}`,
    "Ветка:",
    ...chain.reverse().map((reply) => {
      const author = reply.is_reply_owned_by_me
        ? ownUsername
        : reply.username?.trim() || "пользователь";
      return `@${author}: ${cleanContextText(reply.text)}`;
    }),
  ];
  const text = lines.join("\n");
  if (Array.from(text).length > maximumCharacters) {
    return { status: "too_large", reason: "Контекст превышает безопасный лимит" };
  }
  return { status: "ready", text };
}

export class ThreadsClient {
  constructor(
    private readonly accessToken: string,
    private readonly userId: string,
    private readonly baseUrl = "https://graph.threads.net",
  ) {}

  private url(path: string, parameters: Record<string, string>): URL {
    const url = new URL(`${this.baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`);
    for (const [key, value] of Object.entries(parameters)) {
      url.searchParams.set(key, value);
    }
    return url;
  }

  private requestInit(method: "GET" | "POST"): RequestInit {
    return {
      method,
      headers: { authorization: `Bearer ${this.accessToken}` },
    };
  }

  async createContainer(
    text: string,
    options: { mediaUrl?: string | null; replyToId?: string } = {},
  ): Promise<string> {
    let mediaType = "TEXT";
    const parameters: Record<string, string> = { text };
    if (options.mediaUrl) {
      mediaType = /\.(mp4|mov|webm)(?:$|\?)/i.test(options.mediaUrl) ? "VIDEO" : "IMAGE";
      parameters[mediaType === "VIDEO" ? "video_url" : "image_url"] = options.mediaUrl;
    }
    parameters.media_type = mediaType;
    if (options.replyToId) parameters.reply_to_id = options.replyToId;

    const payload = await fetchJson<IdResponse>(
      "Threads API",
      this.url(`${this.userId}/threads`, parameters),
      this.requestInit("POST"),
    );
    if (!payload.id) throw new Error("Threads API returned no container id");
    return payload.id;
  }

  async publishContainer(containerId: string): Promise<string> {
    const payload = await fetchJson<IdResponse>(
      "Threads API",
      this.url(`${this.userId}/threads_publish`, { creation_id: containerId }),
      this.requestInit("POST"),
    );
    if (!payload.id) throw new Error("Threads API returned no published post id");
    return payload.id;
  }

  async reply(replyToId: string, text: string): Promise<string> {
    const payload = await fetchJson<IdResponse>(
      "Threads API",
      this.url(`${this.userId}/threads`, {
        text,
        media_type: "TEXT",
        reply_to_id: replyToId,
        auto_publish_text: "true",
      }),
      this.requestInit("POST"),
    );
    if (!payload.id) throw new Error("Threads API returned no reply id");
    return payload.id;
  }

  async keywordSearch(
    query: string,
    searchType: "TOP" | "RECENT",
    searchMode: "KEYWORD" | "TAG",
    limit = 25,
  ): Promise<ThreadsSearchPost[]> {
    const payload = await fetchJson<ThreadsListResponse<ThreadsSearchPost>>(
      "Threads API",
      this.url("keyword_search", {
        q: query,
        search_type: searchType,
        search_mode: searchMode,
        fields: "id,text,username,permalink,timestamp",
        limit: String(limit),
      }),
      this.requestInit("GET"),
    );
    return Array.isArray(payload.data) ? payload.data : [];
  }

  async ownPosts(limit = 5): Promise<ThreadsOwnPost[]> {
    const payload = await fetchJson<ThreadsListResponse<ThreadsOwnPost>>(
      "Threads API",
      this.url("me/threads", {
        fields: "id,text,username,timestamp,has_replies",
        limit: String(limit),
      }),
      this.requestInit("GET"),
    );
    return Array.isArray(payload.data) ? payload.data : [];
  }

  async replies(threadId: string, limit = 50): Promise<ThreadsReply[]> {
    const payload = await fetchJson<ThreadsListResponse<ThreadsReply>>(
      "Threads API",
      this.url(`${threadId}/replies`, {
        fields: "id,text,username,timestamp,is_reply_owned_by_me",
        reverse: "true",
        limit: String(limit),
      }),
      this.requestInit("GET"),
    );
    return Array.isArray(payload.data) ? payload.data : [];
  }

  async conversation(threadId: string, limit = 50): Promise<ThreadsReply[]> {
    const payload = await fetchJson<ThreadsListResponse<ThreadsReply>>(
      "Threads API",
      this.url(`${threadId}/conversation`, {
        fields: "id,text,username,timestamp,is_reply_owned_by_me,root_post,replied_to",
        // Newest first keeps fresh comments visible when a post has more than
        // one API page of replies. Parent walking below does not depend on order.
        reverse: "true",
        limit: String(limit),
      }),
      this.requestInit("GET"),
    );
    return Array.isArray(payload.data) ? payload.data : [];
  }

  async postDetails(threadId: string): Promise<ThreadsOwnPost> {
    return fetchJson<ThreadsOwnPost>(
      "Threads API",
      this.url(threadId, { fields: "id,text,username,timestamp,has_replies" }),
      this.requestInit("GET"),
    );
  }

  async replyContext(
    rootPostId: string,
    targetReplyId: string,
    ownUsername = "mononyx",
  ): Promise<ReplyContextResult> {
    const [rootPost, replies] = await Promise.all([
      this.postDetails(rootPostId),
      this.conversation(rootPostId, 50),
    ]);
    return buildReplyContext(rootPost, replies, targetReplyId, ownUsername);
  }

  async mentions(limit = 50): Promise<ThreadsMention[]> {
    const payload = await fetchJson<ThreadsListResponse<ThreadsMention>>(
      "Threads API",
      this.url("me/mentions", {
        fields: "id,text,username,permalink,timestamp",
        limit: String(limit),
      }),
      this.requestInit("GET"),
    );
    return Array.isArray(payload.data) ? payload.data : [];
  }
}
