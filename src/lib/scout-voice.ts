// Scout Voice Manager — free Web Speech API only.
// Handles voice discovery, scoring, preference storage, chunked speech with
// natural pauses, and cross-browser quirks (Android Chrome, Samsung Internet,
// iOS Safari).

export type ScoutVoicePrefs = {
  voiceURI: string | null; // null = auto
  rate: number;            // 0.5 - 1.5
  pitch: number;           // 0.5 - 1.5
};

const PREFS_KEY = "scout.voice.prefs.v1";

export const DEFAULT_PREFS: ScoutVoicePrefs = {
  voiceURI: null,
  rate: 0.97,   // calm, slightly measured analyst pace
  pitch: 0.92,  // slightly deeper than default
};

// Preferred named voices in priority order.
const PREFERRED_NAMES = [
  "Google UK English Male",
  "Google UK English Female",
  "Microsoft Ryan",
  "Microsoft Sonia",
  "Microsoft Natasha",
  "Samantha",
  "Daniel",
];

// Known broken/robotic voices to suppress in auto-pick.
const BLOCKED_NAME_FRAGMENTS = [
  "espeak", "pico", "compact", "eloquence", "fred",
  "albert", "bad news", "good news", "bahh", "bells",
  "boing", "bubbles", "cellos", "deranged", "hysterical",
  "junior", "kathy", "organ", "ralph", "trinoids",
  "whisper", "wobble", "zarvox", "novelty",
];

export function speechSynthAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

// getVoices() is asynchronous in most browsers — wait for the list to populate.
export function loadVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  if (!speechSynthAvailable()) return Promise.resolve([]);
  const synth = window.speechSynthesis;
  const immediate = synth.getVoices();
  if (immediate && immediate.length) return Promise.resolve(immediate);

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      synth.removeEventListener?.("voiceschanged", finish as EventListener);
      resolve(synth.getVoices() || []);
    };
    synth.addEventListener?.("voiceschanged", finish as EventListener);
    // Fallback poll for Safari/iOS which sometimes never fires the event.
    const start = Date.now();
    const tick = () => {
      if (done) return;
      const list = synth.getVoices();
      if (list && list.length) return finish();
      if (Date.now() - start > timeoutMs) return finish();
      setTimeout(tick, 120);
    };
    setTimeout(tick, 120);
  });
}

function isBlocked(v: SpeechSynthesisVoice): boolean {
  const name = (v.name || "").toLowerCase();
  return BLOCKED_NAME_FRAGMENTS.some((f) => name.includes(f));
}

export function scoreVoice(v: SpeechSynthesisVoice): number {
  if (isBlocked(v)) return -1000;
  const name = v.name || "";
  const lname = name.toLowerCase();
  const lang = (v.lang || "").toLowerCase();
  let s = 0;

  // Named priority list.
  const idx = PREFERRED_NAMES.findIndex((p) => name === p);
  if (idx >= 0) s += 200 - idx * 10;
  else if (PREFERRED_NAMES.some((p) => lname.includes(p.toLowerCase()))) s += 120;

  // Vendor / quality cues.
  if (lname.includes("google")) s += 60;
  if (lname.includes("microsoft")) s += 50;
  if (lname.includes("natural") || lname.includes("neural") || lname.includes("online")) s += 80;
  if (lname.includes("enhanced") || lname.includes("premium")) s += 40;
  if (lname.includes("siri")) s += 35;
  if (lname.includes("novelty")) s -= 200;

  // Language preference: en-NZ > en-AU > en-GB > en-IE > en-US > other en > non-en.
  if (lang.startsWith("en-nz")) s += 90;
  else if (lang.startsWith("en-au")) s += 80;
  else if (lang.startsWith("en-gb")) s += 70;
  else if (lang.startsWith("en-ie")) s += 55;
  else if (lang.startsWith("en-us")) s += 40;
  else if (lang.startsWith("en")) s += 25;
  else s -= 50;

  // Prefer cloud/remote voices over `localService` robotic ones.
  if (v.localService === false) s += 25;
  else s -= 5;

  if (v.default) s += 5;
  return s;
}

export function rankVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return [...voices]
    .map((v) => ({ v, s: scoreVoice(v) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.v);
}

export function pickBestVoice(
  voices: SpeechSynthesisVoice[],
  prefURI: string | null,
): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  if (prefURI) {
    const found = voices.find((v) => v.voiceURI === prefURI);
    if (found) return found;
  }
  return rankVoices(voices)[0] ?? null;
}

