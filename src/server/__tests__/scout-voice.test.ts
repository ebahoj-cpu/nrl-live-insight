import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  decideVoiceMode,
  fetchElevenLabsAudio,
  type FetchLike,
} from "../scout/scout-voice-server";
import { tryFetchCustomVoice, speakSmart, stopSpeaking } from "@/lib/scout-voice";

describe("decideVoiceMode", () => {
  it("falls back when feature flag is off", () => {
    expect(decideVoiceMode({})).toEqual({ mode: "fallback", reason: "feature-flag-off" });
    expect(decideVoiceMode({ ENABLE_CUSTOM_SCOUT_VOICE: "false" }))
      .toEqual({ mode: "fallback", reason: "feature-flag-off" });
  });

  it("falls back when API key is missing", () => {
    expect(decideVoiceMode({ ENABLE_CUSTOM_SCOUT_VOICE: "true" }))
      .toEqual({ mode: "fallback", reason: "missing-api-key" });
  });

  it("falls back when voice id is missing", () => {
    expect(decideVoiceMode({
      ENABLE_CUSTOM_SCOUT_VOICE: "true",
      ELEVENLABS_API_KEY: "sk_test",
    })).toEqual({ mode: "fallback", reason: "missing-voice-id" });
  });

  it("returns custom mode when fully configured", () => {
    const d = decideVoiceMode({
      ENABLE_CUSTOM_SCOUT_VOICE: "true",
      ELEVENLABS_API_KEY: "sk_test",
      ELEVENLABS_VOICE_ID: "voice_abc",
    });
    expect(d).toEqual({ mode: "custom", apiKey: "sk_test", voiceId: "voice_abc" });
  });

  it("accepts other truthy flag spellings", () => {
    for (const v of ["1", "yes", "on", "TRUE"]) {
      const d = decideVoiceMode({
        ENABLE_CUSTOM_SCOUT_VOICE: v,
        ELEVENLABS_API_KEY: "k",
        ELEVENLABS_VOICE_ID: "v",
      });
      expect(d.mode).toBe("custom");
    }
  });
});

describe("fetchElevenLabsAudio", () => {
  it("returns ok with audio buffer on success", async () => {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    const fetchImpl: FetchLike = vi.fn(async () => new Response(buf, {
      status: 200, headers: { "content-type": "audio/mpeg" },
    }));
    const r = await fetchElevenLabsAudio("hello", "v1", "sk", fetchImpl);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.contentType).toBe("audio/mpeg");
  });

  it("returns error on non-2xx", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => new Response("nope", { status: 401 }));
    const r = await fetchElevenLabsAudio("hi", "v1", "sk", fetchImpl);
    expect(r).toMatchObject({ ok: false, status: 401, reason: "elevenlabs-401" });
  });

  it("returns error on network throw", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => { throw new Error("offline"); });
    const r = await fetchElevenLabsAudio("hi", "v1", "sk", fetchImpl);
    expect(r).toMatchObject({ ok: false, reason: "elevenlabs-network" });
  });

  it("rejects empty text without calling network", async () => {
    const fetchImpl: FetchLike = vi.fn();
    const r = await fetchElevenLabsAudio("   ", "v1", "sk", fetchImpl);
    expect(r).toMatchObject({ ok: false, reason: "empty-text" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("client tryFetchCustomVoice", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it("returns null when server replies with JSON fallback", async () => {
    global.fetch = vi.fn(async () => new Response(
      JSON.stringify({ enabled: false, reason: "feature-flag-off" }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
    const out = await tryFetchCustomVoice("hi");
    expect(out).toBeNull();
  });

  it("returns blob when server replies with audio", async () => {
    const audio = new Blob([new Uint8Array([1, 2])], { type: "audio/mpeg" });
    global.fetch = vi.fn(async () => new Response(audio, {
      status: 200, headers: { "content-type": "audio/mpeg" },
    })) as unknown as typeof fetch;
    const out = await tryFetchCustomVoice("hi");
    expect(out).toBeInstanceOf(Blob);
    expect(out?.type).toBe("audio/mpeg");
  });

  it("returns null on network failure", async () => {
    global.fetch = vi.fn(async () => { throw new Error("x"); }) as unknown as typeof fetch;
    expect(await tryFetchCustomVoice("hi")).toBeNull();
  });
});

describe("speakSmart fallback to browser SpeechSynthesis", () => {
  const realFetch = global.fetch;
  const realWindow = (global as any).window;
  let spoken: string[] = [];

  beforeEach(() => {
    spoken = [];
    const synth = {
      cancel: vi.fn(),
      speak: vi.fn((u: any) => {
        spoken.push(String(u.text));
        setTimeout(() => u.onend?.(), 0);
      }),
      getVoices: () => [],
      addEventListener: vi.fn((_: string, cb: any) => setTimeout(cb, 0)),
      removeEventListener: vi.fn(),
      paused: false,
      resume: vi.fn(),
    };
    (global as any).window = {
      speechSynthesis: synth,
      localStorage: { getItem: () => null, setItem: () => {} },
      innerHeight: 800,
    };
    (global as any).SpeechSynthesisUtterance = class {
      text: string; rate = 1; pitch = 1; volume = 1; lang = ""; voice: any = null;
      onend: any = null; onerror: any = null;
      constructor(t: string) { this.text = t; }
    };
  });

  afterEach(() => {
    global.fetch = realFetch;
    (global as any).window = realWindow;
  });

  it("uses browser TTS when custom-voice endpoint returns fallback JSON", async () => {
    global.fetch = vi.fn(async () => new Response(
      JSON.stringify({ enabled: false }), { headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
    const onEnd = vi.fn();
    const handle = await speakSmart("Hello world.", { voiceURI: null, rate: 1, pitch: 1 }, { onEnd });
    await new Promise((r) => setTimeout(r, 600));
    expect(spoken.length).toBeGreaterThan(0);
    expect(spoken[0]).toContain("Hello world");
    handle.stop();
  });

  it("uses browser TTS when custom-voice endpoint errors", async () => {
    global.fetch = vi.fn(async () => { throw new Error("boom"); }) as unknown as typeof fetch;
    const handle = await speakSmart("Network down.", { voiceURI: null, rate: 1, pitch: 1 });
    await new Promise((r) => setTimeout(r, 30));
    expect(spoken[0]).toContain("Network down");
    handle.stop();
  });

  it("stopSpeaking cancels in-flight synth", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({}), {
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
    await speakSmart("Hi.", { voiceURI: null, rate: 1, pitch: 1 });
    stopSpeaking();
    expect((global as any).window.speechSynthesis.cancel).toHaveBeenCalled();
  });
});
