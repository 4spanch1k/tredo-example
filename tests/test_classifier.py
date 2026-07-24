from __future__ import annotations

import unittest

from bot.classifier import Classifier
from bot.groq import GroqEvidence


class FakeGroq:
    def __init__(self, evidence: GroqEvidence) -> None:
        self.evidence = evidence
        self.calls = 0

    def classify(self, text: str) -> GroqEvidence:
        self.calls += 1
        return self.evidence


class ClassifierTests(unittest.TestCase):
    def test_explicit_need_is_high_confidence_without_llm(self) -> None:
        groq = FakeGroq(GroqEvidence("spam", (), (), None))
        classifier = Classifier(groq, "https://wa.me/77000000000")

        result = classifier.classify("Нужен сайт для нашего магазина")

        self.assertEqual(result.intent, "lead")
        self.assertEqual(result.confidence_level, "high")
        self.assertIn("https://wa.me/77000000000", result.bot_reply_text or "")
        self.assertEqual(groq.calls, 0)

    def test_ambiguous_message_uses_evidence_but_not_llm_confidence(self) -> None:
        groq = FakeGroq(GroqEvidence("engagement", ("conversation", "praise"), (), "Спасибо!"))
        classifier = Classifier(groq)

        result = classifier.classify("Интересно, расскажите подробнее")

        self.assertEqual(result.intent, "engagement")
        self.assertEqual(result.confidence_level, "high")
        self.assertEqual(result.bot_reply_text, "Спасибо!")
        self.assertEqual(groq.calls, 1)

    def test_supportive_comment_gets_human_reply_without_whatsapp(self) -> None:
        groq = FakeGroq(
            GroqEvidence(
                "engagement",
                ("conversation", "praise"),
                (),
                "Вот именно 😅 иначе запись превращается в квест.",
            )
        )
        classifier = Classifier(groq, "https://wa.me/77000000000")

        result = classifier.classify("Класс, у меня было так же")

        self.assertEqual(result.intent, "engagement")
        self.assertEqual(
            result.bot_reply_text,
            "Вот именно 😅 иначе запись превращается в квест.",
        )
        self.assertNotIn("wa.me", result.bot_reply_text or "")

    def test_criticism_is_ignored(self) -> None:
        groq = FakeGroq(GroqEvidence("engagement", ("criticism",), (), "Давайте поспорим"))
        classifier = Classifier(groq)

        result = classifier.classify("Не согласен, это ерунда. Почему вы так решили?")

        self.assertEqual(result.intent, "engagement")
        self.assertIn("criticism", result.signals)
        self.assertIsNone(result.bot_reply_text)
        self.assertEqual(groq.calls, 0)

    def test_risk_flag_blocks_reply(self) -> None:
        groq = FakeGroq(GroqEvidence("lead", (), (), None))
        classifier = Classifier(groq)

        result = classifier.classify("Вы мошенники, я подам в суд")

        self.assertIn("complaint", result.risk_flags)
        self.assertIn("legal", result.risk_flags)
        self.assertIsNone(result.bot_reply_text)
        self.assertEqual(groq.calls, 0)

    def test_sarcastic_paraphrase_is_not_a_lead(self) -> None:
        groq = FakeGroq(
            GroqEvidence(
                "lead",
                ("explicit_need", "service_interest"),
                (),
                "Давайте обсудим сайт.",
            )
        )
        classifier = Classifier(groq)

        result = classifier.classify(
            "Перевожу: у вас нет сайта или он настолько плох, что никто не покупает без менеджера"
        )

        self.assertEqual(result.intent, "engagement")
        self.assertEqual(result.confidence_level, "high")
        self.assertIsNone(result.bot_reply_text)
        self.assertNotIn("explicit_need", result.signals)


if __name__ == "__main__":
    unittest.main()
