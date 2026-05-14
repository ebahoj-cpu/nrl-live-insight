// Scout custom-voice (ElevenLabs) decision + request helpers.
// Pure functions kept in this module so they're easy to unit-test without
// pulling in TanStack route plumbing.

export type VoiceModeDecision =
  | { mode: "custom"; voiceId: string; apiKey: string }
  | { mode: "fallback"; reason: string };

export type VoiceEnv = {
  ENABLE_CUSTOM_SCOUT_VOICE?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_VOICE_ID?: string;
};

const TRUTHY = new Set(["1", "true", "TRUE", "yes", "on"]);

export function decideVoiceMode(env: VoiceEnv): VoiceModeDecision {
  const flag = (env.ENABLE_CUSTOM_SCOUT_VOICE ?? "").trim();
  if (!TRUTHY.has(flag)) return { mode: "fallback", reason: "feature-flag-off" };
  const apiKey = (env.ELEVENLABS_API_KEY ?? "").trim();
  if (!apiKey) return { mode: "fallback", reason: "missing-api-key" };
  const voiceId = (env.ELEVENLABS_VOICE_ID ?? "").trim();
  if (!voiceId) return { mode: "fallback", reason: "missing-voice-id" };
  return { mode: "custom", voiceId, apiKey };
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ElevenLabsResult =
  | { ok: true; audio: ArrayBuffer; contentType: string }
  | { ok: false; status: number; reason: string };

// Calls ElevenLabs TTS. Pure (fetch is injected) so tests can mock.
export async function fetchElevenLabsAudio(
  text: string,
  voiceId: string,
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<ElevenLabsResult> {
  const clean = text.trim().slice(0, 5000);
  if (!clean) return { ok: false, status: 400, reason: "empty-text" };
  try {
    const res = await fetchImpl(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: clean,
          model_id: "eleven_turbo_v2_5",
          voice_settings: {
            stability: 0.55,
            similarity_boost: 0.75,
            style: 0.35,
            use_speaker_boost: true,
            speed: 1.0,
          },
        }),
      },
    );
    if (!res.ok) {
      return { ok: false, status: res.status, reason: `elevenlabs-${res.status}` };
    }
    const audio = await res.arrayBuffer();
    return {
      ok: true,
      audio,
      contentType: res.headers.get("content-type") || "audio/mpeg",
    };
  } catch {
    return { ok: false, status: 502, reason: "elevenlabs-network" };
  }
}
