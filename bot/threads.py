from __future__ import annotations

from typing import Any, Literal
from urllib.parse import quote

from bot.config import ThreadsSettings
from bot.http import JsonHttpClient

SearchType = Literal["TOP", "RECENT"]
SearchMode = Literal["KEYWORD", "TAG"]
ReplyContextStatus = Literal["ready", "unavailable", "too_large"]


def _clean_context_text(value: object) -> str:
    return " ".join(value.strip().split()) if isinstance(value, str) else ""


def build_reply_context(
    root_post: dict[str, Any],
    replies: list[dict[str, Any]],
    target_reply_id: str,
    *,
    own_username: str = "mononyx",
    maximum_characters: int = 2_400,
    maximum_messages: int = 8,
) -> tuple[ReplyContextStatus, str]:
    root_id = _clean_context_text(root_post.get("id"))
    root_text = _clean_context_text(root_post.get("text"))
    if not root_id or not root_text:
        return "unavailable", "Исходный пост не найден"

    by_id = {
        reply_id: reply
        for reply in replies
        if (reply_id := _clean_context_text(reply.get("id")))
        and _clean_context_text(reply.get("text"))
    }
    chain: list[dict[str, Any]] = []
    seen: set[str] = set()
    current_id = target_reply_id.strip()
    while current_id and current_id != root_id:
        if current_id in seen:
            return "unavailable", "В ветке обнаружена циклическая ссылка"
        seen.add(current_id)
        reply = by_id.get(current_id)
        if reply is None:
            return "unavailable", "Не найден родительский комментарий"
        chain.append(reply)
        if len(chain) > maximum_messages:
            return "too_large", "Ветка длиннее безопасного лимита"
        replied_to = reply.get("replied_to")
        parent_id = (
            _clean_context_text(replied_to.get("id"))
            if isinstance(replied_to, dict)
            else ""
        )
        current_id = parent_id or root_id

    if not chain:
        return "unavailable", "Текущий комментарий отсутствует в ветке"

    root_author = _clean_context_text(root_post.get("username")) or own_username
    lines = [f"Исходный пост @{root_author}: {root_text}", "Ветка:"]
    for reply in reversed(chain):
        author = (
            own_username
            if reply.get("is_reply_owned_by_me") is True
            else _clean_context_text(reply.get("username")) or "пользователь"
        )
        lines.append(f"@{author}: {_clean_context_text(reply.get('text'))}")
    context = "\n".join(lines)
    if len(context) > maximum_characters:
        return "too_large", "Контекст превышает безопасный лимит"
    return "ready", context


class ThreadsClient:
    def __init__(self, settings: ThreadsSettings, http: JsonHttpClient | None = None) -> None:
        self.base_url = settings.api_base_url.rstrip("/")
        self.user_id = quote(settings.user_id, safe="")
        self.http = http or JsonHttpClient()
        self.headers = {"Authorization": f"Bearer {settings.access_token}"}

    def create_container(
        self,
        text: str,
        *,
        media_url: str | None = None,
        reply_to_id: str | None = None,
    ) -> str:
        query: dict[str, str] = {"text": text}
        if media_url:
            lowercase_url = media_url.lower().split("?", 1)[0]
            if lowercase_url.endswith((".mp4", ".mov", ".webm")):
                query.update({"media_type": "VIDEO", "video_url": media_url})
            else:
                query.update({"media_type": "IMAGE", "image_url": media_url})
        else:
            query["media_type"] = "TEXT"
        if reply_to_id:
            query["reply_to_id"] = reply_to_id

        data = self.http.request(
            "POST",
            f"{self.base_url}/{self.user_id}/threads",
            headers=self.headers,
            query=query,
        )
        if not isinstance(data, dict) or not data.get("id"):
            raise RuntimeError("Threads create container response has no id")
        return str(data["id"])

    def publish_container(self, container_id: str) -> str:
        data = self.http.request(
            "POST",
            f"{self.base_url}/{self.user_id}/threads_publish",
            headers=self.headers,
            query={"creation_id": container_id},
        )
        if not isinstance(data, dict) or not data.get("id"):
            raise RuntimeError("Threads publish response has no id")
        return str(data["id"])

    def reply_to(self, reply_id: str, text: str) -> str:
        data = self.http.request(
            "POST",
            f"{self.base_url}/{self.user_id}/threads",
            headers=self.headers,
            query={
                "text": text,
                "media_type": "TEXT",
                "reply_to_id": reply_id,
                "auto_publish_text": "true",
            },
        )
        if not isinstance(data, dict) or not data.get("id"):
            raise RuntimeError("Threads reply response has no id")
        return str(data["id"])

    def reply_context(
        self,
        root_post_id: str,
        target_reply_id: str,
        *,
        own_username: str = "mononyx",
    ) -> tuple[ReplyContextStatus, str]:
        root_id = quote(root_post_id, safe="")
        root_post = self.http.request(
            "GET",
            f"{self.base_url}/{root_id}",
            headers=self.headers,
            query={"fields": "id,text,username,timestamp,has_replies"},
        )
        conversation = self.http.request(
            "GET",
            f"{self.base_url}/{root_id}/conversation",
            headers=self.headers,
            query={
                "fields": "id,text,username,timestamp,is_reply_owned_by_me,root_post,replied_to",
                "reverse": "true",
                "limit": 50,
            },
        )
        if not isinstance(root_post, dict):
            return "unavailable", "Исходный пост не найден"
        if not isinstance(conversation, dict) or not isinstance(conversation.get("data"), list):
            return "unavailable", "История ветки недоступна"
        replies = [item for item in conversation["data"] if isinstance(item, dict)]
        return build_reply_context(
            root_post,
            replies,
            target_reply_id,
            own_username=own_username,
        )

    def keyword_search(
        self,
        query_text: str,
        *,
        search_type: SearchType,
        search_mode: SearchMode,
        limit: int = 25,
    ) -> list[dict[str, Any]]:
        data = self.http.request(
            "GET",
            f"{self.base_url}/keyword_search",
            headers=self.headers,
            query={
                "q": query_text,
                "search_type": search_type,
                "search_mode": search_mode,
                "fields": "id,text,username,permalink,timestamp",
                "limit": max(1, min(limit, 50)),
            },
        )
        if not isinstance(data, dict) or not isinstance(data.get("data"), list):
            raise RuntimeError("Threads keyword search returned an unexpected response")
        return [item for item in data["data"] if isinstance(item, dict)]
