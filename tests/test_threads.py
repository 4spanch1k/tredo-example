from __future__ import annotations

import unittest

from bot.threads import build_reply_context


class ThreadsContextTests(unittest.TestCase):
    def test_context_follows_only_the_current_branch(self) -> None:
        status, context = build_reply_context(
            {"id": "root", "text": "Цена спрятана на сайте.", "username": "mononyx"},
            [
                {
                    "id": "first",
                    "text": "Да, особенно когда пишут «цена в директ»",
                    "username": "reader",
                    "replied_to": {"id": "root"},
                },
                {
                    "id": "our-reply",
                    "text": "Один ответ превратили в квест 😅",
                    "username": "mononyx",
                    "is_reply_owned_by_me": True,
                    "replied_to": {"id": "first"},
                },
                {
                    "id": "follow-up",
                    "text": "А если стоимость зависит от задачи?",
                    "username": "reader",
                    "replied_to": {"id": "our-reply"},
                },
                {
                    "id": "other",
                    "text": "Другая ветка",
                    "username": "someone",
                    "replied_to": {"id": "root"},
                },
            ],
            "follow-up",
        )

        self.assertEqual(status, "ready")
        self.assertIn("Цена спрятана", context)
        self.assertIn("стоимость зависит", context)
        self.assertNotIn("Другая ветка", context)

    def test_context_stops_on_missing_parent(self) -> None:
        status, _ = build_reply_context(
            {"id": "root", "text": "Исходный пост"},
            [
                {
                    "id": "follow-up",
                    "text": "Продолжение",
                    "replied_to": {"id": "missing"},
                }
            ],
            "follow-up",
        )

        self.assertEqual(status, "unavailable")


if __name__ == "__main__":
    unittest.main()
