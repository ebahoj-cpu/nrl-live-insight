// AI-generated betting insights via Lovable AI Gateway.
// Uses tool-calling for structured output. Receives ONLY real data summaries.

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-pro";
const FALLBACK_MODEL = "google/gemini-2.5-flash";
const TIMEOUT_MS = 90_000; // pro model with large schema needs more headroom

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
// Each bet has 1-5 legs with real prices, server-computed math, and a "why".
export type BetPlay = {
  title: string;            // headline e.g. "Storm win + Munster anytime + 13+ margin"
  legs: BetLeg[];           // 1-5 legs with real bookie prices
  combinedOdds: number;     // server-recomputed product of leg odds
  estimatedOdds: string;    // formatted "$5.00"
  stake: string;            // "$5", "$20", etc.
  potentialReturn: string;  // server-recomputed stake × combinedOdds
  reasoning: string;        // 2-3 sentences citing stats, lineups, script, form
};

export type BetCategoryKey =
  | "gameScript"      // aligns with stats: winner + margin + total + HT/FT + 2 tryscorers
  | "lowRisk"         // ~$100 return on $5 stake (~20x)
  | "mediumRisk"      // ~$500 return on $5 stake (~100x)
  | "highRisk"        // ~$1,000 return on $5 stake (~200x)
  | "getThea"         // ~$10,000 return on $5 stake (~2000x)
  | "upset"           // against the market — underdog wins
  | "bookieWant"      // result the bookies WANT to land (low liability)
  | "bookieFear"      // result the bookies FEAR (heavy public exposure)
  | "anytime"         // pure anytime tryscorer multi
  | "firstTryscorer"; // standalone single first-tryscorer bet

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
  bets: Record<BetCategoryKey, BetPlay>;
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
    `Provide a sharp, complete NRL betting analysis covering: winner, margin, HT/FT double, total points, first/anytime tryscorers, and multi-tryscorer angles. Also produce 3 specific "keys to victory" for EACH team (concrete tactical/structural points referencing real squad players, recent form, opposition weakness, or weather/ground impact).

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


ALSO produce a "weaknessExploit" for EACH team. For each side identify:
- opponentWeaknesses: an array of EXACTLY 3 distinct, specific defensive flaws in the OPPOSITION based on recent form / known matchup data. Each one a concrete short phrase, e.g. "Right-edge defence leaking tries — missed tackle % at left centre", "Ruck speed drops sharply in second half", "Vulnerable under high bombs on left wing", "Slow line-speed against shape plays from scrum".
- targetAreas: an array of 1-3 specific channels / phases / parts of the field to attack — e.g. "Right edge 20m channel", "Inside ball off the ruck", "Bomb contests on the left wing", "Short side from scrum".
- tacticalPlan: 2-3 sentences on HOW this team weaponises those weaknesses — shape, ball-runners, kicking game, set-piece.
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
    { role: "system", content: "You are a professional NRL analyst and betting tipster. Use only the data provided. Never invent stats, players, or odds. When real bookie odds are provided for a market, quote them EXACTLY — do not estimate. You MUST respond by calling the emit_insights tool with ALL required fields. Be concise in prose fields to stay within token limits." },
    { role: "user", content: prompt },
  ];

  // Try pro model first; on timeout / no-tool-call / 5xx, fall back to flash.
  try {
    const parsed = await callGateway(key, MODEL, messages, toolDef, TIMEOUT_MS);
    return normaliseBetMath(applyRealOdds(parsed, payload.realOdds, payload.homeName, payload.awayName));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`AI insights: primary model ${MODEL} failed (${msg}); falling back to ${FALLBACK_MODEL}`);
    const parsed = await callGateway(key, FALLBACK_MODEL, messages, toolDef, 35_000);
    return normaliseBetMath(applyRealOdds(parsed, payload.realOdds, payload.homeName, payload.awayName));
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

// After the AI returns, walk every leg and replace estimated odds with the
// real bookie price whenever the pick can be matched. This guarantees what
// users see lines up with TAB / Sportsbet within the same ballpark.
function applyRealOdds(ins: Insights, realOdds: RealOdds | undefined, home: string, away: string): Insights {
  if (!realOdds) return ins;

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
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

  const lookup = (pickRaw: string): number | null => {
    const pick = norm(pickRaw);

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
      const real = lookup(l.pick);
      return real ? { ...l, decimalOdds: real } : l;
    });

  if (ins.bets && typeof ins.bets === "object") {
    const fixed: Record<string, BetPlay> = {};
    for (const [k, b] of Object.entries(ins.bets)) {
      if (!b) continue;
      fixed[k] = { ...(b as BetPlay), legs: fixLegs((b as BetPlay).legs) };
    }
    ins.bets = fixed as Insights["bets"];
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
  try {
    return JSON.parse(argStr) as Insights;
  } catch (e) {
    console.error(`AI insights: JSON.parse failed on ${model}`, { len: argStr.length, tail: argStr.slice(-200) });
    throw new Error(`malformed JSON from ${model}`);
  }
}

function buildToolDef() {
  return {
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
                  opponentWeaknesses: {
                    type: "array", minItems: 3, maxItems: 3,
                    items: { type: "string", description: "Specific defensive flaw in the AWAY team — short concrete phrase" },
                  },
                  targetAreas: {
                    type: "array", minItems: 1, maxItems: 3,
                    items: { type: "string", description: "Channel / phase / part of the field to attack" },
                  },
                  tacticalPlan: { type: "string", description: "2-3 sentences on how to weaponise the weaknesses" },
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
                required: ["opponentWeaknesses", "targetAreas", "tacticalPlan", "playersToWatch"], additionalProperties: false,
              },
              away: {
                type: "object",
                properties: {
                  opponentWeaknesses: {
                    type: "array", minItems: 3, maxItems: 3,
                    items: { type: "string", description: "Specific defensive flaw in the HOME team — short concrete phrase" },
                  },
                  targetAreas: {
                    type: "array", minItems: 1, maxItems: 3,
                    items: { type: "string" },
                  },
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
                required: ["opponentWeaknesses", "targetAreas", "tacticalPlan", "playersToWatch"], additionalProperties: false,
              },
            },
            required: ["home", "away"], additionalProperties: false,
          },
          bets: {
            type: "array",
            description: "Exactly TEN bet plays — one per category — every one in the same shape so the UI renders identical cards. Reasoning must align with the rest of the analysis.",
            minItems: 10, maxItems: 10,
            items: {
              type: "object",
              properties: {
                category: {
                  type: "string",
                  enum: ["gameScript","lowRisk","mediumRisk","highRisk","getThea","upset","bookieWant","bookieFear","anytime","firstTryscorer"],
                  description: "Which category this bet fills. Each category MUST appear exactly once. Sizing rules: gameScript=4-6 legs (aligned multi, $10 stake); lowRisk=2-3 legs (~$100 from $5); mediumRisk=3-4 legs (~$500 from $5); highRisk=4-5 legs (~$1,000 from $5); getThea=4-5 long legs (~$10,000 from $5); upset=1 leg ('<underdog> to win' at real h2h price, $20 stake); bookieWant=1-2 legs aligned with bookieScript.wantToWin ($10); bookieFear=2-3 legs leaning into bookieScript.wantToLose ($10); anytime=3-4 anytime-tryscorer legs ($10); firstTryscorer=1 leg '<player> first tryscorer' ($5).",
                },
                title: { type: "string", description: "Short headline. NEVER use handicap markets like 'Roosters -12.5'." },
                legs: {
                  type: "array",
                  minItems: 1, maxItems: 6,
                  items: {
                    type: "object",
                    properties: {
                      pick: { type: "string", description: "One leg. Allowed: head-to-head winner, margin BUCKETS ('1-12', '13+', '1-6', '7-12', '13-24', '25+'), total over/under, HT/FT, anytime/first tryscorer, try-count buckets ('1-2 tries', '3+ tries'). NEVER handicap/spread/line. NEVER 'over 0.5 tries'." },
                      decimalOdds: { type: "number", description: "Decimal odds — quote LIVE BOOKIE ODDS exactly when the leg matches." },
                    },
                    required: ["pick", "decimalOdds"], additionalProperties: false,
                  },
                },
                combinedOdds: { type: "number", description: "Product of all leg decimalOdds." },
                stake: { type: "string", description: "Suggested stake string e.g. '$5'." },
                reasoning: { type: "string", description: "2-3 sentences citing stats / lineups / form / weakness exploit / X-factor — why this bet aligns with the rest of the analysis." },
              },
              required: ["category", "title", "legs", "combinedOdds", "stake", "reasoning"],
              additionalProperties: false,
            },
          },
          gameFlow: {
            type: "object",
            description: "Quarter-by-quarter script: how the game likely unfolds with HT score, momentum swings and HT/FT double pick.",
            properties: {
              openingTen: { type: "string", description: "1-2 sentences on the first 10 minutes — who starts hot, early field position." },
              firstHalf: { type: "string", description: "2-3 sentences on how the first 40 plays out." },
              halftimeScore: {
                type: "object",
                properties: { home: { type: "number" }, away: { type: "number" } },
                required: ["home", "away"], additionalProperties: false,
              },
              halftimeLeader: { type: "string", enum: ["home", "away", "draw"] },
              secondHalf: { type: "string", description: "2-3 sentences on the second 40." },
              momentumSwings: {
                type: "array", minItems: 2, maxItems: 4,
                items: { type: "string", description: "Time-stamped swing e.g. '10-20min: Storm grab early lead'." },
              },
              halftimeDouble: {
                type: "object",
                properties: {
                  pick: { type: "string", description: "HT/FT pick e.g. 'Storm / Storm' or 'Draw / Storm'." },
                  reasoning: { type: "string" },
                  confidence: { type: "number", minimum: 0, maximum: 100 },
                },
                required: ["pick", "reasoning", "confidence"], additionalProperties: false,
              },
              closing: { type: "string", description: "1-2 sentences on the final 10." },
            },
            required: ["openingTen", "firstHalf", "halftimeScore", "halftimeLeader", "secondHalf", "momentumSwings", "halftimeDouble", "closing"],
            additionalProperties: false,
          },
          tryscorerScript: {
            type: "object",
            description: "Tryscoring script — 3-4 picks per team with real prices when available, plus 1-2 trap players to avoid.",
            properties: {
              home: {
                type: "object",
                properties: {
                  picks: {
                    type: "array", minItems: 3, maxItems: 4,
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string", description: "Named home squad player." },
                        market: { type: "string", enum: ["first", "anytime", "2+"] },
                        price: { type: ["number", "null"], description: "Exact price from LIVE BOOKIE ODDS, else null." },
                        reasoning: { type: "string", description: "1-2 sentences on form, matchup, role." },
                      },
                      required: ["name", "market", "price", "reasoning"], additionalProperties: false,
                    },
                  },
                  avoid: {
                    type: "array", minItems: 1, maxItems: 2,
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        reasoning: { type: "string", description: "Why fade this name this week — 1 sentence." },
                      },
                      required: ["name", "reasoning"], additionalProperties: false,
                    },
                  },
                },
                required: ["picks", "avoid"], additionalProperties: false,
              },
              away: {
                type: "object",
                properties: {
                  picks: {
                    type: "array", minItems: 3, maxItems: 4,
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string", description: "Named away squad player." },
                        market: { type: "string", enum: ["first", "anytime", "2+"] },
                        price: { type: ["number", "null"] },
                        reasoning: { type: "string" },
                      },
                      required: ["name", "market", "price", "reasoning"], additionalProperties: false,
                    },
                  },
                  avoid: {
                    type: "array", minItems: 1, maxItems: 2,
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        reasoning: { type: "string" },
                      },
                      required: ["name", "reasoning"], additionalProperties: false,
                    },
                  },
                },
                required: ["picks", "avoid"], additionalProperties: false,
              },
              summary: { type: "string", description: "2-3 sentences on the overall tryscoring picture." },
            },
            required: ["home", "away", "summary"], additionalProperties: false,
          },
          script: {
            type: "object",
            properties: {
              headToHead: { type: "string", description: "3-5 sentences: recent H2H meetings, score trends, venue history at this ground, who has owned the rivalry, tactical patterns deciding recent matchups." },
              formAnalysis: { type: "string", description: "3-5 sentences: last-5 trajectories, attack vs defence, points-for/against trend, quality of opposition, whether form is real or schedule-inflated." },
              xFactor: { type: "string", description: "Single biggest swing variable — one player, matchup, or tactical lever — and what tips the game when it fires." },
              psychological: { type: "string", description: "4-6 sentences covering ladder positioning pressure, occasion, expected sell-out / crowd, recent emotional peaks, home vs away mentality, and stadium voodoo / hoodoos." },
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
              matchFix: {
                type: "object",
                description: "Tongue-in-cheek 'how the NRL would script this for ratings/money' read. Satirical, never an actual accusation.",
                properties: {
                  preferredWinner: { type: "string", description: "Which side V'landys / the broadcast would quietly prefer to win, with the commercial reason." },
                  ratingsAngle: { type: "string", description: "2-3 sentences on the broadcast's dream script tied to ratings." },
                  refereeNudges: {
                    type: "array", minItems: 3, maxItems: 5,
                    items: { type: "string", description: "Cheeky bullet on the 'lean' — penalty count, captain's challenge, bunker, six-again, late obstruction call." },
                  },
                  narrativeMoment: { type: "string", description: "The single storyline the NRL is engineering." },
                  conspiracyRating: { type: "number", minimum: 0, maximum: 100, description: "0-100 'how scripted does this feel?' meter." },
                },
                required: ["preferredWinner", "ratingsAngle", "refereeNudges", "narrativeMoment", "conspiracyRating"],
                additionalProperties: false,
              },
            },
            required: ["headToHead", "formAnalysis", "xFactor", "psychological", "milestones", "bookieScript", "matchFix"], additionalProperties: false,
          },
        },
        required: [
          "predictedScore","winner","margin","total","htft",
          "firstTryscorer","anytimeTryscorers","multiTryscorer",
          "keysToVictory","keyFactors","weaknessExploit","bets",
          "gameFlow","tryscorerScript","script",
        ],
        additionalProperties: false,
      },
    },
  };
}

// Recompute combinedOdds = product(legs) and potentialReturn = stake × combinedOdds.
// Guards against AI arithmetic mistakes — what we render always adds up.
function normaliseBetMath(ins: Insights): Insights {
  const parseStake = (s: string) => Number((s || "").replace(/[^0-9.]/g, "")) || 0;
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

  if (ins.bets && typeof ins.bets === "object") {
    const out: Record<string, BetPlay> = {};
    for (const [k, b] of Object.entries(ins.bets)) {
      if (!b) continue;
      const stake = (b as BetPlay).stake || defaultStakes[k as BetCategoryKey] || "$5";
      const fixed = fixMulti({ ...(b as BetPlay), stake });
      out[k] = {
        title: (b as BetPlay).title || "",
        reasoning: (b as BetPlay).reasoning || "",
        legs: fixed.legs,
        combinedOdds: fixed.combinedOdds,
        estimatedOdds: fmtOdds(fixed.combinedOdds),
        stake,
        potentialReturn: fmtMoney(fixed._return),
      };
    }
    ins.bets = out as Insights["bets"];
  }

  return ins;
}
