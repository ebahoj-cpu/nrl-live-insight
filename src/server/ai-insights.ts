// AI-generated betting insights via Lovable AI Gateway.
// Uses tool-calling for structured output. Receives ONLY real data summaries.

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

export type Insights = {
  predictedScore: { home: number; away: number };
  winner: { team: "home" | "away"; confidence: number };
  margin: { value: number; reasoning: string };
  total: { line: number; pick: "over" | "under"; reasoning: string };
  keyFactors: string[];
  bettingAngles: { market: string; pick: string; reasoning: string; confidence: number }[];
};

export async function generateInsights(payload: {
  homeName: string;
  awayName: string;
  venue: string;
  homeRecentForm: { result: string; summary: string; score: string }[];
  awayRecentForm: { result: string; summary: string; score: string }[];
  homePosition?: string;
  awayPosition?: string;
  ladder: { nickname: string; played: number; wins: number; losses: number; for: number; against: number; diff: number; points: number }[];
  oddsSummary: string;
}): Promise<Insights> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY not configured");

  const homeRow = payload.ladder.find((l) => l.nickname === payload.homeName);
  const awayRow = payload.ladder.find((l) => l.nickname === payload.awayName);

  const prompt = [
    `Match: ${payload.homeName} (home) vs ${payload.awayName} (away) at ${payload.venue}.`,
    homeRow ? `${payload.homeName}: ${homeRow.wins}W-${homeRow.losses}L, PF ${homeRow.for}, PA ${homeRow.against}, diff ${homeRow.diff}, pos ${payload.homePosition ?? "?"}.` : "",
    awayRow ? `${payload.awayName}: ${awayRow.wins}W-${awayRow.losses}L, PF ${awayRow.for}, PA ${awayRow.against}, diff ${awayRow.diff}, pos ${payload.awayPosition ?? "?"}.` : "",
    `Home recent form: ${payload.homeRecentForm.map((f) => `${f.result} ${f.summary} ${f.score}`).join("; ") || "n/a"}`,
    `Away recent form: ${payload.awayRecentForm.map((f) => `${f.result} ${f.summary} ${f.score}`).join("; ") || "n/a"}`,
    `Live AU bookie odds summary: ${payload.oddsSummary}`,
    `Provide a sharp NRL betting analysis. Be specific. Reference the data.`,
  ].filter(Boolean).join("\n");

  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: "You are a professional NRL analyst. Use only the data provided. Never invent stats." },
        { role: "user", content: prompt },
      ],
      tools: [{
        type: "function",
        function: {
          name: "emit_insights",
          description: "Return structured NRL match insights",
          parameters: {
            type: "object",
            properties: {
              predictedScore: {
                type: "object",
                properties: { home: { type: "number" }, away: { type: "number" } },
                required: ["home", "away"], additionalProperties: false,
              },
              winner: {
                type: "object",
                properties: { team: { type: "string", enum: ["home", "away"] }, confidence: { type: "number", minimum: 0, maximum: 100 } },
                required: ["team", "confidence"], additionalProperties: false,
              },
              margin: {
                type: "object",
                properties: { value: { type: "number" }, reasoning: { type: "string" } },
                required: ["value", "reasoning"], additionalProperties: false,
              },
              total: {
                type: "object",
                properties: { line: { type: "number" }, pick: { type: "string", enum: ["over", "under"] }, reasoning: { type: "string" } },
                required: ["line", "pick", "reasoning"], additionalProperties: false,
              },
              keyFactors: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 6 },
              bettingAngles: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    market: { type: "string" },
                    pick: { type: "string" },
                    reasoning: { type: "string" },
                    confidence: { type: "number", minimum: 0, maximum: 100 },
                  },
                  required: ["market", "pick", "reasoning", "confidence"], additionalProperties: false,
                },
                minItems: 2, maxItems: 4,
              },
            },
            required: ["predictedScore", "winner", "margin", "total", "keyFactors", "bettingAngles"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "emit_insights" } },
    }),
  });

  if (res.status === 429) throw new Error("AI rate limit exceeded; try again shortly");
  if (res.status === 402) throw new Error("AI credits exhausted; add credits in Settings → Workspace → Usage");
  if (!res.ok) throw new Error(`AI gateway HTTP ${res.status}: ${await res.text()}`);

  const data = await res.json() as any;
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call?.function?.arguments) throw new Error("AI returned no structured output");
  return JSON.parse(call.function.arguments) as Insights;
}
