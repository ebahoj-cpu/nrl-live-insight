// AI-generated betting intelligence via Lovable AI Gateway.
// Produces structured game script, edge insights, betting comparison, plus
// the existing market picks and tryscorer leans. Uses tool-calling for safe
// JSON output. Receives ONLY real data summaries.

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

export type BettingAngle = {
  market: string;
  pick: string;
  reasoning: string;
  confidence: number;
};

export type EdgeNugget = {
  label: string;          // short tag e.g. "Late change", "Milestone", "Travel"
  detail: string;         // 1-sentence insight
  impact: "high" | "medium" | "low";
};

export type EdgeAnalysis = {
  attackingTeam: "home" | "away";
  attackingShape: string;       // e.g. "shifts wide off scrums, second-row involvement"
  vulnerableTeam: "home" | "away";
  vulnerability: string;        // e.g. "right-edge centre rushes out of line"
  keyAttackers: string[];       // 2-4 names
  keyDefenders: string[];       // 2-3 names being targeted
  tryscorerLeans: string[];     // 1-3 names tied to this edge
  gameScript: string;           // 2-3 sentences of how it unfolds
};

export type TieredBet = {
  tier: "low" | "medium" | "high";
  legs: { market: string; pick: string }[];   // anytime tryscorer + match result + total
  rationale: string;
  estimatedOdds?: string;
};

export type BettingCompare = {
  market: string;          // e.g. "Head to head"
  marketSays: string;      // what bookies are pricing
  modelSays: string;       // what the data suggests
  lean: "with_market" | "value" | "fade" | "neutral";
  reasoning: string;
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
  firstSecondThird: { picks: string[]; reasoning: string };
  doubleTryscorer: { pick: string; reasoning: string };
  keysToVictory: { home: string[]; away: string[] };
  keyFactors: string[];
  bettingAngles: BettingAngle[];
  bettingIntelligence: BettingCompare[];
  edgeNuggets: EdgeNugget[];
  leftEdge: EdgeAnalysis;
  rightEdge: EdgeAnalysis;
  tieredBets: TieredBet[];
  weatherImpact: { summary: string; favours: "home" | "away" | "neither"; tacticalNote: string };
  script: {
    formNarrative: string;
    ladderContext: string;
    psychologicalFactors: string[];
    matchStyleProjection: string;
    statDrivenScript: string[];
    headToHead: string;
    milestones: string[];
    xFactor: string;
    bookieScript: {
      wantToWin: string;
      wantToLose: string;
      liability: string;
    };
  };
};

type StatSnap = {
  field: string; homeAvg: number; awayAvg: number;
  edge: "home" | "away" | "even"; framing: string;
};

