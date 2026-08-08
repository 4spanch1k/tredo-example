import { Classifier, isDirectCommercialMessage } from "../_shared/classifier.ts";
import {
  envBoolean,
  envInteger,
  optionalEnv,
  requiredEnv,
  supabaseAdminKey,
} from "../_shared/env.ts";
import { GroqClient } from "../_shared/groq.ts";
import { SupabaseRestClient } from "../_shared/supabase.ts";
import { TelegramClient } from "../_shared/telegram.ts";
import { ThreadsClient } from "../_shared/threads.ts";
import type { ReplyContextResult } from "../_shared/threads.ts";
import type { Classification, InteractionRow, JobResult } from "../_shared/types.ts";

interface InteractionDatabase {
  updateInteraction(id: string, values: Record<string, unknown>): Promise<void>;
}

interface ReplyClient {
  reply(replyToId: string, text: string): Promise<string>;
  replyContext(
    rootPostId: string,
    targetReplyId: string,
    ownUsername?: string,
  ): Promise<ReplyContextResult>;
}

interface NotificationClient {
  send(text: string): Promise<void>;
}

interface ClassifierClient {
  classify(text: string, conversationContext?: string): Promise<Classification>;
}

function existingClassification(interaction: InteractionRow): Classification | null {
  if (!interaction.intent || !interaction.confidence_level) return null;
  return {
    intent: interaction.intent,
    signals: interaction.signals,
    riskFlags: interaction.risk_flags,
    confidenceLevel: interaction.confidence_level,
    botReplyText: interaction.bot_reply_text,
  };
}

export function shouldReply(interaction: InteractionRow, classification: Classification): boolean {
  if (
    interaction.source !== "own_reply" ||
    classification.riskFlags.length > 0 ||
    classification.confidenceLevel !== "high"
  ) return false;

  if (classification.intent === "lead") {
    return isDirectCommercialMessage(interaction.comment_text);
  }

  return classification.intent === "engagement" &&
    classification.botReplyText !== null;
}

export function shouldNotify(classification: Classification): boolean {
  if (classification.riskFlags.length > 0) return true;
  return classification.intent === "lead" &&
    (classification.confidenceLevel === "medium" || classification.confidenceLevel === "high");
}

function alertText(interaction: InteractionRow, classification: Classification): string {
  const username = interaction.username ? `@${interaction.username}` : "неизвестный пользователь";
  const personText = `${username} написал:\n«${interaction.comment_text.trim()}»`;

  if (shouldReply(interaction, classification)) {
    return [
      "Новый лид из Threads 👀",
      personText,
      "Я ответил ему и отправил к вам в WhatsApp.",
    ].join("\n\n");
  }

  if (interaction.source === "keyword_search") {
    return [
      "Нашёл потенциального лида в Threads 👀",
      personText,
      "Я не отвечал ему автоматически. Посмотрите публикацию вручную.",
    ].join("\n\n");
  }

  const reason = classification.riskFlags.includes("context_too_large")
    ? "Ветка слишком длинная для безопасного контекста."
    : classification.riskFlags.includes("context_unavailable")
    ? "Не удалось надёжно восстановить контекст ветки."
    : classification.riskFlags.includes("model_unavailable")
    ? "Модель ответов сейчас перегружена или недоступна."
    : classification.riskFlags.includes("unknown_answer")
    ? "Для точного ответа не хватает подтверждённых данных."
    : "Комментарий требует ручной проверки.";

  return [
    "Нужна ваша помощь с комментарием в Threads",
    personText,
    `${reason} Я остановил автоответ и ничего не стал придумывать.`,
  ].join("\n\n");
}

function deferredClassification(reason: string): Classification {
  return {
    intent: "engagement",
    signals: ["conversation"],
    riskFlags: [reason],
    confidenceLevel: "low",
    botReplyText: null,
  };
}

function sourceReplyId(interaction: InteractionRow): string {
  const separator = interaction.source_item_id.indexOf(":");
  return separator >= 0
    ? interaction.source_item_id.slice(separator + 1)
    : interaction.source_item_id;
}

