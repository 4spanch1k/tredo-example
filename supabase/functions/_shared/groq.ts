import { fetchJson } from "./http.ts";
import type { Intent } from "./types.ts";

const ALLOWED_SIGNALS = new Set([
  "explicit_need",
  "vendor_search",
  "pricing",
  "timeline",
  "contact_intent",
  "service_interest",
  "service_scope",
  "conversation",
  "praise",
  "criticism",
  "promotion",
  "irrelevant",
]);

const ALLOWED_RISKS = new Set([
  "aggression",
  "complaint",
  "legal",
  "reputation",
  "personal_data",
  "unknown_answer",
]);

const BANNED_COPY_MARKERS = [
  "в современном мире",
  "ни для кого не секрет",
  "вы когда-нибудь задумывались",
  "давайте разберёмся",
  "важно понимать",
  "ключевую роль",
  "вывести бизнес на новый уровень",
  "мощный инструмент продаж",
  "уникальное решение",
  "инновационный подход",
  "открывает новые возможности",
  "максимизировать эффективность",
  "повысить узнаваемость",
  "играет важную роль",
  "является свидетельством",
  "подчёркивает",
  "подчеркивает",
  "многогранн",
  "путешествие",
  "по-настоящему",
  "по настоящему",
  "безусловно",
  "более того",
  "кроме того",
  "таким образом",
  "стоит отметить",
  "подводя итог",
  "в заключение",
  "готовы начать",
];

const ALLOWED_LATIN_WORDS = new Set([
  "ai",
  "google",
  "instagram",
  "mononyx",
  "roi",
  "telegram",
  "threads",
  "whatsapp",
]);

const PRICE_SERVICE_RULES: Record<string, { label: string; pattern: RegExp }> = {
  "79900": { label: "лендинг", pattern: /лендинг/iu },
  "99900": {
    label: "ИИ-агент",
    pattern: /(?:ии|ai)[\s-]*агент/iu,
  },
  "149900": { label: "многостраничный сайт", pattern: /многостраничн/iu },
};

const PRICE_FOCUSED_ANGLE = /(?:цен|стоимост|бюджет|подрядчик|лендинг, а когда многостраничный)/iu;
const OUTCOME_PROMISE =
  /(?:принес[её]т|принос\p{L}*|даст|обеспечит|увеличит|поднимет|привед[её]т)[\s\S]{0,60}(?:заявк|продаж|клиент|roi)/iu;
const GUARANTEED_BUSINESS_OUTCOME =
  /гарант\p{L}*[\s\S]{0,60}(?:продаж|заявк|клиент|рост|roi|окупаем)/iu;
const SEARCH_RANKING_PROMISE =
  /(?:(?:вывед|подним|попад|окаж|буд)\p{L}*[\s\S]{0,50}(?:топ|перв\p{L}*\s+(?:мест|позици|страниц))|(?:топ|перв\p{L}*\s+(?:мест|позици|страниц))[\s\S]{0,50}(?:гарант|обеспеч|вывед|подним|попад|окаж|буд)\p{L}*)[\s\S]{0,50}(?:google|гугл|поиск)/iu;
const GUARANTEED_TIMELINE =
  /(?:гарант\p{L}*[\s\S]{0,50}(?:срок|дн|недел|месяц)|(?:сделаем|запустим|сдадим|будет готов)\p{L}*[\s\S]{0,30}\bза\s+\d+)/iu;
const LEGAL_OR_FINANCIAL_GUARANTEE =
  /(?:(?:юридическ|финансов)\p{L}*[\s\S]{0,50}гарант|гарант\p{L}*[\s\S]{0,50}(?:юридическ|финансов)\p{L}*)/iu;
const OFF_PLATFORM_CTA =
  /(?:подпиш(?:итесь|ись)|подписывай(?:тесь|ся)|переход(?:ите|и)|перейд(?:ите|и)|(?:пиш|напиш)(?:и|ите)\s+(?:мне\s+)?(?:в\s+)?(?:whatsapp|telegram|личк))/iu;
const GENERIC_POST_PHRASES = [
  "мы можем помочь",
  "действительно",
  "получить результат",
  "сервисные бизнесы",
  "контент и функционал",
  "слишком много кликать",
  "как будет обеспечена поддержка",
  "для бизнеса в казахстане",
  "какую основную цель вы хотели бы видеть",
  "какую основную проблему вы хотели бы решить",
  "потенциальный лендинг",
  "под задачу бизнеса",
  "пользовательский путь",
  "пользовательский сценарий",
  "путь до обращения",
  "где он теряется",
  "прося запись",
  "согласованную задачу",
  "целевое действие",
  "передать автоматике",
];
const ACQUISITION_CLAIM = /привлеч\p{L}*\s+(?:заявк|клиент)/iu;
const SPLIT_NASKOLKO = /(?:^|[^\p{L}])на\s+сколько\s+(?:глубоко|быстро|удобно)(?:$|[^\p{L}])/iu;
const AMBIGUOUS_BOT_HOURS = /(?:^|[^\p{L}])после\s+часа\s+работы\s+бота(?:$|[^\p{L}])/iu;
const UNSUPPORTED_PERSONAL_IDENTITY = /(?:менеджер|клиент|владелец|директор)\s+[А-ЯЁ][а-яё]+/u;
const SERVICE_MENTION =
  /(?:лендинг|сайт|приложени\p{L}*|(?:ии|ai)[\s-]*агент\p{L}*|(?:whatsapp|telegram)[\s/-]*бот|бот\p{L}*|автоответ\p{L}*|автоматизац\p{L}*)/iu;
