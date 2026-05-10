import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { cached } from "./cache";

const Input = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  source: z.string().optional(),
});

export type ArticleSummary = {
  summary: string;
  keyPoints: string[];
  bettingImpact: {
    direction: "positive" | "negative" | "neutral";
    note: string;
    timeframe: "short" | "mid" | "long";
    timeframeNote?: string;
  };
};

const UA = "Mozilla/5.0 (compatible; LineBreak/1.0)";

function stripHtml(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchArticleText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
  });
  if (!res.ok) throw new Error(`Failed to fetch article (${res.status})`);
  const html = await res.text();
  // Try to grab <article> first, fall back to <main>, then full body
  const article = html.match(/<article[\s\S]*?<\/article>/i)?.[0];
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0];
  const body = html.match(/<body[\s\S]*?<\/body>/i)?.[0];
  const raw = article ?? main ?? body ?? html;
  const text = stripHtml(raw);
  return text.slice(0, 12_000); // cap input
}

async function callAI(prompt: string, system: string): Promise<ArticleSummary> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY not configured");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "return_summary",
            description: "Return the structured article summary.",
            parameters: {
              type: "object",
              properties: {
                summary: {
                  type: "string",
                  description: "2-3 sentence summary of the article's key story.",
                },
                keyPoints: {
                  type: "array",
                  items: { type: "string" },
                  description: "3-5 concise bullet points capturing the main facts/insights.",
                },
                bettingImpact: {
                  type: "object",
                  properties: {
                    direction: {
                      type: "string",
                      enum: ["positive", "negative", "neutral"],
                      description: "Overall directional impact on the existing NRL bet suggestions on the Insights tab.",
                    },
                    note: {
                      type: "string",
                      description:
                        "1-3 sentences explaining how this news could positively or negatively impact suggested bets (tryscorers, head-to-head, totals). If no clear impact, say so plainly.",
                    },
                    timeframe: {
                      type: "string",
                      enum: ["short", "mid", "long"],
                      description: "How long the impact lasts. 'short' = this round only (e.g. one-game suspension, weekend weather, late team-list change). 'mid' = next 2-3 rounds (e.g. minor injury, short-term form swing, hooker reshuffle). 'long' = rest of season (e.g. season-ending injury, long-term suspension, coaching change, structural lineup shift).",
                    },
                    timeframeNote: {
                      type: "string",
                      description: "1 sentence explaining WHY you chose that timeframe (e.g. 'Hamstring injury — out 4-6 weeks per club statement').",
                    },
                  },
                  required: ["direction", "note", "timeframe"],
                  additionalProperties: false,
                },
              },
              required: ["summary", "keyPoints", "bettingImpact"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "return_summary" } },
    }),
  });

  if (res.status === 429) throw new Error("AI rate limit hit, please try again shortly.");
  if (res.status === 402) throw new Error("AI credits exhausted — top up in Settings → Workspace → Usage.");
  if (!res.ok) throw new Error(`AI gateway error (${res.status})`);

  const data = await res.json() as any;
  const tc = data?.choices?.[0]?.message?.tool_calls?.[0];
  const argsJson = tc?.function?.arguments;
  if (!argsJson) throw new Error("No structured response from AI");
  const parsed = JSON.parse(argsJson);
  return parsed as ArticleSummary;
}

export const summariseArticle = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data }): Promise<ArticleSummary> => {
    const cacheKey = `news-summary:${data.url}`;
    return cached(cacheKey, 24 * 60 * 60_000, async () => {
      const text = await fetchArticleText(data.url);
      const system =
        "You are an NRL betting analyst. You read rugby league news articles and report how they affect bet suggestions (head-to-head, tryscorers, totals, player markets) for upcoming games. Be specific about players, teams, injuries, and lineup changes when present. Never invent facts not in the article.";
      const prompt = [
        `Source: ${data.source ?? "unknown"}`,
        `Title: ${data.title ?? "(unknown)"}`,
        `URL: ${data.url}`,
        "",
        "Article body (truncated):",
        text,
        "",
        "Summarize the article and assess the betting impact on suggested bets shown on the app's Insights tab.",
      ].join("\n");
      return callAI(prompt, system);
    });
  });
