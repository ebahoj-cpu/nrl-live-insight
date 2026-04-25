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
  title: string;          // e.g. "Roosters win + Tedesco anytime + Tupou 1-2 tries"
  legs: string[];         // each leg of the multi
  estimatedOdds: string;  // e.g. "$5.00"
  stake: string;          // e.g. "$20"
  potentialReturn: string;// e.g. "$100"
  targetPayout: "100" | "1000" | "10000"; // tier this bet is sized to deliver
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
  weaknessExploit: {
    home: {
      opponentWeakness: string;          // e.g. "Roosters concede right-edge tries — missed tackle % at left centre"
      targetArea: string;                // e.g. "Right edge attack, 20m channel"
      tacticalPlan: string;              // 2-3 sentences how home team exploits it
      playersToWatch: { name: string; role: string; why: string }[]; // 3 players
    };
    away: {
      opponentWeakness: string;
      targetArea: string;
      tacticalPlan: string;
      playersToWatch: { name: string; role: string; why: string }[];
    };
  };
  betSuggestions: BetSuggestion[];
  script: {
    headToHead: string;
    formAnalysis: string;
    xFactor: string;
    psychological: string;
    milestones: string[];
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
    `Provide a sharp, complete NRL betting analysis covering: winner, margin, HT/FT double, total points, first/anytime tryscorers, and multi-tryscorer angles. Also produce 3 specific "keys to victory" for EACH team (concrete tactical/structural points referencing real squad players, recent form, opposition weakness, or weather/ground impact).

Then produce a deep "script" with these distinct sections:
- headToHead: 3-5 sentences. Recent H2H meetings, score trends, venue history at THIS ground, who has owned the rivalry lately, and any tactical pattern that has decided recent matchups.
- formAnalysis: 3-5 sentences. Compare last-5 trajectories (improving / sliding / patchy), attack vs defence ratings, points-for and points-against trend, quality of opposition faced, and whether form is real or schedule-inflated.
- xFactor: the single biggest swing variable — usually one player, one matchup, or one tactical lever — and what specifically tips the game when it fires.
- psychological: 4-6 sentences. Cover ladder positioning pressure (top-4 chase, finals must-win, wooden-spoon avoidance), occasion (Anzac Round, Magic Round, Heritage Round, grand-final rematch, derby, retirement game), expected sell-out / crowd energy, recent emotional peaks (big wins, blow-out losses, coach pressure, off-field drama), home vs away mentality of each side this season, and stadium "voodoo" (sides that don't win at this venue, sides that can't lose at this venue, weather omens).
- milestones: 1-4 individual milestones approaching for either side (games, tries, points, coaching games).

Also produce a "bookieScript": from a sharp Australian bookmaker's perspective, which result/outcome they WANT to land (limits liability, public is on the other side), which result they want to AVOID (heavy public liability), and a one-sentence summary of where their book is most exposed.

ALSO produce a "weaknessExploit" for EACH team. For each side identify:
- opponentWeakness: a specific defensive flaw in the OPPOSITION based on recent form / known matchup data — e.g. "right-edge defence leaking tries", "high missed-tackle rate at left centre", "ruck speed dropping in second half", "kick-return metres conceded", "pivot's defensive read on shape plays". Cite the side conceding it.
- targetArea: the part of the field / channel / phase the team should attack — e.g. "Right edge 20m channel", "Inside ball off the ruck", "Bomb contests on the left wing", "Short side attack from scrum".
- tacticalPlan: 2-3 sentences on HOW this team weaponises that weakness — shape, ball-runners, kicking game, set-piece.
- playersToWatch: exactly 3 NAMED squad players from THIS team most likely to score or directly influence scoring against that weakness — for each give role (e.g. "fullback", "right centre", "halfback") and a one-sentence why (form, matchup advantage, kick targets, line-running role into that channel). Use only players from the named squad above.

FINALLY, generate exactly 3 betSuggestions — one for EACH target payout tier: $100, $1,000, and $10,000. Each suggestion is a small multi (2-4 legs) combining real squad players, head-to-head winner, margin BUCKETS, totals or tryscorer markets.

CRITICAL betting rules:
- DO NOT use handicap / line / spread markets like "Roosters -12.5". Lovable users do not bet handicap. Use winning-margin BUCKETS only: "1-12", "13+", "1-6", "7-12", "13-24", "25+".
- Player try markets must use either "anytime tryscorer", "first tryscorer", or try-count buckets "1-2 tries" or "3+ tries". NEVER use a try line like "0.5".
- Set "risk" to low for the $100 tier, medium for the $1,000 tier, high for the $10,000 tier.
- Set "targetPayout" to exactly 100, 1000, or 10000 to match.
- Pick a stake that, multiplied by combined estimated decimal odds, returns approximately the target payout (e.g. $20 stake @ $5.00 odds = $100; $20 stake @ $50 odds = $1,000; $20 stake @ $500 odds = $10,000). Stake should usually be $10–$50.
- Estimate combined decimal odds by roughly multiplying the implied odds of each leg from the live odds shown.
- Make legs sharp and specific (e.g. "Roosters to win", "Margin 13+", "Tedesco anytime tryscorer", "Tupou 1-2 tries"). NEVER invent players — only use named squad members above.
- Explain in 1-2 sentences why each combo wins.`,

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
              weaknessExploit: {
                type: "object",
                properties: {
                  home: {
                    type: "object",
                    properties: {
                      opponentWeakness: { type: "string", description: "Specific defensive flaw in the AWAY team" },
                      targetArea: { type: "string", description: "Channel / phase / part of the field to attack" },
                      tacticalPlan: { type: "string", description: "2-3 sentences on how to weaponise it" },
                      playersToWatch: {
                        type: "array", minItems: 3, maxItems: 3,
                        items: {
                          type: "object",
                          properties: {
                            name: { type: "string", description: "Named squad player from HOME team" },
                            role: { type: "string", description: "Position / role" },
                            why: { type: "string", description: "Why they score or influence — 1 sentence" },
                          },
                          required: ["name", "role", "why"], additionalProperties: false,
                        },
                      },
                    },
                    required: ["opponentWeakness", "targetArea", "tacticalPlan", "playersToWatch"], additionalProperties: false,
                  },
                  away: {
                    type: "object",
                    properties: {
                      opponentWeakness: { type: "string", description: "Specific defensive flaw in the HOME team" },
                      targetArea: { type: "string" },
                      tacticalPlan: { type: "string" },
                      playersToWatch: {
                        type: "array", minItems: 3, maxItems: 3,
                        items: {
                          type: "object",
                          properties: {
                            name: { type: "string", description: "Named squad player from AWAY team" },
                            role: { type: "string" },
                            why: { type: "string" },
                          },
                          required: ["name", "role", "why"], additionalProperties: false,
                        },
                      },
                    },
                    required: ["opponentWeakness", "targetArea", "tacticalPlan", "playersToWatch"], additionalProperties: false,
                  },
                },
                required: ["home", "away"], additionalProperties: false,
              },
              betSuggestions: {
                type: "array",
                minItems: 3, maxItems: 3,
                description: "Exactly three multis: one targeting $100 payout (low risk), one targeting $1,000 payout (medium risk), one targeting $10,000 payout (high risk).",
                items: {
                  type: "object",
                  properties: {
                    risk: { type: "string", enum: ["low", "medium", "high"] },
                    title: { type: "string", description: "Short headline of the multi. NEVER use handicap markets like 'Roosters -12.5'." },
                    legs: {
                      type: "array",
                      minItems: 2, maxItems: 4,
                      items: {
                        type: "string",
                        description: "One leg of the multi. Allowed: head-to-head winner, margin BUCKETS ('1-12', '13+', '1-6', '7-12', '13-24', '25+'), total points over/under, HT/FT, anytime/first tryscorer, try-count buckets ('1-2 tries', '3+ tries'). NEVER handicap/spread/line markets. NEVER 'over 0.5 tries' style.",
                      },
                    },
                    estimatedOdds: { type: "string", description: "Combined decimal odds, e.g. '$5.00', '$50.00', '$500.00'" },
                    stake: { type: "string", description: "Suggested stake, usually $10–$50, e.g. '$20'" },
                    potentialReturn: { type: "string", description: "Estimated total return ≈ target payout tier, e.g. '$100', '$1,000', '$10,000'" },
                    targetPayout: { type: "string", enum: ["100", "1000", "10000"], description: "Which payout tier this bet is sized for: '100', '1000', or '10000'" },
                    reasoning: { type: "string", description: "Why this combo wins — 1-2 sentences" },
                  },
                  required: ["risk", "title", "legs", "estimatedOdds", "stake", "potentialReturn", "targetPayout", "reasoning"],
                  additionalProperties: false,
                },
              },
              script: {
                type: "object",
                properties: {
                  headToHead: { type: "string", description: "3-5 sentences: recent H2H meetings, score trends, venue history at this ground, who has owned the rivalry, tactical patterns deciding recent matchups." },
                  formAnalysis: { type: "string", description: "3-5 sentences: last-5 trajectories, attack vs defence, points-for/against trend, quality of opposition, whether form is real or schedule-inflated." },
                  xFactor: { type: "string", description: "Single biggest swing variable — one player, matchup, or tactical lever — and what tips the game when it fires." },
                  psychological: { type: "string", description: "4-6 sentences covering ladder positioning pressure, occasion (Anzac, Magic, Heritage, derby, retirement game), expected sell-out / crowd, recent emotional peaks, home vs away mentality, and stadium voodoo / hoodoos." },
                  milestones: {
                    type: "array",
                    minItems: 1, maxItems: 4,
                    items: { type: "string", description: "Notable milestone for player/coach/club" },
                  },
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
                required: ["headToHead", "formAnalysis", "xFactor", "psychological", "milestones", "bookieScript"], additionalProperties: false,
              },
            },
            required: [
              "predictedScore","winner","margin","total","htft",
              "firstTryscorer","anytimeTryscorers","multiTryscorer",
              "keysToVictory","keyFactors","betSuggestions","script",
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