const BUSINESS_TOPIC =
  /(?:бизнес|компан|команд|сотрудник|предпринимател|клиент|покупател|заказчик|менеджер|заявк|обращени|запис|услуг|цен|форма|отзыв|проект|подрядчик|домен|уведомлен|аккаунт|директ|whatsapp|telegram)/iu;
const GENERIC_ENGAGEMENT_QUESTION =
  /(?:что\s+(?:вы\s+)?(?:об\s+этом\s+)?думаете|согласны(?:\s+со\s+мной)?|как\s+вам(?:\s+такой)?|насколько[\s\S]{0,80}важн\p{L}*[^?]{0,80})[?!.\s]*$/iu;
const AGENCY_WORK =
  /(?:мы|команд\p{L}*|агентств\p{L}*|mononyx{1,2})[\s\S]{0,240}(?:бер[её]м|дела\p{L}*|созда\p{L}*|собира\p{L}*|проектир\p{L}*|разрабатыва\p{L}*|настраива\p{L}*|пересобира\p{L}*|упроща\p{L}*|сокраща\p{L}*|фиксир\p{L}*|автоматизир\p{L}*|превраща\p{L}*|запуска\p{L}*|помога\p{L}*|начина\p{L}*|отда[её]\p{L}*|убира\p{L}*|счита\p{L}*|разбира\p{L}*)/iu;
const SELLING_ANGLE = /формат:\s*продающ/iu;
const ADVERTISING_EMOJI = /[🚀🔥✨🎯📈✅💡]/u;
const EMOJI = /\p{Extended_Pictographic}/gu;
const SEARCH_VERB_GRAMMAR_ERROR = /(?:что|где)\s+(?:вы\s+)?(?:обычно\s+)?ищите(?:$|[^\p{L}])/iu;
const CONCRETE_POST_ACTION =
  /(?:наж\p{L}*|пиш\p{L}*|ищ\p{L}*|иск\p{L}*|жд\p{L}*|отвеч\p{L}*|открыва\p{L}*|закрыва\p{L}*|запис\p{L}*|спрашива\p{L}*|зада\p{L}*|выбира\p{L}*|отправля\p{L}*|звон\p{L}*|скачива\p{L}*|возвраща\p{L}*|сравнива\p{L}*|оставля\p{L}*|переход\p{L}*|заказыва\p{L}*|показ\p{L}*|смотр\p{L}*|чита\p{L}*|объясня\p{L}*|понима\p{L}*|начина\p{L}*|копир\p{L}*|прос\p{L}*|пута\p{L}*|рассказыва\p{L}*|встреча\p{L}*|перевод\p{L}*|хран\p{L}*|оформ\p{L}*|готов\p{L}*|отключ\p{L}*|перенос\p{L}*|теря\p{L}*|зна\p{L}*|отмеч\p{L}*|отслеж\p{L}*)/iu;
const ENGAGEMENT_REPLY_SALES_LANGUAGE =
  /(?:whatsapp|telegram|wa\.me|напиш\p{L}*\s+(?:нам|мне|в)|остав\p{L}*\s+(?:номер|заявк)|закаж\p{L}*|стоимост|цена|мы\s+(?:делаем|разрабатываем|настраиваем|можем\s+помочь))/iu;
const BOT_LIKE_ENGAGEMENT_REPLY =
  /(?:спасибо\s+за\s+(?:ваш[еу]?|обратную)\s*(?:связь|мнение|комментарий)?|благодарим|рады,\s+что|ваше\s+мнение\s+важно|обращайтесь|чем\s+ещ[её]\s+могу\s+помочь)/iu;
const EMPTY_ENGAGEMENT_REPLY =
  /(?:это\s+хороший\s+вопрос|зависит\s+от\s+того|интересн\p{L}*\s+(?:мысль|точка\s+зрения|классификация|вопрос)|(?:удобство|ясность|честность|спокойствие)\p{L}*[\s\S]{0,50}(?:важн|лучше)|действительно\s+(?:важн|многое)|как\s+можно\s+было\s+бы\s+улучшить|всегда\s+приятно|автоматизация\s+может|тонкий\s+момент|просто\s+обсуждаем)/iu;
const SIMILARITY_STOP_WORDS = new Set([
  "будет",
  "если",
  "когда",
  "который",
  "можно",
  "нужно",
  "обычно",
  "потом",
  "потому",
  "сами",
  "сразу",
  "только",
  "чтобы",
  "этого",
  "этот",
  "этой",
  "очень",
]);

export const MIN_GENERATED_POST_CHARACTERS = 45;
export const MAX_GENERATED_POST_CHARACTERS = 240;
export const MAX_POST_GENERATION_ATTEMPTS = 2;
export const POST_PROMPT_RECENT_LIMIT = 12;

interface NumericMention {
  normalized: string;
  index: number;
}

function numericMentions(text: string): NumericMention[] {
  const pattern = /\d{1,3}(?:[ .,\u00a0\u202f]\d{3})+|\d+/gu;
  return Array.from(text.matchAll(pattern), (match) => ({
    normalized: match[0].replace(/\D/gu, ""),
    index: match.index ?? 0,
  }));
}

function surroundingContext(text: string, index: number, radius = 120): string {
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + radius));
}

function postTokens(text: string): Set<string> {
  const words = text.toLocaleLowerCase("ru").match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(
    words
      .filter((word) => word.length >= 4 && !SIMILARITY_STOP_WORDS.has(word))
      .map((word) => word.length > 7 ? word.slice(0, 7) : word),
  );
}

