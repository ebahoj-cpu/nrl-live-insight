// ============================================================================
// Scout session memory.
//
// Stores news-injection modifiers per chat session, in-process only. Modifiers
// are scoped, capped, and TTL'd; they NEVER persist to the database.
//
// The session id is derived deterministically from the first user message in a
// chat history so the same conversation hits the same memory bucket without
// the UI having to send a session id (the existing scout.tsx UI doesn't pass
// one, and we don't change the UI for this rebuild).
// ============================================================================

import { createHash } from "node:crypto";
import type { ScoutChatMessage } from "./scout-contracts";
import { NewsModifierSchema, type NewsModifier } from "./scout-contracts";

const MAX_MODIFIERS_PER_SESSION = 12;
const SESSION_TTL_MS = 30 * 60_000;
const MAX_SESSIONS = 500;

type Bucket = {
  modifiers: NewsModifier[];
  expiresAt: number;
};

const buckets = new Map<string, Bucket>();

function gc(now: number): void {
  if (buckets.size <= MAX_SESSIONS) {
    for (const [k, v] of buckets) if (v.expiresAt <= now) buckets.delete(k);
    return;
  }
  // Hard cap — drop oldest first.
  const entries = [...buckets.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  for (let i = 0; i < entries.length - MAX_SESSIONS; i++) buckets.delete(entries[i][0]);
}

export function deriveSessionId(messages: ScoutChatMessage[]): string {
  const first = messages.find((m) => m.role === "user")?.content ?? "";
  // First user message + count is enough to keep injections sticky for the
  // life of the conversation without crossing into other users' threads.
  const seed = `${first.slice(0, 200)}::${messages.length > 0 ? "v1" : "empty"}`;
  return createHash("sha1").update(seed).digest("hex").slice(0, 16);
}

export function getActiveModifiers(sessionId: string, matchId?: string): NewsModifier[] {
  const now = Date.now();
  const b = buckets.get(sessionId);
  if (!b || b.expiresAt <= now) {
    if (b) buckets.delete(sessionId);
    return [];
  }
  return matchId
    ? b.modifiers.filter((m) => !m.matchId || m.matchId === matchId)
    : [...b.modifiers];
}

export function pushModifier(sessionId: string, mod: NewsModifier): NewsModifier {
  const parsed = NewsModifierSchema.parse(mod);
  const now = Date.now();
  gc(now);
  const b = buckets.get(sessionId) ?? { modifiers: [], expiresAt: now + SESSION_TTL_MS };
  // Dedupe by id; keep newest.
  b.modifiers = [...b.modifiers.filter((m) => m.id !== parsed.id), parsed].slice(-MAX_MODIFIERS_PER_SESSION);
  b.expiresAt = now + SESSION_TTL_MS;
  buckets.set(sessionId, b);
  return parsed;
}

export function clearSession(sessionId: string): void {
  buckets.delete(sessionId);
}

// Test hook — never call from app code.
export function __resetScoutMemoryForTests(): void {
  buckets.clear();
}
