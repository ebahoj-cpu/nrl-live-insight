// AI-generated betting insights via Lovable AI Gateway.
// Uses tool-calling for structured output. Receives ONLY real data summaries.

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

export type BettingAngle = {
  market: string;
  pick: string;
  reasoning: string;
  confidence: number;
};


export type BetSuggestion = {
  risk: "low" | "medium" | "high";
  title: string;          // e.g. "Roosters -12.5 + Tedesco anytime tryscorer"
  legs: string[];         // each leg of the multi
  estimatedOdds: string;  // e.g. "$4.20"
  stake: string;          // e.g. "$20"
  potentialReturn: string;// e.g. "$84"
  reasoning: string;      // why this combo
};

export type Insights = {
  predictedScore: { home: number; away: number };
  winner: { team: "home" | "away"; confidence: number; reasoning: string };
  margin: { value: number; bucket: string; reasoning: string };
  total: { line: number; pick: "over" | "under"; reasoning: string };
  htft: { pick: string; reasoning: string; confidence: number };
  firstTryscorer: { pick: string; reasoning: string };
  anytimeTryscorers: { pick: string; reasoning: string }[];
  multiTryscorer: { pick: string; reasoning: string; confidence: number };
  keysToVictory: { home: string[]; away: string[] };
  keyFactors: string[];
  betSuggestions: BetSuggestion[];
  script: {
    headToHead: string;
    formAnalysis: string;
    milestones: string[];
    xFactor: string;
    bookieScript: {
      wantToWin: string;
      wantToLose: string;
      liability: string;
    };
  };
};