function normalizePostForExactMatch(text: string): string {
  return text
    .toLocaleLowerCase("ru")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function isGeneratedPostExactDuplicate(text: string, posts: string[]): boolean {
  const normalized = normalizePostForExactMatch(text);
  return posts.some((post) => normalizePostForExactMatch(post) === normalized);
}

export function isGeneratedPostTooSimilar(text: string, recentPosts: string[]): boolean {
  if (isGeneratedPostExactDuplicate(text, recentPosts)) return true;

  const candidate = postTokens(text);
  if (candidate.size < 3) return false;

  return recentPosts.some((recentPost) => {
    const recent = postTokens(recentPost);
    if (recent.size < 3) return false;
    let shared = 0;
    for (const token of candidate) {
      if (recent.has(token)) shared += 1;
    }
    const overlap = shared / Math.min(candidate.size, recent.size);
    return (shared >= 3 && overlap >= 0.65) || (shared >= 2 && overlap >= 0.8);
  });
}

function postHookFamily(text: string): string {
  const opening = text.trim().toLocaleLowerCase("ru");
  if (
    /^(?:заходишь|нажимаешь|хочешь|пишешь|ищешь|скачиваешь|листаешь|открываешь|заполняешь|пытаешься|читаешь)/u
      .test(opening)
  ) return "second_person_action";
  if (
    /^(?:клиент|менеджер|владелец|предприниматель|человек|бизнес)(?:\s|[.,:!?])/u.test(opening)
  ) {
    return "third_person_scene";
  }
  if (
    /^(?:сайт|бот|лендинг|форма|кнопка|цена|приложение|прайс)(?:\s|[.,:!?])/u.test(opening)
  ) {
    return "subject_statement";
  }
  if (
    /^(?:странно|забавно|иногда|по факту|есть ощущение|кажется|люблю|не люблю)(?:\s|[.,:!?])/u
      .test(opening)
  ) {
    return "opinion";
  }
  if (/^[«"“]/u.test(opening)) return "quote";
  return "other";
}

function postQuestionFamily(text: string): string {
  const questionStart = text.lastIndexOf(".");
  const question = text.slice(questionStart >= 0 ? questionStart + 1 : 0).toLocaleLowerCase("ru");
  if (/\bили\b|что\s+.+\s+сильнее|что\s+.+\s+больше/u.test(question)) return "binary";
  if (/сколько|насколько|как\s+долго|после\s+какого/u.test(question)) return "threshold";
  if (/бывало|сталкивались|случалось|какой\s+случай|как\s+у\s+вас/u.test(question)) {
    return "experience";
  }
  if (/что\s+(?:вы\s+)?делаете|как\s+(?:вы\s+)?поступаете|какой\s+вопрос/u.test(question)) {
    return "open_action";
  }
  return "other";
}

export function generatedPostVarietyIssue(text: string, recentPosts: string[]): string | null {
  const recent = recentPosts.slice(0, 6);
  if (recent.length === 0) return null;

  const hookFamily = postHookFamily(text);
  if (hookFamily !== "other" && postHookFamily(recent[0]) === hookFamily) {
    return `начало повторяет предыдущий шаблон ${hookFamily}`;
  }
  const repeatedHooks =
    recent.slice(0, 4).filter((post) => postHookFamily(post) === hookFamily).length;
  if (hookFamily !== "other" && repeatedHooks >= 2) {
    return `начало повторяет недавний шаблон ${hookFamily}`;
  }

  const questionFamily = postQuestionFamily(text);
  if (questionFamily !== "other" && postQuestionFamily(recent[0]) === questionFamily) {
    return `вопрос повторяет предыдущий шаблон ${questionFamily}`;
  }
  const repeatedQuestions =
    recent.slice(0, 4).filter((post) => postQuestionFamily(post) === questionFamily).length;
  if (questionFamily !== "other" && repeatedQuestions >= 2) {
    return `вопрос повторяет недавний шаблон ${questionFamily}`;
  }

  const candidateEmoji = new Set(Array.from(text.matchAll(EMOJI), (match) => match[0]));
  if (candidateEmoji.size > 0) {
    const lastTwo = recent.slice(0, 2);
    if (
      lastTwo.length === 2 && lastTwo.every((post) => Array.from(post.matchAll(EMOJI)).length > 0)
    ) {
      return "эмодзи уже использованы в двух последних постах";
    }
    for (const post of lastTwo) {
      for (const emoji of candidateEmoji) {
        if (post.includes(emoji)) return `эмодзи ${emoji} недавно уже использован`;
      }
    }
  }

  const opening = (value: string) =>
    (value.toLocaleLowerCase("ru").match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 2).join(" ");
  const openingSignature = opening(text);
  if (
    openingSignature.split(" ").length === 2 &&
    recent.some((post) => opening(post) === openingSignature)
  ) {
    return `начальные слова «${openingSignature}» недавно уже использованы`;
  }

  return null;
}

export function assertGeneratedCopy(text: string, businessContext: string): void {
  const normalizedText = text.toLocaleLowerCase("ru");
  const marker = BANNED_COPY_MARKERS.find((value) => normalizedText.includes(value));
  if (marker) throw new Error(`Generated copy contains banned wording: ${marker}`);
  if (/не\s+просто\b[\s\S]{0,120}\bа\b/iu.test(text)) {
    throw new Error("Generated copy contains a banned artificial contrast");
  }
  if (/(?:это\s+не|речь\s+не\s+о)\b[\s\S]{0,120}\bа\b/iu.test(text)) {
    throw new Error("Generated copy contains a banned artificial contrast");
  }

  for (const match of text.matchAll(/\p{Script=Latin}+/gu)) {
    const word = match[0].toLocaleLowerCase("en");
    if (!ALLOWED_LATIN_WORDS.has(word)) {
      throw new Error(`Generated copy contains an unsupported Latin word: ${word}`);
    }
  }

  const allowedNumbers = new Set(
    numericMentions(businessContext).map((mention) => mention.normalized),
  );
  for (const mention of numericMentions(text)) {
    if (!allowedNumbers.has(mention.normalized)) {
      throw new Error(`Generated copy contains an unsupported number: ${mention.normalized}`);
    }
    const serviceRule = PRICE_SERVICE_RULES[mention.normalized];
    if (serviceRule) {
      const prefix = text.slice(Math.max(0, mention.index - 20), mention.index);
      if (!/(?:^|[\s([{"«])от[\s:–—-]*$/iu.test(prefix)) {
        throw new Error("Generated copy mentions a price without the required 'от' qualifier");
      }
      if (!serviceRule.pattern.test(surroundingContext(text, mention.index))) {
        throw new Error(
          `Generated copy uses the ${mention.normalized} price without naming ${serviceRule.label}`,
        );
      }
    }
  }
}

export function assertGeneratedReplyCopy(text: string, businessContext: string): void {
  assertGeneratedCopy(text, businessContext);

  if (OUTCOME_PROMISE.test(text) || ACQUISITION_CLAIM.test(text)) {
    throw new Error("Generated reply promises leads, clients, or sales");
  }
  if (GUARANTEED_BUSINESS_OUTCOME.test(text) || GUARANTEED_TIMELINE.test(text)) {
    throw new Error("Generated reply contains an unsupported guarantee");
  }
  if (SEARCH_RANKING_PROMISE.test(text) || LEGAL_OR_FINANCIAL_GUARANTEE.test(text)) {
    throw new Error("Generated reply contains an unsupported promise");
  }
}

export function assertGeneratedEngagementReplyCopy(
  text: string,
  businessContext: string,
): void {
  assertGeneratedCopy(text, businessContext);

  if (Array.from(text).length > 180) {
    throw new Error("Generated engagement reply is longer than 180 characters");
  }
  if (ENGAGEMENT_REPLY_SALES_LANGUAGE.test(text)) {
    throw new Error("Generated engagement reply contains sales or contact language");
  }
  if (BOT_LIKE_ENGAGEMENT_REPLY.test(text)) {
    throw new Error("Generated engagement reply sounds like a support bot");
  }
  if (EMPTY_ENGAGEMENT_REPLY.test(text)) {
    throw new Error("Generated engagement reply only repeats a generic agreement");
  }
  if (numericMentions(text).length > 0) {
    throw new Error("Generated engagement reply contains a number");
  }
  if (Array.from(text.matchAll(EMOJI)).length > 1) {
    throw new Error("Generated engagement reply contains more than one emoji");
  }
}

export function assertGeneratedPostCopy(
  text: string,
  businessContext: string,
  contentAngle: string,
): void {
  assertGeneratedCopy(text, businessContext);

  if (OUTCOME_PROMISE.test(text)) {
    throw new Error("Generated post promises an uncontrolled business outcome");
  }

  if (LEGAL_OR_FINANCIAL_GUARANTEE.test(text)) {
    throw new Error("Generated post contains a legal or financial guarantee");
  }

  if (GUARANTEED_BUSINESS_OUTCOME.test(text)) {
    throw new Error("Generated post guarantees an uncontrolled business outcome");
  }

  if (ACQUISITION_CLAIM.test(text)) {
    throw new Error("Generated post implies that the service will attract leads or clients");
  }

  if (SEARCH_RANKING_PROMISE.test(text)) {
    throw new Error("Generated post promises an uncontrolled search ranking");
  }

  if (GUARANTEED_TIMELINE.test(text)) {
    throw new Error("Generated post guarantees a delivery timeline");
  }

  if (OFF_PLATFORM_CTA.test(text)) {
    throw new Error("Generated post contains an off-platform or subscription CTA");
  }

  if (SPLIT_NASKOLKO.test(text)) {
    throw new Error("Generated post contains the split spelling 'на сколько'");
  }

  if (AMBIGUOUS_BOT_HOURS.test(text)) {
    throw new Error("Generated post contains an ambiguous bot-hours phrase");
  }

  if (UNSUPPORTED_PERSONAL_IDENTITY.test(text)) {
    throw new Error("Generated post invents a personal identity");
  }

  if (SEARCH_VERB_GRAMMAR_ERROR.test(text)) {
    throw new Error("Generated post uses 'ищите' instead of 'ищете'");
  }

  const normalizedText = text.toLocaleLowerCase("ru");
  const genericPhrase = GENERIC_POST_PHRASES.find((phrase) => normalizedText.includes(phrase));
  if (genericPhrase) {
    throw new Error(`Generated post contains generic sales wording: ${genericPhrase}`);
  }

  const containsKnownPrice = numericMentions(text).some((mention) =>
    mention.normalized in PRICE_SERVICE_RULES
  );
  if (containsKnownPrice && !PRICE_FOCUSED_ANGLE.test(contentAngle)) {
    throw new Error("Generated post mentions prices outside a price-focused content angle");
  }

  if (Array.from(text).length > MAX_GENERATED_POST_CHARACTERS) {
    throw new Error(`Generated post exceeds ${MAX_GENERATED_POST_CHARACTERS} characters`);
  }

  if (Array.from(text).length < MIN_GENERATED_POST_CHARACTERS) {
    throw new Error(`Generated post is shorter than ${MIN_GENERATED_POST_CHARACTERS} characters`);
  }

  if (!SERVICE_MENTION.test(text) && !BUSINESS_TOPIC.test(text)) {
    throw new Error("Generated post is outside the Mononyx business context");
  }

  const topicIssue = generatedPostTopicIssue(text, contentAngle);
  if (topicIssue) throw new Error(topicIssue);

  if (GENERIC_ENGAGEMENT_QUESTION.test(text.trim())) {
    throw new Error("Generated post ends with a generic engagement question");
  }

  const questionMarks = Array.from(text).filter((character) => character === "?").length;
  if (questionMarks > 1) {
    throw new Error("Generated post contains more than one question");
  }

  if (text.includes("—")) {
    throw new Error("Generated post contains a long dash");
  }

  if (/#\p{L}+/u.test(text)) {
    throw new Error("Generated post contains a hashtag");
  }

  const emojiCount = Array.from(text.matchAll(EMOJI)).length;
  if (emojiCount > 2) {
    throw new Error("Generated post contains more than two emoji");
  }
  if (ADVERTISING_EMOJI.test(text)) {
    throw new Error("Generated post contains an advertising emoji");
  }

  const selling = SELLING_ANGLE.test(contentAngle);
  if (!CONCRETE_POST_ACTION.test(text)) {
    throw new Error("Generated post does not contain a concrete action or situation");
  }
  if (!selling && questionMarks !== 1) {
    throw new Error("Conversational post must contain one specific question");
  }
  if (selling && !AGENCY_WORK.test(text)) {
    throw new Error("Selling post does not state what the agency does");
  }
  if (!selling && AGENCY_WORK.test(text)) {
    throw new Error("Non-selling post contains an agency offer");
  }
}

const POST_TOPIC_SIGNALS: Record<string, RegExp> = {
  "клиентский сервис": /(?:клиент|запис|сообщени|ответ|подтверждени|часы\s+работ)/iu,
  "удобство сайта": /(?:сайт|страниц|карточк|кнопк|меню|форм|цен|загрузк)/iu,
  "доверие к бизнесу":
    /(?:довер|отзыв|портфолио|пример\p{L}*\s+работ|фото|конкурент|новост|контакт|расхожд)/iu,
  "работа над digital-проектом": /(?:проект|тз|подрядчик|домен|доступ|правк|решени|запуск)/iu,
  "автоматизация рутины": /(?:бот|автоответ|автоматиза|автоматич|вручн|рутин|таблиц|данн)/iu,
  "мобильные продукты": /(?:приложени|уведомлен|аккаунт|главн\p{L}*\s+экран)/iu,
  "внутренние процессы бизнеса":
    /(?:менеджер|чат|директ|whatsapp|telegram|обращени|команд|сотрудник)/iu,
};

export function generatedPostTopicIssue(text: string, contentAngle: string): string | null {
  const topic = /ТЕМА:\s*([^.]*)/iu.exec(contentAngle)?.[1]?.trim().toLocaleLowerCase("ru");
  if (!topic) return null;
  const signals = POST_TOPIC_SIGNALS[topic];
  if (!signals) return `Generated post uses an unsupported content topic: ${topic}`;
  return signals.test(text)
    ? null
    : `Generated post drifted away from the required topic: ${topic}`;
}

export function normalizeGeneratedPostCopy(text: string, _contentAngle: string): string {
  return text.trim();
}

export const POST_GENERATION_SYSTEM_PROMPT = [
  "Ты пишешь посты для Threads от лица живого человека из веб- и digital-агентства Mononyx в Казахстане. Агентство делает сайты, лендинги, мобильные приложения, AI-ботов и автоматизацию для бизнеса.",
  "Твоя задача не создавать контент по шаблону, а показывать знакомые, спорные или смешные ситуации предпринимателей так, чтобы текст был понятен с первого чтения и на него хотелось ответить.",
  "Одна публикация означает одну основную мысль. Пост может быть наблюдением, вопросом, спорным мнением, маленькой сценой или спокойным предложением услуги. Не пытайся совместить всё сразу.",
  "Все фразы должны описывать одну и ту же ситуацию. Не меняй героя, услугу, проблему или вывод посреди поста. Последний вопрос должен прямо продолжать предыдущую фразу, а не открывать новую тему. У каждого «он», «это» и «так» должен быть понятный смысл.",
  "Пиши по-русски от 45 до 240 символов с пробелами. Используй две-три короткие фразы: понятная ситуация, простой поворот и лёгкая точка входа в комментарии. Не повторяй тему, пример, формулировку, вопрос и начало ни одного недавнего поста.",
  "Недавние посты важнее привычного шаблона. Новый пост не должен начинаться тем же способом, что предыдущий: после действия читателя начни с мнения, предмета, реплики или героя; после сцены с героем выбери другой ход. Не повторяй первые два слова недавних постов. Не используй тот же тип вопроса, что в предыдущем посте.",
  "В контентном ракурсе указана ТЕМА. Это обязательная рубрика публикации, а не подсказка. Не подменяй её привычным разговором про кнопку, цену, форму или потерянную заявку. Если тема про процессы, проект, доверие, автоматизацию или приложение, весь пост остаётся внутри этой темы.",
  "Пиши как человек из современного интернета, а не копирайтер, преподаватель или корпоративный блог. Используй простые конкретные слова, короткие фразы и иногда разговорную шероховатость: «если честно», «по факту», «ну такое», «вот и думай». Не больше одного разговорного выражения на пост и не в каждом посте.",
  "Всегда показывай проблему через конкретное действие: человек ищет цену, нажимает кнопку, ждёт ответа, пишет менеджеру, пытается записаться или сравнивает варианты. Не публикуй абстрактную мысль без понятного примера.",
  "Контентный ракурс содержит формат. Если формат наблюдение, обсуждение или мнение, не добавляй фразу о том, что делает Mononyx, и не продавай услугу. Если формат продающий, сначала покажи ситуацию, затем конкретную проблему, коротко скажи, что мы делаем, и дай один спокойный призыв.",
  "Не продавай в каждом посте. Не перечисляй все услуги сразу. Не дави, не создавай дефицит и не обещай результат. Нормальные призывы для продающего формата: «Могу показать демо», «Если актуально, напишите», «Можем разобрать ваш случай».",
  "В каждом непродающем посте должен быть ровно один короткий и конкретный вопрос, на который легко ответить своим опытом или выбрать один из двух вариантов. Варьируй форму вопроса. Не используй «Что думаете?», «Согласны?» и «Как вам?» без контекста.",
  "Эмодзи не обязательны. Большинство постов пиши без них. Если в двух последних публикациях есть эмодзи, новый пост должен быть без эмодзи. Не повторяй один и тот же эмодзи в соседних постах. Для редкой реакции подходят 😅, 👀, 🙂, 🤝, 🫠, 😂, 🤔, 🥲, 👍. Не используй рекламный набор 🚀, 🔥, ✨, 🎯, 📈, ✅, 💡.",
  "Не используй длинное тире, хэштеги, заголовок, формальный список и конструкцию «не просто X, а Y». Не группируй мысли по три ради красивой структуры.",
  "Хороший ритм: конкретная сцена, короткий поворот, реакция или точный вопрос. Например: «Владелец бизнеса отвечает клиенту через несколько часов и думает: “Ну я же ответил”. Ответил. Только клиент уже написал другому 😅». Или: «Сайт красивый. Цена в соцсетях, адрес на картах, запись в WhatsApp. Клиент хотел записаться, а получил квест 🫠».",
  "Личную историю, результат, число, клиента или случай из практики можно использовать только когда этот факт прямо указан в профиле бизнеса. Если подтверждения нет, не имитируй личный опыт и не выдумывай историю.",
  "Не придумывай даже приблизительные количества словами: сколько раз за день, сколько часов, экранов, кнопок или клиентов. Если число не дано в профиле, пиши «часто», «долго», «несколько» или «много».",
  "Не придумывай имена менеджеров, клиентов, владельцев, компаний и проектов. Для обычной ситуации пиши без имени: «менеджер», «клиент», «владелец бизнеса».",
  "Используй только факты из профиля бизнеса. Цены можно брать только из профиля и упоминать только с формулировкой «от». Не выдумывай другие цифры, кейсы, клиентов, сроки, личные истории и гарантии.",
  "Упоминай цены только тогда, когда контентный ракурс прямо связан с ценой, стоимостью или бюджетом. В остальных постах не называй цены.",
  "Каждую цену связывай с точной услугой в том же фрагменте текста: 79 900 ₸ только для лендинга, 99 900 ₸ только для ИИ-агента, 149 900 ₸ только для многостраничного сайта. Для мобильного приложения числовую цену не называй.",
  "Не обещай позиции или топ в Google и других поисковиках. Не гарантируй сроки, продажи, заявки, клиентов, рост, ROI или окупаемость. Не давай юридических и финансовых гарантий.",
  "Если упоминаешь рекламу, продвижение, платные API или другие дополнительные расходы, прямо скажи, что это отдельная статья расходов и она не входит в стоимость разработки.",
  "Не пиши общие фразы «мы можем помочь» и «действительно работает». Не используй слова «цифровизация», «пользовательский сценарий», «пользовательский путь», «конверсия», «лидогенерация», «интеграция», «релевантный», «ключевой», «эффективный», «качественный» и «современный», если пользу можно показать действием. Не пиши «под задачу бизнеса» и «согласованная задача».",
  "Пиши «компании сферы услуг» или называй конкретную нишу. Не используй выражение «сервисный бизнес». Не используй слово «действительно».",
  "Перед ответом проверь русскую грамматику и отсутствие случайных латинских букв внутри русских слов. В вопросе о степени пиши «насколько» слитно. Не используй двусмысленную фразу «после часа работы бота» и канцелярскую конструкцию «как будет обеспечена поддержка».",
  "Не пиши, что ты ИИ. Не используй кликбейт, канцелярит, самопересказ и идеально отполированный рекламный тон.",
  "Не используй выражения: «в современном мире», «ни для кого не секрет», «вы когда-нибудь задумывались», «давайте разберёмся», «важно понимать», «играет важную роль», «является свидетельством», «подчёркивает», «многогранный», «путешествие» как метафору, «по-настоящему», «безусловно», «более того», «кроме того», «таким образом», «стоит отметить», «подводя итог», «в заключение», «готовы начать».",
  "Перед ответом молча проверь: поймёт ли текст человек вне digital-сферы, есть ли конкретное действие, легко ли ответить на вопрос, нет ли повторения прошлых постов, пафоса и выдуманных фактов.",
  'Верни только JSON вида {"text":"...","quality":{"one_situation":true,"clear_connection":true,"question_follows":true,"topic_match":true}}. Все четыре проверки должны быть честными. Если хотя бы одна не проходит, перепиши текст до ответа. Не выходи за 240 символов с пробелами.',
].join(" ");

export interface GroqClassification {
  intent: Intent;
  signals: string[];
  riskFlags: string[];
  proposedReply: string | null;
}

const MAX_CLASSIFICATION_ATTEMPTS = 2;
const ALLOWED_REPLY_MODES = new Set(["continue", "clarify", "joke", "defer"]);

interface GroqResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export interface PostGenerationRequest {
  businessContext: string;
  targetAudience: string;
  toneOfVoice: string;
  contentAngle: string;
  scheduledAt: string;
  recentPosts: string[];
}

export function buildPostGenerationUserPrompt(
  request: PostGenerationRequest,
  rejectionReason = "",
): string {
  const recent = request.recentPosts.length > 0
    ? request.recentPosts
      .slice(0, POST_PROMPT_RECENT_LIMIT)
      .map((post, index) => `${index + 1}. ${post}`)
      .join("\n")
    : "нет";
  const prompt = [
    `Профиль бизнеса:\n${request.businessContext.slice(0, 12_000)}`,
    `Целевая аудитория:\n${request.targetAudience.slice(0, 4_000)}`,
    `Тон:\n${request.toneOfVoice.slice(0, 2_000)}`,
    `Контентный ракурс для этого поста:\n${request.contentAngle}`,
    `Недавние посты от самого нового к более старым. Не повторяй их темы, формулировки и тип хука; особенно не используй подряд тип хука из пункта 1:\n${
      recent.slice(0, 2_400)
    }`,
  ].join("\n\n");

  return rejectionReason
    ? `${prompt}\n\nПредыдущий вариант отклонён контролем качества: ${rejectionReason}. Напиши новый вариант и исправь эту ошибку.`
    : prompt;
}

export function generatedPostFromJson(
  content: string,
  request: PostGenerationRequest,
): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error("модель вернула некорректный JSON");
  }
  if (typeof parsed.text !== "string" || !parsed.text.trim()) {
    throw new Error("модель вернула пустой пост");
  }
  const quality = parsed.quality;
  if (
    typeof quality !== "object" ||
    quality === null ||
    (quality as Record<string, unknown>).one_situation !== true ||
    (quality as Record<string, unknown>).clear_connection !== true ||
    (quality as Record<string, unknown>).question_follows !== true ||
    (quality as Record<string, unknown>).topic_match !== true
  ) {
    throw new Error("смысловая проверка не подтвердила тему и одну связанную ситуацию");
  }

  const text = fitThreadsText(
    normalizeGeneratedPostCopy(parsed.text, request.contentAngle),
    MAX_GENERATED_POST_CHARACTERS,
  );
  if (Array.from(text).length < MIN_GENERATED_POST_CHARACTERS) {
    throw new Error(`пост короче ${MIN_GENERATED_POST_CHARACTERS} символов`);
  }
  if (isGeneratedPostTooSimilar(text, request.recentPosts)) {
    throw new Error("пост повторяет недавнюю публикацию по формулировке или смыслу");
  }
  const varietyIssue = generatedPostVarietyIssue(text, request.recentPosts);
  if (varietyIssue) throw new Error(`пост повторяет структуру: ${varietyIssue}`);
  assertGeneratedPostCopy(text, request.businessContext, request.contentAngle);
  return text;
}

export function fitThreadsText(text: string, maximum = 500): string {
  const normalized = text
    .trim()
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
  const characters = Array.from(normalized);
  if (characters.length <= maximum) return normalized;

  const candidate = characters.slice(0, maximum + 1).join("");
  const punctuation = Math.max(
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("! "),
    candidate.lastIndexOf("? "),
    candidate.lastIndexOf(".\n"),
    candidate.lastIndexOf("!\n"),
    candidate.lastIndexOf("?\n"),
  );
  const whitespace = candidate.lastIndexOf(" ");
  const cutAt = punctuation >= Math.floor(maximum * 0.6)
    ? punctuation + 1
    : whitespace >= Math.floor(maximum * 0.6)
    ? whitespace
    : maximum;
  return Array.from(candidate.slice(0, cutAt).trim()).slice(0, maximum).join("");
}

export class GroqClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async classify(
    text: string,
    businessContext = "",
    conversationContext = "",
  ): Promise<GroqClassification> {
    const systemRules = [
      "Ты классификатор входящих сообщений для веб- и digital-агентства.",
      "Верни только JSON с полями intent, signals, risk_flags, comment_point, post_connection, reply_mode, proposed_reply.",
      "intent: lead, engagement или spam.",
      "signals: explicit_need, vendor_search, pricing, timeline, contact_intent, service_interest, service_scope, conversation, praise, criticism, promotion, irrelevant.",
      "Дополнительный signal criticism используй для критики, явного несогласия, насмешки над автором или обесценивания поста.",
      "risk_flags: aggression, complaint, legal, reputation, personal_data, unknown_answer.",
      "Lead — только когда автор говорит о своей текущей или планируемой задаче: явно ищет подрядчика, хочет заказать услугу, спрашивает цену, срок, состав услуги, как проходит работа, возможность или способ связаться.",
      "Прямой вопрос о перечне услуг, например «Есть другие услуги?» или «Что ещё вы делаете?», тоже является lead.",
      "Шутка, реакция, пересказ чужой мысли, критика, спор, общее мнение и простое упоминание сайта или разработки — engagement, а не lead. Если коммерческое намерение неясно, выбирай engagement.",
      "Перед proposed_reply коротко зафиксируй смысл: comment_point — что именно утверждает или спрашивает человек; post_connection — как это продолжает конкретную мысль исходного поста и текущей ветки; reply_mode — continue, clarify, joke или defer. Это краткая проверка связи, не рассуждение. Нельзя придумывать связь, которой нет в контексте.",
      "Для любого нормального engagement по теме поста заполни proposed_reply одной короткой человеческой репликой до 180 символов. Ответ должен сделать хотя бы одно: добавить конкретное следствие, подхватить шутку или задать точный вопрос по мысли автора. Можно один уместный эмодзи. Не продавай, не упоминай услуги, цену, WhatsApp или связь.",
      "На спокойную критику или несогласие тоже отвечай по-человечески, без спора и оправданий. Для агрессии, жалобы, юридического вопроса, персональных данных, спама и явного троллинга proposed_reply должен быть null.",
      "Не пиши как служба поддержки и не отвечай пустым согласием. Запрещены «Спасибо за обратную связь», «Это хороший вопрос», «Интересная мысль», «Да, удобство важно», «Согласен, честность лучше», «Зависит от того» и другие фразы, которые можно оставить под любым постом.",
      "Плохой ответ на «Чем дольше путь, тем меньше людей дойдут»: «Да, удобство и ясность важны». Хороший: «И каждый лишний шаг даёт ещё один повод закрыть страницу». Плохой ответ на шутку: «Это хороший вопрос». Хороший ответ подхватывает конкретный поворот шутки.",
      "Для lead proposed_reply должен отвечать по существу или задать один уточняющий вопрос. Для spam всегда верни null.",
      "Используй историю ветки, чтобы ответ продолжал именно этот разговор и не повторял уже сказанное автором аккаунта.",
      'Ответь именно на последний комментарий, а не заново на исходный пост. Не задавай вопрос, который человек уже закрыл своим комментарием. Если комментарий добавляет пример или вывод, продолжи этот пример одним конкретным наблюдением. Если это шутка, подхвати её смысл. Если связь с постом непонятна, reply_mode=defer, proposed_reply=null и risk_flags=["unknown_answer"].',
      'Если вопрос требует факта, цены, срока, кейса, обещания или решения, которого нет в контексте бизнеса и ветки, ничего не угадывай: proposed_reply=null и risk_flags=["unknown_answer"].',
      "Не используй канцелярит, самопересказ, искусственный контраст «не просто X, а Y» и отполированный рекламный тон.",
      businessContext
        ? "Если это лид, составь proposed_reply только на основе контекста бизнеса ниже. Ответь по существу или задай один уточняющий вопрос. Цены можно брать только из контекста и упоминать только с формулировкой «от». Не придумывай другие цифры, сроки, кейсы и гарантии."
        : "",
      businessContext ? `Контекст бизнеса:\n${businessContext.slice(0, 12_000)}` : "",
      conversationContext
        ? `Ограниченный контекст текущей ветки:\n${conversationContext.slice(0, 2_400)}`
        : "",
    ];
    let rejectionReason = "";

    for (let attempt = 0; attempt < MAX_CLASSIFICATION_ATTEMPTS; attempt += 1) {
      const system = [
        ...systemRules,
        rejectionReason
          ? `Предыдущая proposed_reply отклонена: ${rejectionReason}. Сохрани правильную классификацию, но напиши новую, более конкретную реплику.`
          : "",
      ].filter(Boolean).join(" ");
      const payload = await fetchJson<GroqResponse>(
        "Groq API",
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            temperature: 0.2,
            max_completion_tokens: 350,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: system },
              { role: "user", content: text.slice(0, 2000) },
            ],
          }),
        },
      );

      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error("Groq API returned no classification");

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(content) as Record<string, unknown>;
      } catch {
        throw new Error("Groq API returned invalid classification JSON");
      }

      const intent = parsed.intent;
      if (intent !== "lead" && intent !== "engagement" && intent !== "spam") {
        throw new Error("Groq API returned an unsupported intent");
      }

      const signals = Array.isArray(parsed.signals)
        ? parsed.signals.filter((value): value is string =>
          typeof value === "string" && ALLOWED_SIGNALS.has(value)
        )
        : [];
      const riskFlags = Array.isArray(parsed.risk_flags)
        ? parsed.risk_flags.filter((value): value is string =>
          typeof value === "string" && ALLOWED_RISKS.has(value)
        )
        : [];
      let proposedReply = typeof parsed.proposed_reply === "string"
        ? parsed.proposed_reply.trim().slice(0, 450) || null
        : null;
      const commentPoint = typeof parsed.comment_point === "string"
        ? parsed.comment_point.trim()
        : "";
      const postConnection = typeof parsed.post_connection === "string"
        ? parsed.post_connection.trim()
        : "";
      const replyMode = typeof parsed.reply_mode === "string" ? parsed.reply_mode.trim() : "";
      if (intent === "spam" || riskFlags.length > 0) proposedReply = null;
      if (proposedReply) {
        try {
          if (
            intent === "engagement" &&
            (
              commentPoint.length < 8 || postConnection.length < 8 ||
              !ALLOWED_REPLY_MODES.has(replyMode) || replyMode === "defer"
            )
          ) {
            throw new Error("Generated engagement reply is not grounded in the comment and post");
          }
          if (intent === "lead" && businessContext) {
            assertGeneratedReplyCopy(proposedReply, businessContext);
          } else if (intent === "engagement") {
            assertGeneratedEngagementReplyCopy(proposedReply, businessContext);
          } else if (intent !== "lead") {
            proposedReply = null;
          }
        } catch (error) {
          rejectionReason = error instanceof Error
            ? error.message
            : "Unknown copy validation error";
          console.warn(
            JSON.stringify({ event: "generated_reply_rejected", reason: rejectionReason }),
          );
          if (
            intent === "engagement" && riskFlags.length === 0 &&
            attempt + 1 < MAX_CLASSIFICATION_ATTEMPTS
          ) continue;
          proposedReply = null;
        }
      }

      if (intent === "engagement" && !proposedReply && riskFlags.length === 0) {
        riskFlags.push("unknown_answer");
      }

      return { intent, signals, riskFlags, proposedReply };
    }

    throw new Error("Groq API could not produce a safe classification reply");
  }
}
