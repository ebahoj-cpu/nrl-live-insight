import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Volume2, Square, Save, Check } from "lucide-react";
import {
  loadPrefs,
  savePrefs,
  loadVoices,
  rankVoices,
  speakWithPrefs,
  stopSpeaking,
  speechSynthAvailable,
  DEFAULT_PREFS,
  type ScoutVoicePrefs,
} from "@/lib/scout-voice";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings · LINEBREAK" },
      { name: "description", content: "Customise Scout's voice, speed and pitch." },
    ],
  }),
  component: SettingsPage,
});

const SAMPLE = "Welcome back to Scout. Here's the form line on tonight's match — the Storm have momentum at home, the Roosters are missing their starting halfback, and the market's still drifting. I like the under at this number.";

function SettingsPage() {
  const [prefs, setPrefs] = useState<ScoutVoicePrefs>(DEFAULT_PREFS);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const supported = speechSynthAvailable();

  useEffect(() => { setPrefs(loadPrefs()); }, []);

  useEffect(() => {
    if (!supported) { setLoading(false); return; }
    let active = true;
    loadVoices().then((vs) => {
      if (!active) return;
      setVoices(vs);
      setLoading(false);
    });
    return () => { active = false; };
  }, [supported]);

  useEffect(() => () => stopSpeaking(), []);

  const ranked = useMemo(() => rankVoices(voices), [voices]);

  const update = <K extends keyof ScoutVoicePrefs>(k: K, v: ScoutVoicePrefs[K]) =>
    setPrefs((p) => ({ ...p, [k]: v }));

  const handleSave = () => {
    savePrefs(prefs);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  const handleTest = async () => {
    if (testing) { stopSpeaking(); setTesting(false); return; }
    setTesting(true);
    const handle = await speakWithPrefs(SAMPLE, prefs, {
      onEnd: () => setTesting(false),
      onError: () => setTesting(false),
    });
    // safety: stop after 20s if browser hangs
    setTimeout(() => handle.stop(), 20000);
  };

  return (
    <div className="pt-8 pb-12 max-w-2xl mx-auto">
      <div className="text-[10px] uppercase tracking-[0.25em] text-accent font-bold">Preferences</div>
      <h1 className="mt-1.5 font-display font-extrabold tracking-tight text-foreground text-3xl sm:text-4xl">
        Settings
      </h1>

      <section className="mt-8 rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <h2 className="font-display font-extrabold text-xl">Scout Voice</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose how Scout sounds when reading replies aloud. Uses your device's built-in voices — completely free, no account needed.
        </p>

        {!supported && (
          <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Voice playback isn't supported in this browser.
          </div>
        )}

        {supported && (
          <div className="mt-6 space-y-6">
            {/* Voice picker */}
            <div>
              <label className="block text-xs uppercase tracking-wider font-bold text-muted-foreground mb-2">
                Voice
              </label>
              <select
                value={prefs.voiceURI ?? ""}
                onChange={(e) => update("voiceURI", e.target.value || null)}
                disabled={loading}
                className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm font-medium text-foreground focus:border-accent outline-none"
              >
                <option value="">Auto — best available ({loading ? "loading…" : `${voices.length} voices`})</option>
                {ranked.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} — {v.lang}{v.localService ? "" : " · cloud"}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Auto picks high-quality natural English voices first (Google UK, Microsoft Natural, Samantha, Daniel) and prefers NZ/AU/UK accents.
              </p>
            </div>

            {/* Rate */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs uppercase tracking-wider font-bold text-muted-foreground">Speed</label>
                <span className="text-xs font-semibold tabular-nums text-foreground">{prefs.rate.toFixed(2)}×</span>
              </div>
              <input
                type="range"
                min={0.6}
                max={1.4}
                step={0.01}
                value={prefs.rate}
                onChange={(e) => update("rate", Number(e.target.value))}
                className="w-full accent-accent"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>Slow</span><span>Default</span><span>Fast</span>
              </div>
            </div>

            {/* Pitch */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs uppercase tracking-wider font-bold text-muted-foreground">Pitch</label>
                <span className="text-xs font-semibold tabular-nums text-foreground">{prefs.pitch.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0.6}
                max={1.4}
                step={0.01}
                value={prefs.pitch}
                onChange={(e) => update("pitch", Number(e.target.value))}
                className="w-full accent-accent"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>Deep</span><span>Neutral</span><span>Bright</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                onClick={handleTest}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 hover:bg-accent/15 hover:text-accent transition px-4 py-2 text-sm font-semibold"
              >
                {testing ? <Square className="h-4 w-4 fill-current" /> : <Volume2 className="h-4 w-4" />}
                {testing ? "Stop" : "Test Voice"}
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="inline-flex items-center gap-2 rounded-full bg-accent text-accent-foreground hover:scale-[1.02] transition px-4 py-2 text-sm font-bold shadow-md shadow-accent/30"
              >
                {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                {saved ? "Saved" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setPrefs(DEFAULT_PREFS)}
                className="inline-flex items-center gap-2 rounded-full border border-border text-muted-foreground hover:text-foreground transition px-4 py-2 text-sm font-semibold"
              >
                Reset
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
