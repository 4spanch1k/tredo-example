import { fetchJson } from "./http.ts";
import {
  buildPostGenerationUserPrompt,
  generatedPostFromJson,
  POST_GENERATION_SYSTEM_PROMPT,
  type PostGenerationRequest,
} from "./groq.ts";

interface GeminiResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

export const GEMINI_POST_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string" },
    quality: {
      type: "object",
      properties: {
        one_situation: { type: "boolean" },
        clear_connection: { type: "boolean" },
        question_follows: { type: "boolean" },
      },
      required: ["one_situation", "clear_connection", "question_follows"],
    },
  },
  required: ["text", "quality"],
} as const;

// The free Gemini tier currently allows fewer daily calls than the publishing
// cadence requires. One attempt preserves Gemini as the primary writer while
// leaving the remaining slots to the Groq fallback instead of burning quota on
// retries of a rejected draft.
export const MAX_GEMINI_POST_GENERATION_ATTEMPTS = 1;

export function buildGeminiPostRequest(
  request: PostGenerationRequest,
  rejectionReason = "",
): Record<string, unknown> {
  return {
    systemInstruction: {
      parts: [{ text: POST_GENERATION_SYSTEM_PROMPT }],
    },
    contents: [{
      role: "user",
      parts: [{ text: buildPostGenerationUserPrompt(request, rejectionReason) }],
    }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 800,
      thinkingConfig: { thinkingLevel: "low" },
      responseFormat: {
        text: {
          mimeType: "APPLICATION_JSON",
          schema: GEMINI_POST_RESPONSE_SCHEMA,
        },
      },
    },
  };
}

export function extractGeminiPostJson(payload: GeminiResponse): string {
  const content = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!content) {
    const finishReason = payload.candidates?.[0]?.finishReason;
    throw new Error(
      finishReason
        ? `Gemini API returned no generated post (finish=${finishReason})`
        : "Gemini API returned no generated post",
    );
  }
  return content;
}

export function isRetryableGeminiError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Gemini API (?:(?:500|502|503|504):|request failed)/u.test(message);
}

export class GeminiPostGenerator {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async generatePost(request: PostGenerationRequest): Promise<string> {
    let rejectionReason = "";

    for (let attempt = 0; attempt < MAX_GEMINI_POST_GENERATION_ATTEMPTS; attempt += 1) {
      let payload: GeminiResponse;
      try {
        payload = await fetchJson<GeminiResponse>(
          "Gemini API",
          `https://generativelanguage.googleapis.com/v1beta/models/${
            encodeURIComponent(this.model)
          }:generateContent`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-goog-api-key": this.apiKey,
            },
            body: JSON.stringify(buildGeminiPostRequest(request, rejectionReason)),
          },
        );
      } catch (error) {
        if (
          attempt + 1 < MAX_GEMINI_POST_GENERATION_ATTEMPTS && isRetryableGeminiError(error)
        ) {
          continue;
        }
        throw error;
      }

      try {
        return generatedPostFromJson(extractGeminiPostJson(payload), request);
      } catch (error) {
        rejectionReason = error instanceof Error ? error.message : "неизвестная ошибка текста";
      }
    }

    throw new Error(
      `Gemini API generated invalid copy ${MAX_GEMINI_POST_GENERATION_ATTEMPTS} times: ${rejectionReason}`,
    );
  }
}