export async function generateInsights(payload: {
  homeName: string;
  awayName: string;
  venue: string;
  homeRecentForm: { result: string; summary: string; score: string }[];
  awayRecentForm: { result: string; summary: string; score: string }[];
  homePosition?: string;
  awayPosition?: string;
  homeSquad: { firstName: string; lastName: string; position: string; isCaptain?: boolean }[];
  awaySquad: { firstName: string; lastName: string; position: string; isCaptain?: boolean }[];
  ladder: { nickname: string; played: number; wins: number; losses: number; for: number; against: number; diff: number; points: number }[];
  oddsSummary: string;
  weatherSummary?: string;
}): Promise<Insights> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY not configured");

  const homeRow = payload.ladder.find((l) => l.nickname === payload.homeName);
  const awayRow = payload.ladder.find((l) => l.nickname === payload.awayName);

  const fmtSquad = (s: typeof payload.homeSquad) =>
    s.map((p) => `${p.position}: ${p.firstName} ${p.lastName}${p.isCaptain ? " (C)" : ""}`).join("; ") || "n/a";

  const prompt = [
    `Match: ${payload.homeName} (home) vs ${payload.awayName} (away) at ${payload.venue}.`,
    homeRow ? `${payload.homeName}: ${homeRow.wins}W-${homeRow.losses}L, PF ${homeRow.for}, PA ${homeRow.against}, diff ${homeRow.diff}, pos ${payload.homePosition ?? "?"}.` : "",
    awayRow ? `${payload.awayName}: ${awayRow.wins}W-${awayRow.losses}L, PF ${awayRow.for}, PA ${awayRow.against}, diff ${awayRow.diff}, pos ${payload.awayPosition ?? "?"}.` : "",
    `${payload.homeName} named squad (NRL.com official): ${fmtSquad(payload.homeSquad)}`,
    `${payload.awayName} named squad (NRL.com official): ${fmtSquad(payload.awaySquad)}`,
    `Home recent form: ${payload.homeRecentForm.map((f) => `${f.result} ${f.summary} ${f.score}`).join("; ") || "n/a"}`,
    `Away recent form: ${payload.awayRecentForm.map((f) => `${f.result} ${f.summary} ${f.score}`).join("; ") || "n/a"}`,
    `Live AU bookie odds summary: ${payload.oddsSummary}`,
    payload.weatherSummary ? `Forecast at venue at kickoff: ${payload.weatherSummary}` : "",
    `Provide a sharp, complete NRL betting analysis covering: winner, margin, HT/FT double, total points, first/anytime tryscorers, and multi-tryscorer angles. Also produce 3 specific "keys to victory" for EACH team (concrete tactical/structural points referencing real squad players, recent form, opposition weakness, or weather/ground impact). Plus a "script" — head-to-head context, form analysis, notable upcoming milestones, and a "bookie script": from a sharp Australian bookmaker's perspective, which result/outcome do they WANT to land (limits liability, public is on the other side), which result they want to AVOID (heavy public liability), and a one-sentence summary of where their book is most exposed. FINALLY, generate exactly 3 betSuggestions targeting low/medium/high risk. Each suggestion is a small multi (2-4 legs) combining real squad players, head-to-head winner, margin, totals or tryscorer markets that — based on the live odds shown — could plausibly return strong value on a $20 stake. Estimate the combined decimal odds and the potential return. Make them sharp, specific (e.g. "Roosters win + Tedesco anytime + 13+ Tupou tries"), and explain in 1-2 sentences why each combo wins. NEVER invent players — only use named squad members above.`,
  ].filter(Boolean).join("\n");

  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: "You are a professional NRL analyst and betting tipster. Use only the data provided. Never invent stats or players. Each pick must include a one-sentence reasoning the user can act on." },
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
                properties: {
                  team: { type: "string", enum: ["home", "away"] },
                  confidence: { type: "number", minimum: 0, maximum: 100 },
                  reasoning: { type: "string" },
                },
                required: ["team", "confidence", "reasoning"], additionalProperties: false,
              },
              margin: {
                type: "object",
                properties: {
                  value: { type: "number" },
                  bucket: { type: "string", description: "e.g. 1-12, 13+, 1-6" },
                  reasoning: { type: "string" },
                },
                required: ["value", "bucket", "reasoning"], additionalProperties: false,
              },
              total: {
                type: "object",
                properties: {
                  line: { type: "number" },
                  pick: { type: "string", enum: ["over", "under"] },
                  reasoning: { type: "string" },
                },
                required: ["line", "pick", "reasoning"], additionalProperties: false,
              },
              htft: {
                type: "object",
                properties: {
                  pick: { type: "string", description: "e.g. 'Storm / Storm' or 'Draw / Storm'" },
                  reasoning: { type: "string" },
                  confidence: { type: "number", minimum: 0, maximum: 100 },
                },
                required: ["pick", "reasoning", "confidence"], additionalProperties: false,
              },
              firstTryscorer: {
                type: "object",
                properties: {
                  pick: { type: "string", description: "Player full name from named squads" },
                  reasoning: { type: "string" },
                },
                required: ["pick", "reasoning"], additionalProperties: false,
              },
              anytimeTryscorers: {
                type: "array",
                minItems: 3, maxItems: 5,
                items: {
                  type: "object",
                  properties: {
                    pick: { type: "string" },
                    reasoning: { type: "string" },
                  },
                  required: ["pick", "reasoning"], additionalProperties: false,
                },
              },
              multiTryscorer: {
                type: "object",
                properties: {
                  pick: { type: "string", description: "Player + 'double' or 'hat-trick'" },
                  reasoning: { type: "string" },
                  confidence: { type: "number", minimum: 0, maximum: 100 },
                },
                required: ["pick", "reasoning", "confidence"], additionalProperties: false,
              },
              keysToVictory: {
                type: "object",
                properties: {
                  home: { type: "array", minItems: 3, maxItems: 3, items: { type: "string", description: "Specific tactical key for home team to win" } },
                  away: { type: "array", minItems: 3, maxItems: 3, items: { type: "string", description: "Specific tactical key for away team to win" } },
                },
                required: ["home", "away"], additionalProperties: false,
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
              script: {
                type: "object",
                properties: {
                  headToHead: { type: "string", description: "Recent head-to-head context, trends, venue history" },
                  formAnalysis: { type: "string", description: "Comparative form, attack vs defence, trajectories" },
                  milestones: {
                    type: "array",
                    minItems: 1, maxItems: 4,
                    items: { type: "string", description: "Notable milestone for player/coach/club" },
                  },
                  xFactor: { type: "string", description: "Single biggest swing factor" },
                  bookieScript: {
                    type: "object",
                    properties: {
                      wantToWin: { type: "string", description: "The result/outcome bookmakers want — public is on the other side, low liability" },
                      wantToLose: { type: "string", description: "The result/outcome bookmakers fear — heavy public money, big payout exposure" },
                      liability: { type: "string", description: "One-sentence summary of where the book is most exposed" },
                    },
                    required: ["wantToWin", "wantToLose", "liability"], additionalProperties: false,
                  },
                },
                required: ["headToHead", "formAnalysis", "milestones", "xFactor", "bookieScript"], additionalProperties: false,
              },
            },
            required: [
              "predictedScore","winner","margin","total","htft",
              "firstTryscorer","anytimeTryscorers","multiTryscorer",
              "keysToVictory","keyFactors","bettingAngles","script",
            ],
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
