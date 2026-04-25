// AI-generated betting insights via Lovable AI Gateway.
// Uses tool-calling for structured output. Receives ONLY real data summaries.

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
// Use the strongest reasoning model — insights are generated ONCE per match
// and cached until ~1h before kickoff, so the extra latency/cost is paid once
// and the user gets the sharpest possible read for their bets.
const MODEL = "google/gemini-2.5-pro";
const FALLBACK_MODEL = "google/gemini-3-flash-preview";
const TIMEOUT_MS = 55_000; // pro model needs more headroom; still inside Worker budget

export type BettingAngle = {
  market: string;
  pick: string;
  reasoning: string;
  confidence: number;
};


export type BetLeg = {
  pick: string;          // e.g. "Roosters to win"
  decimalOdds: number;   // e.g. 1.45
};

// Unified shape used by EVERY bet card on the Bets tab.
// Each bet has 1-6 legs with real prices, server-computed math, and a "why".
export type BetPlay = {
  category: BetCategoryKey;
  title: string;
  legs: BetLeg[];
  combinedOdds: number;
  estimatedOdds: string;
  stake: string;
  potentialReturn: string;
  reasoning: string;
};

export type BetCategoryKey =
  | "gameScript"
  | "lowRisk"
  | "mediumRisk"
  | "highRisk"
  | "getThea"
  | "upset"
  | "bookieWant"
  | "bookieFear"
  | "anytime"
  | "firstTryscorer";

export type GameFlow = {
  openingTen: string;          // who starts hot, who is slow out the blocks
  firstHalf: string;           // 2-3 sentences on how first half plays out
  halftimeScore: { home: number; away: number };
  halftimeLeader: "home" | "away" | "draw";
  secondHalf: string;          // 2-3 sentences on how second half plays out
  momentumSwings: string[];    // 2-4 short bullets: "10-20min: Storm grab early lead", "55min: away comeback"
  halftimeDouble: { pick: string; reasoning: string; confidence: number }; // e.g. "Storm / Storm"
  closing: string;             // final 10 minutes — likely close game, blowout, late try?
};

export type TryscorerScript = {
  home: {
    picks: { name: string; market: "first" | "anytime" | "2+"; price: number | null; reasoning: string }[]; // 3-4
    avoid: { name: string; reasoning: string }[]; // 1-2 trap players to fade this week
  };
  away: {
    picks: { name: string; market: "first" | "anytime" | "2+"; price: number | null; reasoning: string }[]; // 3-4
    avoid: { name: string; reasoning: string }[];
  };
  summary: string; // 2-3 sentences: overall tryscoring read for the match
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
      opponentWeaknesses: string[];      // exactly 3 specific defensive flaws in the opposition
      targetAreas: string[];             // 1-3 channels / phases / areas to attack
      tacticalPlan: string;              // 2-3 sentences how home team exploits them
      playersToWatch: { name: string; role: string; why: string }[]; // 3 players
    };
    away: {
      opponentWeaknesses: string[];
      targetAreas: string[];
      tacticalPlan: string;
      playersToWatch: { name: string; role: string; why: string }[];
    };
  };
  // All bets live here in one consistent shape — rendered as identical cards on the Bets tab.
  bets: BetPlay[];
  gameFlow: GameFlow;
  tryscorerScript: TryscorerScript;
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
    matchFix: {
      preferredWinner: string;     // team the NRL "wants" to win and why (ratings, finals race, marquee market)
      ratingsAngle: string;        // 2-3 sentences: how the broadcast script wants the game to flow
      refereeNudges: string[];     // 3-5 cheeky bullets — penalty counts, captain's challenges, bunker calls
      narrativeMoment: string;     // the storyline beat the NRL is engineering (return game, milestone try, comeback)
      conspiracyRating: number;    // 0-100 tongue-in-cheek "how scripted does this feel?" meter
    };
  };
};

