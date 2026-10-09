// Shared by the server, browser and regression tests.
export function alternateSiMeaning(text) {
  return /system\s+integration|syst[eè]me\s+international|\bSI\s+units?\b|시스템\s*통합|국제\s*단위/i.test(text);
}

export function needsNewsSearch(text = "") {
  if (alternateSiMeaning(text)) return false;
  return /\bs\.?\s*i\.?\b|\ba\.?\s*i\.?\b|super[\s-]*intelligence|artificial intelligence|슈퍼\s*인텔리전스|초지능|인공지능|에스\s*아이|\b(tariffs?|polic(?:y|ies)|white house|regulation|speech|remarks)\b|관세|정책|백악관/i.test(text)
    || (/trump|트럼프/i.test(text) && /\b(why|what|when|how|said|say|did|does)\b|왜|무엇|언제|발언/i.test(text));
}

export function normalizeKnowledgeQuery(query) {
  if (!alternateSiMeaning(query) && /\bs\.?\s*i\.?\b|에스\s*아이/i.test(query)
      && !/super[\s-]*intelligence/i.test(query)) {
    return `Donald Trump Super Intelligence (SI): ${query}`;
  }
  return query;
}

export function responseOptions(text, phase = "answer") {
  // Do not override session.instructions here: a response-level override used
  // to erase the persona/language rules after every retrieval.
  if (phase === "grounded" || phase === "greeting") return { tool_choice: "none" };
  return needsNewsSearch(text) ? { tool_choice: { type: "function", name: "search_trump_news" } } : {};
}
