import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState, useCallback } from "react";
import { Send, Loader2, AlertTriangle, Mic, MicOff, Volume2, Square, User as UserIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { z } from "zod";
import { scoutChat } from "@/server/scout.functions";
import { supabase } from "@/integrations/supabase/client";
import scoutAvatar from "@/assets/scout-avatar.png";
import scoutHead from "@/assets/scout-bubble.png";
import {
  speechSynthAvailable,
  loadPrefs as loadVoicePrefs,
  speakSmart,
  stopSpeaking,
  type SpeakHandle,
} from "@/lib/scout-voice";

// ---- Web Speech API helpers ----
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

const searchSchema = z.object({
  q: z.string().max(2000).optional(),
});

type Msg = { role: "user" | "assistant"; content: string };

export const Route = createFileRoute("/scout")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Scout — Your NRL Betting AI · LINEBREAK" },
      { name: "description", content: "Chat with Scout, the AI assistant that knows every NRL fixture, player, stat and market price." },
    ],
  }),
  component: ScoutPage,
});

function ScoutPage() {
  const { q: initialQuery } = Route.useSearch();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const autoSentRef = useRef(false);
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  // Load profile avatar (best effort)
  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
      const url = (meta.avatar_url || meta.picture) as string | undefined;
      if (url) setUserAvatar(url);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const speakHandleRef = useRef<SpeakHandle | null>(null);

  // Cancel any TTS on unmount
  useEffect(() => () => {
    speakHandleRef.current?.stop();
    stopSpeaking();
  }, []);

  const speak = useCallback((idx: number, text: string) => {
    if (!speechSynthAvailable()) {
      setVoiceError("Text-to-speech isn't supported in this browser.");
      return;
    }
    // Toggle off if already speaking this message.
    if (speakingIdx === idx) {
      speakHandleRef.current?.stop();
      stopSpeaking();
      setSpeakingIdx(null);
      return;
    }
    speakHandleRef.current?.stop();
    setSpeakingIdx(idx);
    const prefs = loadVoicePrefs();
    speakSmart(text, prefs, {
      onEnd: () => setSpeakingIdx((cur) => (cur === idx ? null : cur)),
      onError: () => setSpeakingIdx((cur) => (cur === idx ? null : cur)),
    }).then((h: SpeakHandle) => { speakHandleRef.current = h; }).catch(() => {});
  }, [speakingIdx]);

  const mutation = useMutation({
    mutationFn: async (msgs: Msg[]) => {
      const res = await scoutChat({ data: { messages: msgs } });
      return res.reply;
    },
    onSuccess: (reply) => {
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, mutation.isPending]);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || mutation.isPending) return;
    const next: Msg[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "";
    mutation.mutate(next);
  };

  useEffect(() => {
    if (!initialQuery || autoSentRef.current) return;
    autoSentRef.current = true;
    send(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  const hasMessages = messages.length > 0;

  return (
    <div
      className="fixed left-0 right-0 top-16 z-20 bg-background"
      style={{ bottom: "calc(92px + env(safe-area-inset-bottom))" }}
    >
      <div className="relative h-full w-full flex">
        {/* Scout — desktop/tablet only (dominant right side). Mobile renders inline below. */}
        {(() => {
          const hasAssistantReply = messages.some((m) => m.role === "assistant");
          return (
            <div
              className={
                "pointer-events-none absolute inset-y-0 right-0 w-[55%] lg:w-[58%] items-end justify-end " +
                (hasAssistantReply ? "hidden" : "hidden sm:flex")
              }
            >
              <div className="pointer-events-none absolute right-0 top-1/4 h-[60%] w-[80%] rounded-full bg-accent/20 blur-3xl" />
              <img
                src={scoutAvatar}
                alt="Scout"
                draggable={false}
                aria-hidden="true"
                style={{ pointerEvents: "none" }}
                className="relative h-[88%] lg:h-[94%] w-auto object-contain object-bottom drop-shadow-[0_0_40px_var(--accent)] select-none"
              />
            </div>
          );
        })()}

        {/* Left: conversation column — full width on mobile so it overlays Scout */}
        <div className="relative z-10 flex h-full w-full sm:w-[55%] lg:w-[50%] flex-col">
          {hasMessages ? (
            <>
              {/* Header */}
              <div className="shrink-0 px-4 sm:px-8 pt-8 sm:pt-10 pb-3">
                <div className="text-[10px] uppercase tracking-[0.25em] text-accent font-bold">Your Assistant</div>
                <h1 className="mt-1.5 font-display font-extrabold tracking-tight text-foreground text-2xl sm:text-3xl lg:text-4xl leading-[1.05]">
                  Scout
                </h1>
              </div>

              {/* Conversation */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto no-scrollbar">
                <div className="px-3 sm:px-6 py-3 space-y-3">
                  {messages.map((m, i) => (
                    <Bubble
                      key={i}
                      msg={m}
                      userAvatar={userAvatar}
                      isSpeaking={speakingIdx === i}
                      onToggleSpeak={() => speak(i, m.content)}
                    />
                  ))}
                  {voiceError && (
                    <div className="text-[11px] text-destructive pl-1">{voiceError}</div>
                  )}

                  {mutation.isPending && (
                    <div className="flex items-center gap-2 pl-1">
                      <img
                        src={scoutHead}
                        alt=""
                        aria-hidden="true"
                        className="h-8 w-8 object-contain drop-shadow-[0_0_8px_var(--accent)]"
                        draggable={false}
                      />
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                        Scout is thinking…
                      </div>
                    </div>
                  )}

                  {mutation.isError && (
                    <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{(mutation.error as Error)?.message ?? "Something went wrong."}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Composer */}
              <div className="shrink-0 px-3 sm:px-6 pb-4 sm:pb-6 pt-2">
                <Composer
                  input={input}
                  setInput={setInput}
                  inputRef={inputRef}
                  onSend={() => send(input)}
                  isPending={mutation.isPending}
                />
              </div>
            </>
          ) : (
            <>
              {/* Mobile: header → composer → Scout image, full black bg, no scroll */}
              <div className="sm:hidden flex flex-col h-full bg-background overflow-hidden">
                <div className="shrink-0 px-5 pt-8 pb-3 text-center">
                  <div className="text-[11px] uppercase tracking-[0.3em] text-accent font-bold">Scout — Your Assistant</div>
                  <h1 className="mt-2 font-display font-extrabold tracking-tight text-foreground text-[2rem] leading-[1.05]">
                    How can I <span className="text-accent">assist?</span>
                  </h1>
                </div>
                <div className="shrink-0 px-3 pt-1 pb-3">
                  <div className="text-[16px]">
                    <Composer
                      input={input}
                      setInput={setInput}
                      inputRef={inputRef}
                      onSend={() => send(input)}
                      isPending={mutation.isPending}
                    />
                  </div>
                </div>
                <div className="relative flex-1 min-h-0 flex items-end justify-center">
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[70%] mx-auto w-[80%] rounded-full bg-accent/20 blur-3xl" />
                  <img
                    src={scoutAvatar}
                    alt="Scout"
                    draggable={false}
                    aria-hidden="true"
                    className="relative h-full w-auto max-w-full object-contain object-bottom drop-shadow-[0_0_40px_var(--accent)] select-none"
                  />
                </div>
              </div>

              {/* Desktop/tablet: heading + composer stacked, centered within left column */}
              <div className="hidden sm:flex flex-1 flex-col justify-center items-center px-8 gap-8">
                <div className="w-full max-w-lg text-center">
                  <div className="text-xs uppercase tracking-[0.3em] text-accent font-bold">Scout — Your Assistant</div>
                  <h1 className="mt-3 font-display font-extrabold tracking-tight text-foreground text-3xl lg:text-4xl xl:text-5xl leading-[1.02] whitespace-nowrap">
                    How can I <span className="text-accent">assist?</span>
                  </h1>
                </div>
                <div className="w-full max-w-lg text-[17px]">
                  <Composer
                    input={input}
                    setInput={setInput}
                    inputRef={inputRef}
                    onSend={() => send(input)}
                    isPending={mutation.isPending}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Composer({
  input,
  setInput,
  inputRef,
  onSend,
  isPending,
}: {
  input: string;
  setInput: (v: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onSend: () => void;
  isPending: boolean;
}) {
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const baseRef = useRef<string>("");

  const supported = !!getSpeechRecognitionCtor();

  const stopListening = useCallback(() => {
    try { recRef.current?.stop(); } catch {}
    setListening(false);
  }, []);

  const startListening = useCallback(() => {
    setMicError(null);
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) { setMicError("Voice input isn't supported in this browser."); return; }
    try {
      const rec = new Ctor();
      rec.lang = (typeof navigator !== "undefined" && navigator.language) || "en-AU";
      rec.interimResults = true;
      rec.continuous = false;
      baseRef.current = input ? input.trimEnd() + " " : "";
      rec.onresult = (e: any) => {
        let txt = "";
        for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
        const next = (baseRef.current + txt).slice(0, 2000);
        setInput(next);
        if (inputRef.current) {
          inputRef.current.style.height = "auto";
          const cap = Math.round(window.innerHeight * 0.4);
          inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, cap) + "px";
        }
      };
      rec.onerror = (e: any) => {
        const code = e?.error || "";
        if (code === "not-allowed" || code === "service-not-allowed") {
          setMicError("Microphone permission denied.");
        } else if (code === "no-speech") {
          setMicError("Didn't catch that — try again.");
        } else if (code) {
          setMicError("Voice input error.");
        }
        setListening(false);
      };
      rec.onend = () => setListening(false);
      recRef.current = rec;
      rec.start();
      setListening(true);
    } catch {
      setMicError("Couldn't start voice input.");
      setListening(false);
    }
  }, [input, inputRef, setInput]);

  useEffect(() => () => { try { recRef.current?.abort(); } catch {} }, []);

  const handleSend = () => {
    if (listening) stopListening();
    onSend();
  };

  return (
    <div className="flex flex-col gap-1">
      <form
        onSubmit={(e) => { e.preventDefault(); handleSend(); }}
        className="flex items-end gap-2 rounded-2xl border border-border bg-surface backdrop-blur-xl focus-within:border-accent transition px-3 py-2 shadow-2xl shadow-black/70 ring-1 ring-black/40"
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            const el = e.currentTarget;
            el.style.height = "auto";
            const cap = Math.round(window.innerHeight * 0.4);
            el.style.height = Math.min(el.scrollHeight, cap) + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={listening ? "Listening…" : "Ask for the inside info..."}
          rows={1}
          className="font-chat flex-1 resize-none bg-transparent outline-none text-[15px] font-medium placeholder:text-muted-foreground placeholder:font-normal py-1 overflow-y-auto no-scrollbar"
          style={{ minHeight: "28px" }}
        />
        {supported && (
          <button
            type="button"
            onClick={listening ? stopListening : startListening}
            disabled={isPending}
            aria-label={listening ? "Stop voice input" : "Start voice input"}
            className={
              "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition shadow-md disabled:opacity-40 disabled:cursor-not-allowed " +
              (listening
                ? "bg-destructive text-destructive-foreground animate-pulse shadow-destructive/40"
                : "bg-surface-2 text-foreground hover:bg-accent/20 border border-border")
            }
          >
            {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
        )}
        <button
          type="submit"
          onClick={(e) => { e.preventDefault(); handleSend(); }}
          disabled={!input.trim() || isPending}
          aria-label="Send"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:scale-105 transition shadow-md shadow-accent/30"
        >
          {isPending
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Send className="h-4 w-4" />}
        </button>
      </form>
      {micError && (
        <div className="text-[11px] text-destructive px-2">{micError}</div>
      )}
    </div>
  );
}

function Bubble({
  msg,
  userAvatar,
  isSpeaking,
  onToggleSpeak,
}: {
  msg: Msg;
  userAvatar?: string | null;
  isSpeaking?: boolean;
  onToggleSpeak?: () => void;
}) {
  const isUser = msg.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end items-start gap-2 animate-fade-in">
        <div
          className="font-chat max-w-[85%] text-right text-[15px] leading-snug font-semibold text-foreground whitespace-pre-wrap tracking-tight px-2"
          style={{
            fontFeatureSettings: '"tnum" 1, "ss01" 1',
            textShadow: "0 1px 8px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9)",
          }}
        >
          {msg.content}
        </div>
        {userAvatar ? (
          <img
            src={userAvatar}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="h-9 w-9 shrink-0 rounded-full object-cover border border-border mt-0.5"
          />
        ) : (
          <div className="h-9 w-9 shrink-0 rounded-full bg-surface-2 border border-border flex items-center justify-center mt-0.5">
            <UserIcon className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
      </div>
    );
  }

  // Assistant — Scout owl avatar + bubble
  return (
    <div className="flex justify-start items-start gap-2 animate-fade-in">
      <img
        src={scoutHead}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="h-9 w-9 shrink-0 object-contain mt-0.5 drop-shadow-[0_0_8px_var(--accent)]"
      />
      <div
        className="font-chat max-w-[82%] rounded-2xl rounded-tl-md bg-surface-2 backdrop-blur-md text-foreground px-3.5 py-2.5 text-[15px] font-medium shadow-xl shadow-black/60 border border-border ring-1 ring-black/40"
        style={{ fontFeatureSettings: '"tnum" 1, "ss01" 1, "cv11" 1' }}
      >
        <ReactMarkdown
          components={{
            ul: ({ node, ...props }) => (
              <ul {...props} className="list-none space-y-1.5 m-0 p-0" />
            ),
            li: ({ node, children, ...props }) => (
              <li
                {...props}
                className="relative pl-4 leading-[1.45] tracking-tight before:content-[''] before:absolute before:left-0 before:top-[0.65em] before:h-1.5 before:w-1.5 before:rounded-sm before:bg-accent"
              >
                {children}
              </li>
            ),
            strong: ({ node, ...props }) => (
              <strong {...props} className="font-extrabold uppercase tracking-wide text-accent" style={{ fontFamily: 'var(--font-chat-display)' }} />
            ),
            code: ({ node, ...props }) => (
              <code
                {...props}
                className="font-mono text-[13px] font-bold text-accent bg-accent/10 border border-accent/30 rounded px-1.5 py-0.5 mx-0.5 tabular-nums"
              />
            ),
            p: ({ node, ...props }) => (
              <p {...props} className="m-0 leading-snug [&:not(:first-child)]:mt-2" />
            ),
          }}
        >
          {msg.content}
        </ReactMarkdown>
        {onToggleSpeak && speechSynthAvailable() && (
          <div className="mt-1.5 flex justify-end">
            <button
              type="button"
              onClick={onToggleSpeak}
              aria-label={isSpeaking ? "Stop reading" : "Read aloud"}
              className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:text-accent hover:bg-accent/10 transition"
            >
              {isSpeaking ? <Square className="h-3 w-3 fill-current" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