export type RealOdds = {
  h2h: { home: { price: number; book: string } | null; away: { price: number; book: string } | null };
  totals: { line: number; over: number; under: number; book: string }[]; // best lines
  spreads: { line: number; homePrice: number; awayPrice: number; book: string }[];
  tryscorers: {
    first: { player: string; price: number }[];
    anytime: { player: string; price: number }[];
    multi: { player: string; price: number }[]; // 2+ tries
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
  realOdds?: RealOdds;
  weatherSummary?: string;
}): Promise<Insights> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY not configured");

  const homeRow = payload.ladder.find((l) => l.nickname === payload.homeName);
  const awayRow = payload.ladder.find((l) => l.nickname === payload.awayName);

  const fmtSquad = (s: typeof payload.homeSquad) =>
    s.map((p) => `${p.position}: ${p.firstName} ${p.lastName}${p.isCaptain ? " (C)" : ""}`).join("; ") || "n/a";

  // Build a precise real-odds block — the AI MUST quote these prices exactly,
  // not invent fictional ones. This is what's been wrong vs TAB.
  const realOddsBlock = buildRealOddsBlock(payload.realOdds, payload.homeName, payload.awayName);

  const prompt = [
    `Match: ${payload.homeName} (home) vs ${payload.awayName} (away) at ${payload.venue}.`,
    homeRow ? `${payload.homeName}: ${homeRow.wins}W-${homeRow.losses}L, PF ${homeRow.for}, PA ${homeRow.against}, diff ${homeRow.diff}, pos ${payload.homePosition ?? "?"}.` : "",
    awayRow ? `${payload.awayName}: ${awayRow.wins}W-${awayRow.losses}L, PF ${awayRow.for}, PA ${awayRow.against}, diff ${awayRow.diff}, pos ${payload.awayPosition ?? "?"}.` : "",
    `${payload.homeName} named squad (NRL.com official): ${fmtSquad(payload.homeSquad)}`,
    `${payload.awayName} named squad (NRL.com official): ${fmtSquad(payload.awaySquad)}`,
    `Home recent form: ${payload.homeRecentForm.map((f) => `${f.result} ${f.summary} ${f.score}`).join("; ") || "n/a"}`,
    `Away recent form: ${payload.awayRecentForm.map((f) => `${f.result} ${f.summary} ${f.score}`).join("; ") || "n/a"}`,
    `Live AU bookie odds summary: ${payload.oddsSummary}`,
    realOddsBlock,
    payload.weatherSummary ? `Forecast at venue at kickoff: ${payload.weatherSummary}` : "",
    `You are writing for a sharp NRL bettor. Output FEWER, BETTER, SHARPER insights — not more text. Every line you produce must pass this test: "If this insight was removed, would the user lose meaningful betting value?" If no, do NOT write it.

GLOBAL INSIGHT RULES (apply to EVERY field, every section):
1. UNIQUE — never restate the same idea twice. No paraphrased duplicates. If two sections would say "team X is in good form", only the strongest version survives, and it must add WHY that form is or isn't reliable for THIS bet.
2. EVIDENCE-BASED — every insight must cite something concrete from the data above: a stat (W-L, PF, PA, diff, ladder pos), a recent-form scoreline, a named squad player, a bookie price, a weather signal. No floating opinions.
3. CONTEXTUAL — explain why it matters for THIS specific game, not as a generic team summary.
4. DECISION-RELEVANT — must change a bet decision (winner, margin bucket, total, HT/FT, tryscorer market, line shopping, stake sizing).
5. NON-OBVIOUS — skip surface-level reads the user can already infer (e.g. "the favourite is favoured", "tries usually come from wingers").
6. ASYMMETRIC — never produce mirror-image content for both teams. If a key, weakness, or tactical plan reads identical with names swapped, REWRITE both sides so they target different channels, different phases, different named players, different markets.

SECTION DIFFERENTIATION (each section serves a DIFFERENT purpose — overlap is forbidden):
- script.headToHead: rivalry / venue history pattern only. NOT current form.
- script.formAnalysis: trajectory + quality of opposition faced + whether form is real or schedule-inflated. Must include a "form is misleading because…" angle when applicable. NOT rivalry. NOT player picks.
- script.xFactor: ONE single swing variable (one named player OR one matchup OR one tactical lever). Must NOT repeat anything from formAnalysis.
- script.psychological: external pressure / occasion / venue mentality only. NOT form, NOT rivalry trends.
- keysToVictory: 3 levers per team. Each side's 3 keys must use DIFFERENT levers (set-piece attack vs defensive structure vs game management). Cannot repeat what xFactor or weaknessExploit already said.
- weaknessExploit: defensive flaws of the OPPOSITION + how to attack them. Tied to specific markets that benefit. Must NOT restate keysToVictory.
- keyFactors: meta-level swing factors NOT covered above (referee tendencies, travel, late-mail risk, market movement, weather impact translated to a market). Cap at 3-4. If a candidate factor was already implied above, drop it.
- gameFlow: time-window-pinned predictions only (opening 10, halves, momentum swings at specific minute marks). NOT generic "team X is better" — every bullet must reference a window AND tie to an HT/FT or live-betting angle.
- tryscorerScript: per-player tryscoring rationale. Must cite role/edge/set-piece usage. Avoid players who only profile generically — pick spots where the matchup actually creates the chance.
- bets: market construction only. Reasoning must reference WHICH upstream insight (xFactor / weaknessExploit / gameFlow / bookieScript) the bet leans on, and WHY the market is mispriced or aligned.

ANTI-REPETITION ENFORCEMENT:
- Before finalising any string, scan everything you have written. If two strings share the same core point (≥60% semantic overlap), KEEP the strongest version and rewrite the other to add new information or DELETE it (drop array items rather than dilute).
- Never restate ladder position, W-L record, or recent-form summary in more than one section.
- Never repeat a player's name across keysToVictory + weaknessExploit.playersToWatch + tryscorerScript with the SAME reason. If the same player appears, each mention must justify a DIFFERENT market.

INSIGHT QUALITY BAR (examples):
- BAD: "Storm are a strong attacking team."
- GOOD: "Storm rank top-3 in red-zone conversion but face the league's #1 goal-line defence — anytime tryscorer prices on Storm outside backs are shorter than the matchup justifies; lean unders on Storm individual try lines."
- BAD: "Raiders are in good form."
- GOOD: "Raiders' 4-from-5 was built against opponents averaging 12th on the ladder; their h2h price is shorter than that schedule warrants — fade the favourite multi, take the underdog covering on +12.5."
- BAD: "Rain may affect the game."
- GOOD: "Forecast 4mm rain compresses attacking width and rewards middle-dominant packs — value lives on UNDER the main total and on forward anytime tries (named: <player>) over outside-back markets."

That is the minimum standard for EVERY string you emit.

Now produce the structured payload below. Be concise: one strong sentence beats three weak ones.

CRITICAL — every insight must serve a BETTOR reading this to land bets. Tie every observation to a specific market: who wins, who covers, who scores, when momentum swings, where the value sits.

Now produce 3 specific "keys to victory" for EACH team. These MUST be DIFFERENT for each team — NOT mirror images. Each team's keys are based on THEIR OWN strengths and HOW THEY can beat THIS specific opponent. Reference real squad players by name, real recent form trends, real opposition weaknesses, and real weather/ground impact. NEVER produce keys that are literally the same point with team names swapped (e.g. "Win the kick-and-chase so X start sets in their own half" used for both sides — that is forbidden). Each key should pick a different lever: e.g. one about set-piece attack from a specific named player, one about defensive structure exploiting a specific opposition weakness, one about game-management (kicking, ruck speed, completion).

Then produce a deep "script" with these distinct sections:
- headToHead: 3-5 sentences. Recent H2H meetings, score trends, venue history at THIS ground, who has owned the rivalry lately, and any tactical pattern that has decided recent matchups.
- formAnalysis: 3-5 sentences. Compare last-5 trajectories (improving / sliding / patchy), attack vs defence ratings, points-for and points-against trend, quality of opposition faced, and whether form is real or schedule-inflated.
- xFactor: the single biggest swing variable — usually one player, one matchup, or one tactical lever — and what specifically tips the game when it fires.
- psychological: 4-6 sentences. Cover ladder positioning pressure (top-4 chase, finals must-win, wooden-spoon avoidance), occasion (Anzac Round, Magic Round, Heritage Round, grand-final rematch, derby, retirement game), expected sell-out / crowd energy, recent emotional peaks (big wins, blow-out losses, coach pressure, off-field drama), home vs away mentality of each side this season, and stadium "voodoo" (sides that don't win at this venue, sides that can't lose at this venue, weather omens).
- milestones: 1-4 individual milestones approaching for either side (games, tries, points, coaching games).

Also produce a "bookieScript": from a sharp Australian bookmaker's perspective, which result/outcome they WANT to land (limits liability, public is on the other side), which result they want to AVOID (heavy public liability), and a one-sentence summary of where their book is most exposed.

ALSO produce a "matchFix" — a tongue-in-cheek "how the NRL would script this game for ratings/money" read. Be playful and clearly satirical (not a real accusation), but anchor it in genuine commercial logic — TV ratings, prime-time market (Sydney/Brisbane/Melbourne), finals race implications, marquee player storylines, sponsor angle, attendance, and the league office's preferred narrative.
- preferredWinner: which side V'landys / the broadcast would quietly prefer to win, and the commercial reason (e.g. "Storm — keeps Melbourne market engaged for finals push").
- ratingsAngle: 2-3 sentences on the broadcast's dream script — close margin into the last 10? blowout for a marquee? a comeback? Tie it to ratings.
- refereeNudges: 3-5 cheeky bullets on the "lean" — penalty count direction, captain's-challenge timing, bunker leniency on a marquee scorer, six-again calls in key sets, late-game obstruction call. Keep it cheeky / wink-wink, not malicious.
- narrativeMoment: the single storyline the NRL is engineering — return game, milestone try, coach-on-the-brink, retiring legend, debutant fairytale.
- conspiracyRating: 0-100 "how scripted does this feel?" meter (most matches sit 30-60 — a marquee finals race or grand-final rematch can sit higher).


ALSO produce a "weaknessExploit" for EACH team. The two teams' exploit blocks MUST be DIFFERENT — they target different channels, different phases, different named players, because the two opponents have genuinely different defensive profiles. Do NOT produce mirror-image content with names swapped. For each side identify:
- opponentWeaknesses: an array of EXACTLY 3 distinct, specific defensive flaws in the OPPOSITION based on recent form / known matchup data. Each one a concrete short phrase, e.g. "Right-edge defence leaking tries — missed tackle % at left centre", "Ruck speed drops sharply in second half", "Vulnerable under high bombs on left wing", "Slow line-speed against shape plays from scrum". The home team's "opponentWeaknesses" describe the AWAY team's flaws; the away team's "opponentWeaknesses" describe the HOME team's flaws — and these should NOT overlap unless both sides genuinely share the same flaw.
- targetAreas: an array of 1-3 specific channels / phases / parts of the field to attack — e.g. "Right edge 20m channel", "Inside ball off the ruck", "Bomb contests on the left wing", "Short side from scrum". Make these concrete and asymmetric across the two teams.
- tacticalPlan: 2-3 sentences on HOW this team weaponises those weaknesses — shape, ball-runners, kicking game, set-piece. Tie directly to BETTING value (which markets light up if this plan hits — e.g. "boosts our anytime tryscorer for [name] and over 22.5 first-half points").
- playersToWatch: exactly 3 NAMED squad players from THIS team most likely to score or directly influence scoring against those weaknesses — for each give role and a one-sentence why. Use only players from the named squad above.

ALSO produce a "gameFlow" object — a quarter-by-quarter script of how the match likely unfolds:
- openingTen: 1-2 sentences. Who starts hot, who is slow out the blocks, early field-position battle, opening kick chase.
- firstHalf: 2-3 sentences on how the first 40 mins plays out — completion battle, who scores first, set-piece tries, defensive lapses.
- halftimeScore: realistic { home, away } prediction. Should roughly match the predictedScore final but split sensibly across halves.
- halftimeLeader: "home", "away", or "draw" based on halftimeScore.
- secondHalf: 2-3 sentences on the second 40 — bench impact, kicking game in the wet/dry, who tires, late surge.
- momentumSwings: 2-4 short bullets pinned to time windows e.g. "10-20min: Storm grab early lead through Munster shape", "55min: Eels mount comeback off back-to-back sets", "70min: Roosters ice it through field goal".
- halftimeDouble: a HT/FT pick like "Storm / Storm" or "Draw / Storm" with reasoning and confidence 0-100. Mix in cross-overs (Draw/X or AwayHT/HomeFT) when the script supports it — don't always default to favourite/favourite.
- closing: 1-2 sentences on the final 10 — close finish, blowout, late try cover, golden point territory?

ALSO produce a "tryscorerScript" — a focused tryscoring read for both teams:
- For EACH team, pick 3-4 tryscorer plays from the named squad. Pull the price directly from the LIVE BOOKIE ODDS block (anytime / first / 2+) — set price to that exact number, otherwise null. Each pick has: name (named squad only), market ("first" | "anytime" | "2+"), price (number from real odds, or null if not yet listed), reasoning (1-2 sentences citing form, opposition weakness, attacking shape, set-piece role, kick-chase). Spread the picks across edge (wing/centre), middle (back-row/lock crash), and spine (fullback/half) where the matchup supports it. Don't pick all from the favourite — go where the tries actually land.
- For EACH team also list 1-2 "avoid" players — trap names the public will pile into who are poor value this week (out of form, bad matchup, used as decoy, not getting touches). Each with a 1-sentence reason.
- summary: 2-3 sentences on the overall tryscoring picture — total tries expected, which edge leaks, who carries the kicking game.

FINALLY, generate the "bets" object — TEN bet plays, every one with the SAME shape (title, legs[], combinedOdds, estimatedOdds, stake, potentialReturn, reasoning). Each bet must be ground in the data you produced above (winner, margin, total, HT/FT, tryscorerScript, weaknessExploit, gameFlow, bookieScript). Always quote LIVE BOOKIE ODDS prices exactly when a leg matches.

For EACH of the ten categories use the stake/target shown:

1. gameScript — the cleanest read of the match. 4-6 legs that match your own predictions: winning team + winning margin BUCKET + total over/under + HT/FT double + ONE tryscorer from EACH team (anytime, drawn from tryscorerScript picks). Stake "$10". This is the "if the script plays out, this lands" multi.
2. lowRisk — small safe multi (2-3 legs) aiming ~$100 from $5 stake (combinedOdds ~20). Use favourite-leaning legs: h2h winner of the strong side, total over/under at the most stable line, one strong anytime tryscorer. Stake "$5".
3. mediumRisk — 3-4 legs aiming ~$500 from $5 stake (combinedOdds ~100). Mix in a margin bucket or a 2+ tryscorer. Stake "$5".
4. highRisk — 4-5 legs aiming ~$1,000 from $5 stake (combinedOdds ~200). Include a HT/FT double and a multi-tryscorer / longer tryscorer. Stake "$5".
5. getThea — THE bet of the slate. 4-5 long legs aiming ~$10,000 from $5 stake (combinedOdds ~2000). Include a sharp margin bucket, HT/FT cross or favourite double, two tryscorer legs (mix anytime + 2+), one over/under. Stake "$5". Reasoning must cite weakness exploit, X-factor, and named players.
6. upset — straight underdog play AGAINST the market. Single leg = "<underdog nickname> to win" at the EXACT real h2h price for the underdog (longer h2h price from LIVE BOOKIE ODDS). Stake "$20". Reasoning explains why the underdog can pull it off (form, key matchup, weather, motivation).
7. bookieWant — the result the bookies WANT to land (low public liability — this matches script.bookieScript.wantToWin). 1-2 legs that line up with that result. Stake "$10".
8. bookieFear — the result the bookies FEAR (heavy public exposure — script.bookieScript.wantToLose). 2-3 legs that lean into the bookies' nightmare. Stake "$10".
9. anytime — pure anytime tryscorer multi. 3-4 legs, ALL "<player> anytime tryscorer", drawn from your tryscorerScript picks (mix both teams). Stake "$10". Use real anytime prices.
10. firstTryscorer — STANDALONE single bet on first tryscorer. Exactly 1 leg "<player> first tryscorer" using the LIVE BOOKIE ODDS first-tryscorer price. Stake "$5". Pick the most credible value name from tryscorerScript.

CRITICAL betting & ODDS-MATH rules — READ CAREFULLY:
- USE THE EXACT REAL ODDS PROVIDED ABOVE. The "LIVE BOOKIE ODDS" block contains real prices from AU bookies (TAB-aligned). When a leg matches a market shown there (h2h winner, anytime tryscorer for a listed player, first tryscorer for a listed player, total over/under at a listed line, or 2+ tries for a listed player), you MUST use that exact decimalOdds value. Do NOT estimate or round.
- For markets not in the block (margin buckets, HT/FT, try-count buckets like "1-2 tries"), use realistic AU prices: margin "1-12" ~$1.80-2.20, "13+" ~$1.70-2.10, "1-6" ~$3-4, "7-12" ~$3.50-4.50, "13-24" ~$3-4, "25+" ~$5-9; HT/FT same team ~$2.20-3.50; HT/FT cross ~$8-15; "1-2 tries" ~$2.50-4 (player-dependent), "3+ tries" ~$15-50.
- DO NOT use handicap / line / spread markets like "Roosters -12.5". Use winning-margin BUCKETS only.
- Player try markets must use "anytime tryscorer", "first tryscorer", or try-count buckets "1-2 tries" / "3+ tries". NEVER "over 0.5".
- combinedOdds MUST equal the PRODUCT of all leg decimalOdds (within ±5%).
- Stake × combinedOdds must roughly hit the target payout for that category. The server will recompute everything — get the legs and their prices right.
- NEVER invent players — only named squad members above. For tryscorer legs, prefer players that appear in the LIVE BOOKIE ODDS block.
- DO NOT include first-tryscorer legs in any of gameScript / lowRisk / mediumRisk / highRisk / getThea / anytime — first-tryscorer is RESERVED for the standalone "firstTryscorer" bet only.
- Each bet's reasoning is 2-3 sentences citing specific stats / lineups / form / weakness exploit / X-factor — explain WHY this bet aligns with the rest of the analysis.`,

  ].filter(Boolean).join("\n");

  const toolDef = buildToolDef();
  const messages = [
    { role: "system", content: "You are a professional NRL analyst and betting tipster. Use only the data provided. Never invent stats, players, or odds. When real bookie odds are provided for a market, quote them EXACTLY — do not estimate. You MUST respond by calling the emit_insights tool exactly once with a single argument named payload, where payload is a raw JSON string containing the full insights object requested by the user prompt. No markdown, no code fences, no extra wrapper fields inside payload. Be concise in prose fields to stay within token limits." },
    { role: "user", content: prompt },
  ];

  // Try the Pro model first for the best analysis. If it fails (timeout, rate
  // limit, parse error), retry once with the fast Flash model. Only after both
  // miss do we fall back to the deterministic local summary.
  try {
    const parsed = await callGateway(key, MODEL, messages, toolDef, TIMEOUT_MS);
    return normaliseBetMath(applyRealOdds(parsed, payload.realOdds, payload.homeName, payload.awayName));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`AI insights: ${MODEL} failed (${msg}); retrying with ${FALLBACK_MODEL}`);
    try {
      const parsed = await callGateway(key, FALLBACK_MODEL, messages, toolDef, 15_000);
      return normaliseBetMath(applyRealOdds(parsed, payload.realOdds, payload.homeName, payload.awayName));
    } catch (e2) {
      const msg2 = e2 instanceof Error ? e2.message : String(e2);
      console.warn(`AI insights: ${FALLBACK_MODEL} also failed (${msg2}); using local fallback`);
      return normaliseBetMath(applyRealOdds(buildFallbackInsights(payload), payload.realOdds, payload.homeName, payload.awayName));
    }
  }
}