export async function processInteraction(
  interaction: InteractionRow,
  options: {
    classifier: ClassifierClient;
    database: InteractionDatabase;
    shadowMode: boolean;
    threads: ReplyClient | null;
    telegram: NotificationClient | null;
    ownUsername?: string;
    now?: () => string;
  },
): Promise<void> {
  const now = options.now ?? (() => new Date().toISOString());
  let classification = existingClassification(interaction);

  if (!classification && options.shadowMode) {
    classification = await options.classifier.classify(interaction.comment_text);
  }

  if (!classification && !options.shadowMode) {
    if (!options.threads || !options.telegram) {
      throw new Error("Action clients are required outside shadow mode");
    }

    let conversationContext = "";
    if (interaction.source === "own_reply") {
      if (!interaction.post_id) {
        classification = deferredClassification("context_unavailable");
      } else {
        try {
          const context = await options.threads.replyContext(
            interaction.post_id,
            sourceReplyId(interaction),
            options.ownUsername,
          );
          if (context.status === "ready") {
            conversationContext = context.text;
          } else {
            classification = deferredClassification(
              context.status === "too_large" ? "context_too_large" : "context_unavailable",
            );
          }
        } catch {
          classification = deferredClassification("context_unavailable");
        }
      }
    }

    if (!classification) {
      try {
        classification = await options.classifier.classify(
          interaction.comment_text,
          conversationContext,
        );
      } catch {
        classification = deferredClassification("model_unavailable");
      }
    }
  }

  if (!classification) throw new Error("Interaction classification is unavailable");
  const classificationValues = {
    intent: classification.intent,
    signals: classification.signals,
    risk_flags: classification.riskFlags,
    confidence_level: classification.confidenceLevel,
    bot_reply_text: classification.botReplyText,
    is_lead: classification.intent === "lead",
    last_error: null,
  };

  if (options.shadowMode) {
    await options.database.updateInteraction(interaction.id, {
      ...classificationValues,
      status: "classified",
      processing_started_at: null,
      next_retry_at: null,
      processed_at: now(),
    });
    return;
  }

  if (!options.threads || !options.telegram) {
    throw new Error("Action clients are required outside shadow mode");
  }

  // Keep the row leased until every required side effect is persisted.
  await options.database.updateInteraction(interaction.id, classificationValues);

  if (shouldReply(interaction, classification) && !interaction.reply_sent) {
    if (!classification.botReplyText) throw new Error("Required reply text is empty");
    await options.threads.reply(sourceReplyId(interaction), classification.botReplyText);
    await options.database.updateInteraction(interaction.id, { reply_sent: true });
  }

  if (shouldNotify(classification) && !interaction.notification_sent) {
    await options.telegram.send(alertText(interaction, classification));
    await options.database.updateInteraction(interaction.id, { notification_sent: true });
  }

  await options.database.updateInteraction(interaction.id, {
    status: "actioned",
    processing_started_at: null,
    next_retry_at: null,
    processed_at: now(),
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown processing error";
}

export async function runInteractionProcessor(): Promise<JobResult> {
  const shadowMode = envBoolean("SHADOW_MODE", true);
  const batchSize = envInteger("INTERACTION_BATCH_SIZE", 5, 25);
  const maxAttempts = envInteger("MAX_ATTEMPTS", 5, 20);
  const database = new SupabaseRestClient(requiredEnv("SUPABASE_URL"), supabaseAdminKey());
  const whatsappLink = optionalEnv("WHATSAPP_CONTACT_LINK") ?? "";
  if (!shadowMode && !whatsappLink) requiredEnv("WHATSAPP_CONTACT_LINK");
  const contentProfile = await database.getActiveContentProfile();
  const businessContext = contentProfile
    ? [
      contentProfile.business_context,
      `Целевая аудитория: ${contentProfile.target_audience}`,
      `Тон общения: ${contentProfile.tone_of_voice}`,
    ].join("\n\n")
    : "";
  const classifier = new Classifier(
    new GroqClient(
      requiredEnv("GROQ_API_KEY"),
      optionalEnv("GROQ_MODEL") ?? "llama-3.3-70b-versatile",
    ),
    whatsappLink,
    businessContext,
  );
  const threads = shadowMode
    ? null
    : new ThreadsClient(requiredEnv("THREADS_ACCESS_TOKEN"), requiredEnv("THREADS_USER_ID"));
  const telegram = shadowMode
    ? null
    : new TelegramClient(requiredEnv("TELEGRAM_BOT_TOKEN"), requiredEnv("TELEGRAM_CHAT_ID"));

  const interactions = await database.claimInteractions(batchSize, maxAttempts);
  let processed = 0;
  let failed = 0;
  for (const interaction of interactions) {
    try {
      await processInteraction(interaction, {
        classifier,
        database,
        shadowMode,
        threads,
        telegram,
        ownUsername: optionalEnv("OWN_THREADS_USERNAME") ?? "mononyx",
      });
      processed += 1;
    } catch (error) {
      failed += 1;
      console.error(JSON.stringify({
        event: "interaction_failed",
        interaction_id: interaction.id,
        message: message(error),
      }));
      await database.markInteractionFailed(interaction.id, message(error), maxAttempts);
    }
  }

  return { claimed: interactions.length, processed, failed };
}