// ---- Preferences ----
export function loadPrefs(): ScoutVoicePrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<ScoutVoicePrefs>;
    return {
      voiceURI: typeof parsed.voiceURI === "string" ? parsed.voiceURI : null,
      rate: clamp(parsed.rate ?? DEFAULT_PREFS.rate, 0.5, 1.5),
      pitch: clamp(parsed.pitch ?? DEFAULT_PREFS.pitch, 0.5, 1.5),
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: ScoutVoicePrefs): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch {}
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
}

// ---- Speech ----
// Strip markdown, then chunk on sentence/clause boundaries so each utterance
// stays short (Chrome cuts off ~200-char chunks; iOS ~ 32s).
export function cleanForSpeech(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[.*?\]\(.*?\)/g, " ")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/[*_~]+/g, "")
    .replace(/^>\s?/gm, "")
    .replace(/^#+\s?/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function chunkForSpeech(text: string, maxLen = 180): string[] {
  const clean = cleanForSpeech(text);
  if (!clean) return [];
  // Split on sentence enders, keep punctuation.
  const sentences = clean
    .split(/(?<=[.\!?…])\s+/)
    .flatMap((s) =>
      s.length <= maxLen ? [s] : s.split(/(?<=[,;:])\s+/),
    )
    .flatMap((s) => (s.length <= maxLen ? [s] : hardWrap(s, maxLen)))
    .map((s) => s.trim())
    .filter(Boolean);

  // Glue tiny fragments together to reduce utterance churn.
  const out: string[] = [];
  for (const piece of sentences) {
    if (out.length && out[out.length - 1].length + piece.length + 1 <= maxLen) {
      out[out.length - 1] = out[out.length - 1] + " " + piece;
    } else {
      out.push(piece);
    }
  }
  return out;
}

function hardWrap(s: string, maxLen: number): string[] {
  const parts: string[] = [];
  for (let i = 0; i < s.length; i += maxLen) parts.push(s.slice(i, i + maxLen));
  return parts;
}

export type SpeakHandle = { stop: () => void };

export function stopSpeaking(): void {
  if (!speechSynthAvailable()) return;
  try { window.speechSynthesis.cancel(); } catch {}
}

// Speak text using the preferred voice. Returns a handle so callers can stop.
// Always cancels any in-flight speech first to prevent overlap.
export async function speakWithPrefs(
  text: string,
  prefs: ScoutVoicePrefs,
  opts?: { onEnd?: () => void; onError?: (e: unknown) => void },
): Promise<SpeakHandle> {
  if (!speechSynthAvailable()) {
    opts?.onError?.(new Error("speechSynthesis unavailable"));
    return { stop: () => {} };
  }
  const synth = window.speechSynthesis;
  synth.cancel();

  const voices = await loadVoices();
  const voice = pickBestVoice(voices, prefs.voiceURI);
  const chunks = chunkForSpeech(text);
  if (!chunks.length) {
    opts?.onEnd?.();
    return { stop: () => {} };
  }

  let cancelled = false;
  let idx = 0;

  const speakNext = () => {
    if (cancelled) return;
    if (idx >= chunks.length) { opts?.onEnd?.(); return; }
    const u = new SpeechSynthesisUtterance(chunks[idx++]);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    } else {
      u.lang = "en-AU";
    }
    u.rate = clamp(prefs.rate, 0.5, 1.5);
    u.pitch = clamp(prefs.pitch, 0.5, 1.5);
    u.volume = 1;
    u.onend = () => {
      // Tiny natural pause between chunks.
      if (cancelled) return;
      setTimeout(speakNext, 160);
    };
    u.onerror = (e) => {
      if (cancelled) return;
      opts?.onError?.(e);
      setTimeout(speakNext, 80);
    };
    try {
      synth.speak(u);
      // Chrome bug: long pauses cause synth to silently stop. Nudge it.
      setTimeout(() => {
        try {
          if (!cancelled && synth.paused) synth.resume();
        } catch {
        }
      }, 250);
    } catch (e) {
      opts?.onError?.(e);
    }
  };

  speakNext();
  return {
    stop: () => {
      cancelled = true;
      try { synth.cancel(); } catch {
      }
    },
  };
}