type PlayerSnap = {
  name: string; position: string; trend: "peak" | "cold" | "steady";
  avgRunMetres: number; avgTackles: number; avgTries: number;
  avgTryAssists: number; roleNote: string;
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
  statEdges?: StatSnap[];
  homeTopPlayers?: PlayerSnap[];
  awayTopPlayers?: PlayerSnap[];
}): Promise<Insights> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY not configured");

  const homeRow = payload.ladder.find((l) => l.nickname === payload.homeName);
  const awayRow = payload.ladder.find((l) => l.nickname === payload.awayName);

  const fmtSquad = (s: typeof payload.homeSquad) =>
    s.map((p) => `${p.position}: ${p.firstName} ${p.lastName}${p.isCaptain ? " (C)" : ""}`).join("; ") || "n/a";

  const fmtStats = (edges?: StatSnap[]) => !edges?.length
    ? "no comparable per-game stats yet"
    : edges.map((e) => `${e.field}: ${payload.homeName} ${e.homeAvg} vs ${payload.awayName} ${e.awayAvg} (${e.edge === "even" ? "even" : `${e.edge === "home" ? payload.homeName : payload.awayName} edge — ${e.framing}`})`).join("; ");

  const fmtPlayers = (ps?: PlayerSnap[]) => !ps?.length
    ? "no player data"
    : ps.map((p) => `${p.name} (${p.position}, ${p.trend} form): ${p.avgRunMetres}m, ${p.avgTackles} tkl, ${p.avgTries}T, ${p.avgTryAssists}TA — ${p.roleNote}`).join("; ");

  const prompt = [
    `Match: ${payload.homeName} (home) vs ${payload.awayName} (away) at ${payload.venue}.`,
    homeRow ? `${payload.homeName}: ${homeRow.wins}W-${homeRow.losses}L, PF ${homeRow.for}, PA ${homeRow.against}, diff ${homeRow.diff}, ladder #${payload.homePosition ?? "?"}.` : "",
    awayRow ? `${payload.awayName}: ${awayRow.wins}W-${awayRow.losses}L, PF ${awayRow.for}, PA ${awayRow.against}, diff ${awayRow.diff}, ladder #${payload.awayPosition ?? "?"}.` : "",
    `${payload.homeName} squad: ${fmtSquad(payload.homeSquad)}`,
    `${payload.awayName} squad: ${fmtSquad(payload.awaySquad)}`,
    `${payload.homeName} recent form: ${payload.homeRecentForm.map((f) => `${f.result} ${f.summary} ${f.score}`).join("; ") || "n/a"}`,
    `${payload.awayName} recent form: ${payload.awayRecentForm.map((f) => `${f.result} ${f.summary} ${f.score}`).join("; ") || "n/a"}`,
    `Per-game stat comparison (last 5): ${fmtStats(payload.statEdges)}`,
    `${payload.homeName} key players (last 5): ${fmtPlayers(payload.homeTopPlayers)}`,
    `${payload.awayName} key players (last 5): ${fmtPlayers(payload.awayTopPlayers)}`,
    `Live AU bookie odds: ${payload.oddsSummary}`,
    payload.weatherSummary ? `Forecast at venue at kickoff: ${payload.weatherSummary}` : "",
    "",
    "Produce sharp, professional NRL match intelligence:",
    "1. Winner / margin / total / HT-FT / first / anytime / multi tryscorer picks (use ONLY named-squad players).",
    "2. 3 specific keys to victory per team — concrete tactical/structural points referencing real players, recent form, opposition weakness, or weather.",
    "3. bettingIntelligence: 2-4 markets where data signal differs from market price. For each, state what the market is pricing, what the model thinks, and lean (value/fade/with_market/neutral). Avoid generic statements.",
    "4. edgeNuggets: 3-5 high-impact bullets (late changes implied by squad, milestone games, momentum signals, revenge/narrative, travel, weather-driven tactics). Each has a short label, detail, and impact rating.",
    "5. weatherImpact: how forecast affects style and which side benefits.",
    "6. script: full game script — formNarrative (momentum vs decline), ladderContext (pressure / top 8 race), psychologicalFactors (3 bullets), matchStyleProjection (tempo / grind vs fast), statDrivenScript (3-5 if/then chains, e.g. 'If A wins early run-metres → territory → late scoring'), plus headToHead, milestones, xFactor and bookieScript (wantToWin / wantToLose / liability).",
    "Avoid generic claims. Every insight must answer WHY it matters and HOW it impacts the result.",
  ].filter(Boolean).join("\n");

  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: "You are a professional NRL analyst and betting tipster combining stats, form trends, weather, and market signals. Use ONLY data provided. Never invent stats or players. Be specific, concrete, and actionable." },
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
              predictedScore: { type: "object", properties: { home: { type: "number" }, away: { type: "number" } }, required: ["home","away"], additionalProperties: false },
              winner: { type: "object", properties: { team: { type: "string", enum: ["home","away"] }, confidence: { type: "number" }, reasoning: { type: "string" } }, required: ["team","confidence","reasoning"], additionalProperties: false },
              margin: { type: "object", properties: { value: { type: "number" }, bucket: { type: "string" }, reasoning: { type: "string" } }, required: ["value","bucket","reasoning"], additionalProperties: false },
              total: { type: "object", properties: { line: { type: "number" }, pick: { type: "string", enum: ["over","under"] }, reasoning: { type: "string" } }, required: ["line","pick","reasoning"], additionalProperties: false },
              htft: { type: "object", properties: { pick: { type: "string" }, reasoning: { type: "string" }, confidence: { type: "number" } }, required: ["pick","reasoning","confidence"], additionalProperties: false },
              firstTryscorer: { type: "object", properties: { pick: { type: "string" }, reasoning: { type: "string" } }, required: ["pick","reasoning"], additionalProperties: false },
              anytimeTryscorers: { type: "array", minItems: 3, maxItems: 5, items: { type: "object", properties: { pick: { type: "string" }, reasoning: { type: "string" } }, required: ["pick","reasoning"], additionalProperties: false } },
              multiTryscorer: { type: "object", properties: { pick: { type: "string" }, reasoning: { type: "string" }, confidence: { type: "number" } }, required: ["pick","reasoning","confidence"], additionalProperties: false },
              keysToVictory: { type: "object", properties: { home: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } }, away: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } } }, required: ["home","away"], additionalProperties: false },
              keyFactors: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 6 },
              bettingAngles: { type: "array", minItems: 2, maxItems: 4, items: { type: "object", properties: { market: { type: "string" }, pick: { type: "string" }, reasoning: { type: "string" }, confidence: { type: "number" } }, required: ["market","pick","reasoning","confidence"], additionalProperties: false } },
              bettingIntelligence: {
                type: "array", minItems: 2, maxItems: 4,
                items: {
                  type: "object",
                  properties: {
                    market: { type: "string", description: "e.g. Head to head, Spread -6.5, Total 41.5" },
                    marketSays: { type: "string", description: "What bookmakers are pricing" },
                    modelSays: { type: "string", description: "What the data + form suggests" },
                    lean: { type: "string", enum: ["with_market","value","fade","neutral"] },
                    reasoning: { type: "string" },
                  },
                  required: ["market","marketSays","modelSays","lean","reasoning"],
                  additionalProperties: false,
                },
              },
              edgeNuggets: {
                type: "array", minItems: 3, maxItems: 5,
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string", description: "Short tag like 'Late change', 'Milestone', 'Travel', 'Form swing', 'Weather'" },
                    detail: { type: "string", description: "Single high-impact sentence" },
                    impact: { type: "string", enum: ["high","medium","low"] },
                  },
                  required: ["label","detail","impact"],
                  additionalProperties: false,
                },
              },
              weatherImpact: {
                type: "object",
                properties: {
                  summary: { type: "string" },
                  favours: { type: "string", enum: ["home","away","neither"] },
                  tacticalNote: { type: "string" },
                },
                required: ["summary","favours","tacticalNote"],
                additionalProperties: false,
              },
              script: {
                type: "object",
                properties: {
                  formNarrative: { type: "string", description: "Momentum vs decline; recent results context" },
                  ladderContext: { type: "string", description: "Pressure, must-win, top 8 race, finals positioning" },
                  psychologicalFactors: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
                  matchStyleProjection: { type: "string", description: "Tempo, attacking vs grind, where points come from" },
                  statDrivenScript: { type: "array", minItems: 3, maxItems: 5, items: { type: "string", description: "If/then chain referencing real stats" } },
                  headToHead: { type: "string" },
                  milestones: { type: "array", minItems: 1, maxItems: 4, items: { type: "string" } },
                  xFactor: { type: "string" },
                  bookieScript: {
                    type: "object",
                    properties: {
                      wantToWin: { type: "string" },
                      wantToLose: { type: "string" },
                      liability: { type: "string" },
                    },
                    required: ["wantToWin","wantToLose","liability"], additionalProperties: false,
                  },
                },
                required: ["formNarrative","ladderContext","psychologicalFactors","matchStyleProjection","statDrivenScript","headToHead","milestones","xFactor","bookieScript"], additionalProperties: false,
              },
            },
            required: [
              "predictedScore","winner","margin","total","htft",
              "firstTryscorer","anytimeTryscorers","multiTryscorer",
              "keysToVictory","keyFactors","bettingAngles",
              "bettingIntelligence","edgeNuggets","weatherImpact","script",
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
