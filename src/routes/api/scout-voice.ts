import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  decideVoiceMode,
  fetchElevenLabsAudio,
} from "@/server/scout/scout-voice-server";

const BodySchema = z.object({
  text: z.string().min(1).max(5000),
});

function jsonFallback(reason: string, status = 200) {
  return new Response(
    JSON.stringify({ enabled: false, reason, fallback: "browser-speech-synthesis" }),
    { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
  );
}

export const Route = createFileRoute("/api/scout-voice")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const decision = decideVoiceMode(process.env as Record<string, string | undefined>);
        if (decision.mode === "fallback") {
          // 200 with fallback payload — client uses browser SpeechSynthesis.
          return jsonFallback(decision.reason, 200);
        }

        let parsed;
        try {
          const raw = await request.json();
          parsed = BodySchema.parse(raw);
        } catch {
          return new Response(
            JSON.stringify({ enabled: false, reason: "bad-request" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        const result = await fetchElevenLabsAudio(parsed.text, decision.voiceId, decision.apiKey);
        if (!result.ok) {
          // Surface a fallback so the client cleanly switches to browser TTS.
          return jsonFallback(result.reason, 200);
        }
        return new Response(result.audio, {
          status: 200,
          headers: {
            "Content-Type": result.contentType,
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