function buildRealOddsBlock(realOdds: RealOdds | undefined, home: string, away: string): string {
  if (!realOdds) return "";
  const lines: string[] = ["", "LIVE BOOKIE ODDS (real AU prices — use these exactly when a leg matches):"];
  if (realOdds.h2h.home || realOdds.h2h.away) {
    const h = realOdds.h2h.home ? `${home} $${realOdds.h2h.home.price.toFixed(2)} (${realOdds.h2h.home.book})` : `${home} —`;
    const a = realOdds.h2h.away ? `${away} $${realOdds.h2h.away.price.toFixed(2)} (${realOdds.h2h.away.book})` : `${away} —`;
    lines.push(`- Head-to-head (best price): ${h} | ${a}`);
  }
  if (realOdds.totals.length > 0) {
    const t = realOdds.totals.slice(0, 3).map((x) => `${x.line}: O $${x.over.toFixed(2)} / U $${x.under.toFixed(2)} (${x.book})`).join(" | ");
    lines.push(`- Total points lines: ${t}`);
  }
  if (realOdds.tryscorers.first.length > 0) {
    lines.push(`- First tryscorer: ${realOdds.tryscorers.first.slice(0, 12).map((p) => `${p.player} $${p.price.toFixed(2)}`).join(", ")}`);
  }
  if (realOdds.tryscorers.anytime.length > 0) {
    lines.push(`- Anytime tryscorer: ${realOdds.tryscorers.anytime.slice(0, 16).map((p) => `${p.player} $${p.price.toFixed(2)}`).join(", ")}`);
  }
  if (realOdds.tryscorers.multi.length > 0) {
    lines.push(`- 2+ tries: ${realOdds.tryscorers.multi.slice(0, 10).map((p) => `${p.player} $${p.price.toFixed(2)}`).join(", ")}`);
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

function buildFallbackInsights(payload: {
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
  realOdds?: RealOdds;
  weatherSummary?: string;
}): Insights {
  const homeRow = payload.ladder.find((l) => l.nickname === payload.homeName);
  const awayRow = payload.ladder.find((l) => l.nickname === payload.awayName);
  const priceMap = buildPriceLookup(payload.realOdds);
  const weather = (payload.weatherSummary ?? "").toLowerCase();
  const wetWeather = /(rain|shower|storm|wet)/.test(weather);
  const windy = /wind/.test(weather);

  const homeFormScore = recentFormScore(payload.homeRecentForm);
  const awayFormScore = recentFormScore(payload.awayRecentForm);
  const homeRating = teamRating(homeRow, homeFormScore, payload.realOdds?.h2h.home?.price, true);
  const awayRating = teamRating(awayRow, awayFormScore, payload.realOdds?.h2h.away?.price, false);

  const predictedHome = projectScore(homeRow, awayRow, homeFormScore, true, wetWeather, windy);
  const predictedAway = projectScore(awayRow, homeRow, awayFormScore, false, wetWeather, windy);

  let homeScore = predictedHome;
  let awayScore = predictedAway;
  const winnerTeam: "home" | "away" = homeRating >= awayRating ? "home" : "away";
  if (homeScore === awayScore) {
    if (winnerTeam === "home") homeScore += 2;
    else awayScore += 2;
  }
  const winnerName = winnerTeam === "home" ? payload.homeName : payload.awayName;
  const loserName = winnerTeam === "home" ? payload.awayName : payload.homeName;
  const marginValue = Math.abs(homeScore - awayScore);
  const marginBucket = marginValue <= 6 ? "1-6" : marginValue <= 12 ? "7-12" : "13+";
  const totalLine = payload.realOdds?.totals[0]?.line ?? 44.5;
  const totalPoints = homeScore + awayScore;
  const totalPick: "over" | "under" = totalPoints >= totalLine ? "over" : "under";
  const confidence = clamp(Math.round(56 + Math.abs(homeRating - awayRating) * 4), 52, 81);

  const homeAttackers = rankAttackers(payload.homeSquad, priceMap);
  const awayAttackers = rankAttackers(payload.awaySquad, priceMap);
  const homeCore = padPlayers(homeAttackers, payload.homeName);
  const awayCore = padPlayers(awayAttackers, payload.awayName);
  const winnerCore = winnerTeam === "home" ? homeCore : awayCore;
  const loserCore = winnerTeam === "home" ? awayCore : homeCore;

  const firstPickPlayer = winnerCore.find((p) => p.prices.first != null) ?? winnerCore[0] ?? loserCore[0];
  const multiPickPlayer = winnerCore.find((p) => p.prices.multi != null) ?? winnerCore[1] ?? winnerCore[0] ?? loserCore[0];
  const anytimePicks = [winnerCore[0], winnerCore[1], loserCore[0]].filter(Boolean).slice(0, 3);

  const halftimeHome = Math.max(4, Math.round(homeScore * 0.48));
  const halftimeAway = Math.max(4, Math.round(awayScore * 0.48));
  const halftimeLeader: "home" | "away" | "draw" = halftimeHome === halftimeAway
    ? "draw"
    : halftimeHome > halftimeAway
      ? "home"
      : "away";
  const htftPick = `${halftimeLeader === "draw" ? "Draw" : halftimeLeader === "home" ? payload.homeName : payload.awayName} / ${winnerName}`;

  const homeExploit = buildWeaknessExploit(payload.homeName, payload.awayName, homeCore, wetWeather, "home", homeFormScore, awayFormScore, payload.homePosition, payload.awayPosition);
  const awayExploit = buildWeaknessExploit(payload.awayName, payload.homeName, awayCore, wetWeather, "away", awayFormScore, homeFormScore, payload.awayPosition, payload.homePosition);
  const bookieWant = payload.realOdds?.h2h.home && payload.realOdds?.h2h.away
    ? payload.realOdds.h2h.home.price < payload.realOdds.h2h.away.price
      ? `${payload.awayName} to muddy the game up or pinch it late — it breaks up the public favourite multis built around ${payload.homeName}.`
      : `${payload.homeName} to muddy the game up or pinch it late — it breaks up the public favourite multis built around ${payload.awayName}.`
    : `${loserName} to turn this into a low-event upset — that is the cleaner result for the book.`;
  const bookieFear = `${winnerName} winning in the script everyone can see: result plus points plus the obvious edge tryscorers.`;
  const liability = `${winnerName} head-to-head and the headline anytime names carry the clearest public exposure.`;

  const anytimeBetPlayers = [winnerCore[0], winnerCore[1], loserCore[0], loserCore[1]].filter(Boolean).slice(0, 4);
  const firstTryName = playerName(firstPickPlayer, winnerName);
  const multiTryName = playerName(multiPickPlayer, winnerName);
  const preferredWinner = `${winnerName} — the cleaner TV story is a marketable side staying relevant, keeping the broadcast talking points alive into next week.`;

  return {
    predictedScore: { home: homeScore, away: awayScore },
    winner: {
      team: winnerTeam,
      confidence,
      reasoning: `${winnerName} rate slightly better on current form, field position profile and game control, with ${winnerTeam === "home" ? "home turf" : "the stronger market lean"} giving them the final edge.`,
    },
    margin: {
      value: marginValue,
      bucket: marginBucket,
      reasoning: marginValue <= 6
        ? `The matchup projects as a grind rather than a blowout, so a one-score finish is the live lane.`
        : `The stronger side should win enough territory and set starts to separate over 80 minutes.`,
    },
    total: {
      line: totalLine,
      pick: totalPick,
      reasoning: `${wetWeather || windy ? "Weather trims some fluency, " : "Both teams still have enough strike to score, "}${totalPoints >= totalLine ? "so the game still leans over the main total." : "so the safer read is a touch under the main total."}`,
    },
    htft: {
      pick: htftPick,
      reasoning: `${winnerName} look the more stable side through the middle third, which should show up before the benches fully empty out.`,
      confidence: clamp(confidence - 4, 50, 78),
    },
    firstTryscorer: {
      pick: firstTryName,
      reasoning: `${firstTryName} profiles as the cleanest first-strike candidate through early shift ball and red-zone usage.`,
    },
    anytimeTryscorers: anytimePicks.map((p) => ({
      pick: playerName(p, winnerName),
      reasoning: `${playerName(p, winnerName)} sits in a high-touch scoring lane and matches up well with the edge pressure expected in this game.`,
    })),
    multiTryscorer: {
      pick: multiTryName,
      reasoning: `${multiTryName} is the best long-shot double candidate if the favourite owns territory and repeat sets.`,
      confidence: clamp(confidence - 12, 38, 68),
    },
    keysToVictory: {
      home: buildKeysToVictory(payload.homeName, payload.awayName, homeCore, wetWeather),
      away: buildKeysToVictory(payload.awayName, payload.homeName, awayCore, wetWeather),
    },
    keyFactors: [
      `${winnerName}'s kick-pressure game should decide who starts sets on the front foot.`,
      `${wetWeather ? "Ball security and discipline in greasy conditions." : "Edge execution off shape and quick ruck speed."}`,
      `${loserName} need to shorten the game and avoid inviting repeat sets.`,
      `The middle-third battle should decide whether the match stays live late or swings one way early.`,
    ],
    weaknessExploit: {
      home: homeExploit,
      away: awayExploit,
    },
    bets: buildFallbackBets({
      winnerName,
      loserName,
      marginBucket,
      totalLine,
      totalPick,
      htftPick,
      firstTryName,
      multiTryName,
      winnerPrice: winnerTeam === "home" ? payload.realOdds?.h2h.home?.price : payload.realOdds?.h2h.away?.price,
      loserPrice: winnerTeam === "home" ? payload.realOdds?.h2h.away?.price : payload.realOdds?.h2h.home?.price,
      gameScriptAnytimeA: playerName(winnerCore[0], winnerName),
      gameScriptAnytimeB: playerName(loserCore[0], loserName),
      anytimePlayers: anytimeBetPlayers.map((p, i) => ({ name: playerName(p, i < 2 ? winnerName : loserName), price: p.prices.anytime ?? estimateAnytimeOdds(i) })),
      firstTryPrice: firstPickPlayer?.prices.first ?? 9,
      multiTryPrice: multiPickPlayer?.prices.multi ?? 4.5,
    }),
    gameFlow: {
      openingTen: `${payload.homeName} should start with the cleaner territory game, while ${payload.awayName} look to absorb early pressure and play off yardage errors.`,
      firstHalf: `${winnerName} project to win the kick battle early and turn that into repeat looks at the line. ${loserName} can stay in touch if they complete well, but they likely spend more of the half defending exits and edge shifts.`,
      halftimeScore: { home: halftimeHome, away: halftimeAway },
      halftimeLeader,
      secondHalf: `${loserName} should have a push once benches settle, but ${winnerName} still profile as the side more likely to finish sets cleanly and turn pressure into points.`,
      momentumSwings: [
        `10-20min: ${winnerName} build field position through repeat-set pressure.`,
        `35-50min: ${loserName} lift off quicker yardage and bench energy.`,
        `60-72min: ${winnerName} regain control through territory and composure.`,
      ],
      halftimeDouble: {
        pick: htftPick,
        reasoning: `${winnerName} look the more consistent side across both halves, even if the middle period gets messy.`,
        confidence: clamp(confidence - 5, 50, 76),
      },
      closing: marginValue <= 6
        ? `Expect a live final 10 minutes with territory swings deciding whether the favourite covers or just escapes.`
        : `${winnerName} should be the side finishing stronger if they get to the last 10 with scoreboard control.`,
    },
    tryscorerScript: {
      home: buildTryscorerTeamBlock(payload.homeName, homeCore, payload.awayName),
      away: buildTryscorerTeamBlock(payload.awayName, awayCore, payload.homeName),
      summary: `${winnerName} have the stronger scoring profile, but both teams still show edge-tryscorer routes if the middle battle opens up. ${wetWeather ? "Greasy conditions lower the ceiling a touch and favour cleaner finishers." : "Dry-weather shape puts the outside backs right in the frame."}`,
    },
    script: {
      headToHead: `${payload.homeName} carry the venue edge at ${payload.venue}, while ${payload.awayName} come in needing to match that early energy. The matchup still looks more like a territory and composure game than a pure shootout.`,
      formAnalysis: `${payload.homeName} recent form reads ${formTag(homeFormScore)}, while ${payload.awayName} look ${formTag(awayFormScore)}. Ladder profile, points differential and market lean all hint that the margin for error is slimmer for ${loserName}.`,
      xFactor: `${playerName(winnerCore[0], winnerName)} is the cleanest swing piece — if that edge gets good ball, the scoreboard pressure follows quickly.`,
      psychological: `${winnerName} enter with the steadier external read, while ${loserName} need this to avoid chasing the game script from behind. ${payload.homePosition ? `${payload.homeName} are playing from ${payload.homePosition} on the ladder. ` : ""}${payload.awayPosition ? `${payload.awayName} sit ${payload.awayPosition}, so every point matters in the table squeeze. ` : ""}${payload.venue} should give the game enough atmosphere to matter late if it stays within a score.`,
      milestones: [
        `${payload.homeName} need the two points to sharpen their ladder trajectory from ${payload.homePosition ?? "their current spot"}.`,
        `${payload.awayName} can shift the outside noise quickly with a composed result from ${payload.awayPosition ?? "their current ladder position"}.`,
        `The spine battle is the big statement piece — whichever side controls the tempo will own the storyline afterward.`,
      ],
      bookieScript: {
        wantToWin: bookieWant,
        wantToLose: bookieFear,
        liability,
      },
      matchFix: {
        preferredWinner,
        ratingsAngle: `The dream broadcast script is ${winnerName} taking control, ${loserName} making one serious late push, and the game still being alive deep into the final 10. Close finishes hold viewers; clean narrative beats drive the post-game chatter.`,
        refereeNudges: [
          `A couple of early 50/50 ruck calls lean toward ${winnerName} when field position is up for grabs.`,
          `The bunker finds just enough daylight on the marquee finisher if the grounding is messy.`,
          `${winnerName} get the timely six-again right when momentum needs a reset.`,
        ],
        narrativeMoment: `${playerName(winnerCore[0], winnerName)} landing the headline play late is the neatest TV finish.`,
        conspiracyRating: clamp(42 + (marginValue <= 6 ? 12 : 4) + (payload.realOdds ? 4 : 0), 25, 72),
      },
    },
  };
}

function buildFallbackBets(input: {
  winnerName: string;
  loserName: string;
  marginBucket: string;
  totalLine: number;
  totalPick: "over" | "under";
  htftPick: string;
  firstTryName: string;
  multiTryName: string;
  winnerPrice?: number | null;
  loserPrice?: number | null;
  gameScriptAnytimeA: string;
  gameScriptAnytimeB: string;
  anytimePlayers: { name: string; price: number }[];
  firstTryPrice: number;
  multiTryPrice: number;
}): BetPlay[] {
  const totalPickLabel = `${input.totalPick === "over" ? "Over" : "Under"} ${input.totalLine} total points`;
  const marginOdds = input.marginBucket === "1-6" ? 3.4 : input.marginBucket === "7-12" ? 3.8 : 2.1;
  const winnerPrice = input.winnerPrice ?? 1.72;
  const loserPrice = input.loserPrice ?? 2.35;
  const anytimeA = input.anytimePlayers[0];
  const anytimeB = input.anytimePlayers[1] ?? input.anytimePlayers[0];
  const anytimeC = input.anytimePlayers[2] ?? input.anytimePlayers[0];
  const anytimeD = input.anytimePlayers[3] ?? input.anytimePlayers[1] ?? input.anytimePlayers[0];

  return [
    {
      category: "gameScript",
      title: `${input.winnerName} script multi`,
      legs: [
        { pick: `${input.winnerName} to win`, decimalOdds: winnerPrice },
        { pick: `${input.winnerName} winning margin ${input.marginBucket}`, decimalOdds: marginOdds },
        { pick: totalPickLabel, decimalOdds: 1.9 },
        { pick: input.htftPick, decimalOdds: 2.45 },
        { pick: `${input.gameScriptAnytimeA} anytime tryscorer`, decimalOdds: anytimeA.price },
        { pick: `${input.gameScriptAnytimeB} anytime tryscorer`, decimalOdds: anytimeC.price },
      ],
      combinedOdds: 1,
      estimatedOdds: "$0.00",
      stake: "$10",
      potentialReturn: "$0.00",
      reasoning: `${input.winnerName} are the cleaner base result and the try angles line up with the same territory script.`,
    },
    {
      category: "lowRisk",
      title: `Favourite + total + finisher`,
      legs: [
        { pick: `${input.winnerName} to win`, decimalOdds: winnerPrice },
        { pick: totalPickLabel, decimalOdds: 1.9 },
        { pick: `${anytimeA.name} anytime tryscorer`, decimalOdds: anytimeA.price },
      ],
      combinedOdds: 1,
      estimatedOdds: "$0.00",
      stake: "$5",
      potentialReturn: "$0.00",
      reasoning: `It keeps the core read simple: better side, cleaner total lane, best finishing threat.`,
    },
    {
      category: "mediumRisk",
      title: `Margin step-up multi`,
      legs: [
        { pick: `${input.winnerName} to win`, decimalOdds: winnerPrice },
        { pick: `${input.winnerName} winning margin ${input.marginBucket}`, decimalOdds: marginOdds },
        { pick: `${anytimeA.name} anytime tryscorer`, decimalOdds: anytimeA.price },
        { pick: `${input.multiTryName} 2+ tries`, decimalOdds: input.multiTryPrice },
      ],
      combinedOdds: 1,
      estimatedOdds: "$0.00",
      stake: "$5",
      potentialReturn: "$0.00",
      reasoning: `This adds the sharper scoring lane without fully leaving the main match script.`,
    },
    {
      category: "highRisk",
      title: `Pressure-cooker long shot`,
      legs: [
        { pick: `${input.winnerName} winning margin ${input.marginBucket}`, decimalOdds: marginOdds },
        { pick: input.htftPick, decimalOdds: 2.45 },
        { pick: `${input.multiTryName} 2+ tries`, decimalOdds: input.multiTryPrice },
        { pick: `${anytimeB.name} anytime tryscorer`, decimalOdds: anytimeB.price },
      ],
      combinedOdds: 1,
      estimatedOdds: "$0.00",
      stake: "$5",
      potentialReturn: "$0.00",
      reasoning: `If the stronger side owns territory, the double and repeat-finisher angle are both live.`,
    },
    {
      category: "getThea",
      title: `Get Thea mega swing`,
      legs: [
        { pick: `${input.winnerName} winning margin ${input.marginBucket}`, decimalOdds: marginOdds },
        { pick: input.htftPick, decimalOdds: 3.8 },
        { pick: totalPickLabel, decimalOdds: 1.9 },
        { pick: `${anytimeA.name} anytime tryscorer`, decimalOdds: anytimeA.price },
        { pick: `${input.multiTryName} 2+ tries`, decimalOdds: input.multiTryPrice },
      ],
      combinedOdds: 1,
      estimatedOdds: "$0.00",
      stake: "$5",
      potentialReturn: "$0.00",
      reasoning: `This leans hard into the same field-position story and asks the headline finisher to cash in twice.`,
    },
    {
      category: "upset",
      title: `${input.loserName} upset single`,
      legs: [{ pick: `${input.loserName} to win`, decimalOdds: loserPrice }],
      combinedOdds: 1,
      estimatedOdds: "$0.00",
      stake: "$20",
      potentialReturn: "$0.00",
      reasoning: `If the favourite coughs up discipline and territory, the underdog price is the clean contrarian angle.`,
    },
    {
      category: "bookieWant",
      title: `Bookie relief result`,
      legs: [
        { pick: `${input.loserName} to win`, decimalOdds: loserPrice },
        { pick: totalPickLabel, decimalOdds: 1.9 },
      ],
      combinedOdds: 1,
      estimatedOdds: "$0.00",
      stake: "$10",
      potentialReturn: "$0.00",
      reasoning: `This is the kind of result that breaks up the public same-game multi script.`,
    },
    {
      category: "bookieFear",
      title: `Public pain builder`,
      legs: [
        { pick: `${input.winnerName} to win`, decimalOdds: winnerPrice },
        { pick: `${anytimeA.name} anytime tryscorer`, decimalOdds: anytimeA.price },
        { pick: `${anytimeB.name} anytime tryscorer`, decimalOdds: anytimeB.price },
      ],
      combinedOdds: 1,
      estimatedOdds: "$0.00",
      stake: "$10",
      potentialReturn: "$0.00",
      reasoning: `This is the obvious public route: favourite result plus the two cleanest try names.`,
    },
    {
      category: "anytime",
      title: `Anytime tryscorer stack`,
      legs: [
        { pick: `${anytimeA.name} anytime tryscorer`, decimalOdds: anytimeA.price },
        { pick: `${anytimeB.name} anytime tryscorer`, decimalOdds: anytimeB.price },
        { pick: `${anytimeC.name} anytime tryscorer`, decimalOdds: anytimeC.price },
        { pick: `${anytimeD.name} anytime tryscorer`, decimalOdds: anytimeD.price },
      ],
      combinedOdds: 1,
      estimatedOdds: "$0.00",
      stake: "$10",
      potentialReturn: "$0.00",
      reasoning: `It spreads exposure across the best finishing lanes on both sides rather than needing a perfect margin read.`,
    },
    {
      category: "firstTryscorer",
      title: `${input.firstTryName} first try`,
      legs: [{ pick: `${input.firstTryName} first tryscorer`, decimalOdds: input.firstTryPrice }],
      combinedOdds: 1,
      estimatedOdds: "$0.00",
      stake: "$5",
      potentialReturn: "$0.00",
      reasoning: `The early-script angle points to this edge being the first clean strike chance of the night.`,
    },
  ];
}

function buildTryscorerTeamBlock(team: string, players: RankedPlayer[], opponent: string) {
  const picks = players.slice(0, 4).map((p, index) => {
    const market: "first" | "2+" | "anytime" = p.prices.first != null && index === 0
      ? "first"
      : p.prices.multi != null && index === 1
        ? "2+"
        : "anytime";

    return {
      name: playerName(p, team),
      market,
      price: market === "first" ? p.prices.first : market === "2+" ? p.prices.multi : p.prices.anytime,
      reasoning: `${playerName(p, team)} sits in a live ${p.position.toLowerCase()} scoring lane against ${opponent}'s likely edge and kick-pressure issues.`,
    };
  });

  const avoid = players.slice(-2).map((p) => ({
    name: playerName(p, team),
    reasoning: `${playerName(p, team)} projects to need low-percentage touches rather than volume chances in this script.`,
  }));

  return { picks, avoid };
}

function buildWeaknessExploit(
  team: string,
  opponent: string,
  players: RankedPlayer[],
  wetWeather: boolean,
  side: "home" | "away" = "home",
  teamForm = 0,
  oppForm = 0,
  teamPos?: number | string,
  oppPos?: number | string,
) {
  const watch = players.slice(0, 3);
  const isFavoured = teamForm >= oppForm;
  const ladderEdge = (Number(teamPos) || 99) < (Number(oppPos) || 99);
  const star = playerName(players[0], team);
  const second = playerName(players[1], team);

  // Vary opening pressure point per side so the two cards never read the same.
  const edgeFocus = side === "home"
    ? `${opponent}'s right edge has been the soft channel — slow to slide on second-phase ball after fatigue sets in`
    : `${opponent}'s left-edge defence is over-committing on first-receiver runs and leaving outside backs isolated`;
  const middleFocus = side === "home"
    ? `${opponent}'s ruck speed drops noticeably in the third quarter, opening windows for shape plays`
    : `${opponent}'s middle defenders are conceding metres post-contact, especially against forwards on second-man plays`;
  const kickFocus = wetWeather
    ? `${opponent}'s back three have wobbled under contestable kicks in greasy conditions`
    : side === "home"
      ? `${opponent}'s yardage exits are leaking under high-ball pressure on the right`
      : `${opponent}'s left winger has been targeted on bombs and short kick-chases`;

  const targetAreas = side === "home"
    ? ["Right-edge 20m channel after repeat sets", "Inside ball off quick play-the-balls", wetWeather ? "Grubbers in-goal under pressure" : "Bomb chase on right wing"]
    : ["Left-edge short side from scrum", "Forward shape off second-man play", wetWeather ? "Boot the back three early" : "Cross-field kick to left winger"];

  const tacticalPlan = isFavoured
    ? `${team} should weaponise field position with ${star} pulling the strings — milk repeat sets, then unload ${side === "home" ? "right-edge shape" : "left-edge raids"} once ${opponent}'s middle starts retreating. ${ladderEdge ? "Ladder pressure is on the visitors' side, so " + team + " can afford to be patient and play the long script." : "Lean on " + second + " to break the line in the third quarter when " + opponent + "'s defensive read slows."}`
    : `${team} need to flip the script early — front-load energy through ${star} carries and force ${opponent} into messy completions before ${opponent}'s structure settles. ${wetWeather ? "Conditions help an underdog: complete high, kick long and live in their half." : "Use " + second + " on early-shift ball to test " + opponent + "'s edge connection before they get into rhythm."}`;

  return {
    opponentWeaknesses: [edgeFocus, middleFocus, kickFocus],
    targetAreas,
    tacticalPlan,
    playersToWatch: watch.map((p, i) => ({
      name: playerName(p, team),
      role: p.position,
      why: i === 0
        ? `${playerName(p, team)} is the lead playmaker for ${team} and the most likely to convert ${opponent}'s lapses into direct points.`
        : i === 1
          ? `${playerName(p, team)} should get high volume off shape and matches up well against ${opponent}'s read-defence issues.`
          : `${playerName(p, team)} adds late-set finishing power and is a live tryscoring option once ${opponent}'s edge fatigues.`,
    })),
  };
}

function buildKeysToVictory(team: string, opponent: string, players: RankedPlayer[], wetWeather: boolean): string[] {
  return [
    `Win the kick-and-chase cycle so ${opponent} are starting too many sets inside their own half.`,
    `Feed ${playerName(players[0], team)} with early touches on shape rather than chasing miracle offloads.`,
    wetWeather ? `Respect the conditions: complete high, kick long and make ${opponent} work out of bad ball.` : `Turn pressure into repeat sets instead of overplaying the offload once ${opponent} bend.`,
  ];
}

type RankedPlayer = {
  firstName: string;
  lastName: string;
  position: string;
  isCaptain?: boolean;
  prices: { first: number | null; anytime: number | null; multi: number | null };
  score: number;
};

function rankAttackers(
  squad: { firstName: string; lastName: string; position: string; isCaptain?: boolean }[],
  priceMap: Map<string, { first: number | null; anytime: number | null; multi: number | null }>,
): RankedPlayer[] {
  const weights: Record<string, number> = {
    Fullback: 92,
    Winger: 95,
    Centre: 82,
    "Five-Eighth": 74,
    Halfback: 71,
    Hooker: 58,
    Prop: 42,
    "2nd Row": 76,
    Lock: 68,
    Interchange: 34,
    Reserve: 20,
  };

  return squad
    .map((p) => {
      const prices = priceMap.get(normName(`${p.firstName} ${p.lastName}`)) ?? { first: null, anytime: null, multi: null };
      const priceBoost = prices.anytime ? Math.max(0, 20 - prices.anytime * 3) : 0;
      const multiBoost = prices.multi ? Math.max(0, 12 - prices.multi) : 0;
      return {
        ...p,
        prices,
        score: (weights[p.position] ?? 40) + priceBoost + multiBoost + (p.isCaptain ? 2 : 0),
      };
    })
    .sort((a, b) => b.score - a.score);
}

function padPlayers(players: RankedPlayer[], team: string): RankedPlayer[] {
  if (players.length >= 4) return players;
  const padded = [...players];
  while (padded.length < 4) {
    padded.push({
      firstName: team,
      lastName: `Edge ${padded.length + 1}`,
      position: "Back",
      prices: { first: null, anytime: null, multi: null },
      score: 0,
    });
  }
  return padded;
}

function buildPriceLookup(realOdds: RealOdds | undefined) {
  const map = new Map<string, { first: number | null; anytime: number | null; multi: number | null }>();
  if (!realOdds) return map;

  for (const p of realOdds.tryscorers.first) {
    const key = normName(p.player);
    map.set(key, { ...(map.get(key) ?? { first: null, anytime: null, multi: null }), first: p.price });
  }
  for (const p of realOdds.tryscorers.anytime) {
    const key = normName(p.player);
    map.set(key, { ...(map.get(key) ?? { first: null, anytime: null, multi: null }), anytime: p.price });
  }
  for (const p of realOdds.tryscorers.multi) {
    const key = normName(p.player);
    map.set(key, { ...(map.get(key) ?? { first: null, anytime: null, multi: null }), multi: p.price });
  }
  return map;
}

function playerName(player: Pick<RankedPlayer, "firstName" | "lastName"> | undefined, fallbackTeam: string) {
  if (!player) return fallbackTeam;
  return `${player.firstName} ${player.lastName}`.trim();
}

function normName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function recentFormScore(form: { result: string }[]) {
  return form.slice(0, 5).reduce((acc, item) => {
    const result = (item.result ?? "").toLowerCase();
    if (result.startsWith("w")) return acc + 1.2;
    if (result.startsWith("d")) return acc + 0.4;
    if (result.startsWith("l")) return acc - 1;
    return acc;
  }, 0);
}

function teamRating(
  row: { played: number; for: number; against: number; diff: number; points: number } | undefined,
  formScore: number,
  h2hPrice: number | undefined,
  homeAdvantage: boolean,
) {
  const played = Math.max(1, row?.played ?? 1);
  const attack = (row?.for ?? 20 * played) / played;
  const defence = (row?.against ?? 20 * played) / played;
  const diffBoost = (row?.diff ?? 0) / played;
  const marketBoost = h2hPrice ? (2.6 - Math.min(h2hPrice, 4.5)) * 1.8 : 0;
  return attack * 0.22 - defence * 0.16 + diffBoost * 0.18 + formScore * 1.5 + marketBoost + (homeAdvantage ? 2.4 : 0);
}

function projectScore(
  row: { played: number; for: number; against: number } | undefined,
  opp: { played: number; for: number; against: number } | undefined,
  formScore: number,
  homeAdvantage: boolean,
  wetWeather: boolean,
  windy: boolean,
) {
  const played = Math.max(1, row?.played ?? 1);
  const oppPlayed = Math.max(1, opp?.played ?? 1);
  const attack = (row?.for ?? 22 * played) / played;
  const oppDefence = (opp?.against ?? 22 * oppPlayed) / oppPlayed;
  const weatherDrop = wetWeather ? 3.5 : 0;
  const windDrop = windy ? 1.5 : 0;
  return clamp(Math.round(((attack + oppDefence) / 2) + formScore + (homeAdvantage ? 1.5 : 0) - weatherDrop - windDrop), 8, 36);
}

function formTag(score: number) {
  if (score >= 2.5) return "sharp";
  if (score >= 0.5) return "steady";
  if (score <= -2) return "under pressure";
  return "patchy";
}

function estimateAnytimeOdds(index: number) {
  return [1.95, 2.25, 2.75, 3.1][index] ?? 3.4;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

// After the AI returns, walk every leg and replace estimated odds with the
// real bookie price whenever the pick can be matched. This guarantees what
// users see lines up with TAB / Sportsbet within the same ballpark.
function applyRealOdds(ins: Insights, realOdds: RealOdds | undefined, home: string, away: string): Insights {
  if (!realOdds) return ins;

  const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const tryMap = new Map<string, { first?: number; anytime?: number; multi?: number }>();
  for (const p of realOdds.tryscorers.first) {
    const k = norm(p.player); tryMap.set(k, { ...(tryMap.get(k) ?? {}), first: p.price });
  }
  for (const p of realOdds.tryscorers.anytime) {
    const k = norm(p.player); tryMap.set(k, { ...(tryMap.get(k) ?? {}), anytime: p.price });
  }
  for (const p of realOdds.tryscorers.multi) {
    const k = norm(p.player); tryMap.set(k, { ...(tryMap.get(k) ?? {}), multi: p.price });
  }

  const homeKey = norm(home);
  const awayKey = norm(away);
  const h2hHome = realOdds.h2h.home?.price;
  const h2hAway = realOdds.h2h.away?.price;
  const bestTotal = realOdds.totals[0];

  const lookup = (pickRaw: unknown): number | null => {
    const pick = norm(pickRaw);
    if (!pick) return null;

    // h2h winner
    if (/\b(to win|win( the match)?|h2h|head to head|moneyline)\b/.test(pick) || /^[a-z ]+ win$/i.test(pick.trim())) {
      if (pick.includes(homeKey) && h2hHome) return h2hHome;
      if (pick.includes(awayKey) && h2hAway) return h2hAway;
    }

    // total points
    if (bestTotal && (pick.includes("over") || pick.includes("under"))) {
      const m = pick.match(/(\d+(?:\.\d+)?)/);
      if (m) {
        const line = Number(m[1]);
        if (Math.abs(line - bestTotal.line) <= 1) {
          return pick.includes("over") ? bestTotal.over : bestTotal.under;
        }
      }
    }

    // tryscorer markets — find the player name inside the pick
    const isFirst = /\bfirst tryscorer|\bfirst try|\bfts\b/.test(pick);
    const isMulti = /\b2\+|\bdouble\b|\bhat[- ]?trick\b|\b3\+|\bmulti/.test(pick);
    const isAnytime = /\banytime|\bats\b|\bto score (a try|anytime)/.test(pick) || (!isFirst && !isMulti && /tryscorer|try$/i.test(pick));

    for (const [name, prices] of tryMap) {
      if (pick.includes(name) || pick.includes(name.split(" ").slice(-1)[0])) {
        if (isFirst && prices.first) return prices.first;
        if (isMulti && prices.multi) return prices.multi;
        if (isAnytime && prices.anytime) return prices.anytime;
        // fallback: pick whichever exists if market type unclear
        if (prices.anytime) return prices.anytime;
        if (prices.first) return prices.first;
        if (prices.multi) return prices.multi;
      }
    }
    return null;
  };

  const fixLegs = (legs: BetLeg[]): BetLeg[] =>
    (legs ?? []).map((l) => {
      const safePick = String(l?.pick ?? "");
      const safeOdds = Math.max(1.01, Number(l?.decimalOdds) || 1.01);
      const real = lookup(safePick);
      return { pick: safePick, decimalOdds: real ?? safeOdds };
    });

  if (Array.isArray(ins.bets)) {
    ins.bets = ins.bets.map((b) => ({ ...b, legs: fixLegs(b.legs) }));
  }
  return ins;
}


async function callGateway(
  key: string,
  model: string,
  messages: any[],
  toolDef: any,
  timeoutMs: number,
): Promise<Insights> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(GATEWAY, {
      method: "POST",
      signal: ac.signal,
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        messages,
        tools: [toolDef],
        tool_choice: { type: "function", function: { name: "emit_insights" } },
      }),
    });
  } catch (e) {
    clearTimeout(t);
    if (ac.signal.aborted) throw new Error(`AI insights timed out after ${timeoutMs / 1000}s on ${model}`);
    throw e;
  }
  clearTimeout(t);

  if (res.status === 429) throw new Error("AI rate limit exceeded; try again shortly");
  if (res.status === 402) throw new Error("AI credits exhausted; add credits in Settings → Workspace → Usage");
  if (!res.ok) throw new Error(`AI gateway HTTP ${res.status} on ${model}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json() as any;
  const choice = data.choices?.[0];
  const call = choice?.message?.tool_calls?.[0];
  const argStr = call?.function?.arguments;
  if (!argStr) {
    const finish = choice?.finish_reason || choice?.native_finish_reason || "unknown";
    console.error(`AI insights: no tool_call from ${model}`, { finish, content: choice?.message?.content?.slice(0, 300) });
    throw new Error(`no structured output from ${model} (finish: ${finish})`);
  }
  return parseInsightsFromToolArgs(argStr, model);
}

function buildToolDef() {
  return {
    type: "function",
    function: {
      name: "emit_insights",
      description: "Return structured NRL match insights inside one JSON string field named payload.",
      parameters: {
        type: "object",
        properties: {
          payload: {
            type: "string",
            description: "A raw JSON string for the FULL insights object requested in the prompt. No markdown fences. The JSON inside payload must include: predictedScore, winner, margin, total, htft, firstTryscorer, anytimeTryscorers, multiTryscorer, keysToVictory, keyFactors, weaknessExploit, bets, gameFlow, tryscorerScript, and script."
          },
        },
        required: ["payload"],
        additionalProperties: false,
      },
    },
  };
}

function parseInsightsFromToolArgs(argStr: string, model: string): Insights {
  const stripCodeFences = (value: string) => value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    const parsedArgs = JSON.parse(argStr) as { payload?: unknown } | Insights;

    if (parsedArgs && typeof parsedArgs === "object" && "payload" in parsedArgs && typeof parsedArgs.payload === "string") {
      return JSON.parse(stripCodeFences(parsedArgs.payload)) as Insights;
    }

    return parsedArgs as Insights;
  } catch (e) {
    console.error(`AI insights: JSON.parse failed on ${model}`, { len: argStr.length, tail: argStr.slice(-200) });
    throw new Error(`malformed JSON from ${model}`);
  }
}

// Recompute combinedOdds = product(legs) and potentialReturn = stake × combinedOdds.
// Guards against AI arithmetic mistakes — what we render always adds up.
function normaliseBetMath(ins: Insights): Insights {
  const parseStake = (s: unknown) => Number(String(s ?? "").replace(/[^0-9.]/g, "")) || 0;
  const fmtOdds = (n: number) => `$${n.toFixed(2)}`;
  const fmtMoney = (n: number) => {
    if (n >= 1000) return `$${Math.round(n).toLocaleString("en-AU")}`;
    return `$${n.toFixed(2)}`;
  };

  const fixMulti = <T extends { legs: BetLeg[]; stake: string; combinedOdds?: number }>(b: T) => {
    const legs = (b.legs || []).map((l) => ({
      pick: String(l.pick || ""),
      decimalOdds: Math.max(1.01, Number(l.decimalOdds) || 1.01),
    }));
    const combined = legs.reduce((acc, l) => acc * l.decimalOdds, 1);
    const stakeNum = parseStake(b.stake);
    const ret = stakeNum * combined;
    return { ...b, legs, combinedOdds: combined, _return: ret };
  };

  const defaultStakes: Partial<Record<BetCategoryKey, string>> = {
    gameScript: "$10",
    lowRisk: "$5",
    mediumRisk: "$5",
    highRisk: "$5",
    getThea: "$5",
    upset: "$20",
    bookieWant: "$10",
    bookieFear: "$10",
    anytime: "$10",
    firstTryscorer: "$5",
  };
  const betOrder: BetCategoryKey[] = [
    "gameScript",
    "lowRisk",
    "mediumRisk",
    "highRisk",
    "getThea",
    "upset",
    "bookieWant",
    "bookieFear",
    "anytime",
    "firstTryscorer",
  ];

  if (Array.isArray(ins.bets)) {
    ins.bets = ins.bets.map((b, index) => {
      const cat = betOrder.includes(b?.category as BetCategoryKey)
        ? b.category as BetCategoryKey
        : betOrder[index] ?? "lowRisk";
      const stake = b.stake || defaultStakes[cat] || "$5";
      const fixed = fixMulti({ ...b, stake });
      return {
        category: cat,
        title: b.title || "",
        reasoning: b.reasoning || "",
        legs: fixed.legs,
        combinedOdds: fixed.combinedOdds,
        estimatedOdds: fmtOdds(fixed.combinedOdds),
        stake,
        potentialReturn: fmtMoney(fixed._return),
      };
    });
  }

  return ins;
}
