import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Send, Loader2, RotateCw, AlertTriangle, MessageSquare, Phone } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { z } from "zod";
import { scoutChat } from "@/server/scout.functions";
import scoutAvatar from "@/assets/scout-avatar.png";

const searchSchema = z.object({
  q: z.string().max(2000).optional(),
});

type Msg = { role: "user" | "assistant"; content: string };

const STARTER_PROMPTS = [
  "Best value bets this round?",
  "Who's hot for anytime tryscorer?",
  "Underdog plays I should watch?",
  "Compare the top two teams on the ladder",
];

export const Route = createFileRoute("/scout")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Scout — Your NRL Betting AI · LINEBREAK" },
      { name: "description", content: "Chat with Scout, the AI assistant that knows every NRL fixture, player, stat and market price." },
      { property: "og:title", content: "Scout — Your NRL Betting AI" },
      { property: "og:description", content: "Ask Scout about teams, players, fixtures and odds to find the smartest bets." },
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

  const reset = () => {
    setMessages([]);
    mutation.reset();
    inputRef.current?.focus();
  };

  const hasMessages = messages.length > 0;

  return (
    <div
      className="fixed left-0 right-0 top-16 z-20 flex flex-col bg-background"
      style={{ bottom: "calc(92px + env(safe-area-inset-bottom))" }}
    >
      {/* Hero Scout card */}
      <div className="shrink-0 px-3 sm:px-5 pt-4">
        <div className="mx-auto max-w-6xl">
          <div
            className={`relative overflow-hidden rounded-3xl border-2 border-accent/40 bg-gradient-to-br from-surface via-surface-2 to-surface shadow-[0_8px_40px_-12px_rgba(0,0,0,0.6)] transition-all duration-300 ${
              hasMessages ? "h-24 sm:h-28" : "h-56 sm:h-64"
            }`}
          >
            {/* Glow accents */}
            <div className="pointer-events-none absolute -left-20 -top-20 h-48 w-48 rounded-full bg-accent/20 blur-3xl" />
            <div className="pointer-events-none absolute -right-10 -bottom-10 h-40 w-40 rounded-full bg-accent/10 blur-2xl" />

            <div className="relative flex h-full items-center justify-between gap-3 pl-5 sm:pl-7 pr-2">
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-[0.25em] text-accent font-bold">AI Assistant</div>
                <h1
                  className={`font-display font-extrabold tracking-tight text-foreground leading-[1.05] mt-1 ${
                    hasMessages ? "text-lg sm:text-xl" : "text-2xl sm:text-3xl"
                  }`}
                >
                  {hasMessages ? "Scout" : (<>How can I be of <span className="text-accent">Assistance?</span></>)}
                </h1>

                {!hasMessages && (
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      onClick={() => inputRef.current?.focus()}
                      className="inline-flex items-center gap-1.5 rounded-full bg-accent text-accent-foreground px-4 py-2 text-xs font-bold shadow-md shadow-accent/30 hover:scale-105 transition"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      Chat
                    </button>
                    <button
                      type="button"
                      disabled
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 text-foreground/70 px-4 py-2 text-xs font-bold opacity-70 cursor-not-allowed"
                      title="Coming soon"
                    >
                      <Phone className="h-3.5 w-3.5" />
                      Call
                    </button>
                  </div>
                )}

                {hasMessages && (
                  <button
                    onClick={reset}
                    className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-accent transition font-semibold"
                  >
                    <RotateCw className="h-3 w-3" />
                    New chat
                  </button>
                )}
              </div>

              <img
                src={scoutAvatar}
                alt="Scout"
                className={`shrink-0 object-contain drop-shadow-[0_0_20px_var(--accent)] transition-all duration-300 ${
                  hasMessages ? "h-24 sm:h-28" : "h-56 sm:h-64"
                }`}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Conversation */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto no-scrollbar">
        <div className="mx-auto max-w-6xl px-3 sm:px-5 py-4 space-y-3">
          {!hasMessages && !mutation.isPending && (
            <div className="pt-2 flex flex-wrap gap-2">
              {STARTER_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  className="text-xs px-3 py-1.5 rounded-full border border-border bg-surface-2 hover:bg-accent hover:text-accent-foreground hover:border-accent transition font-medium"
                >
                  {p}
                </button>
              ))}
            </div>
          )}

          {messages.map((m, i) => (
            <Bubble key={i} msg={m} />
          ))}

          {mutation.isPending && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground pl-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
              Scout is thinking…
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
      <div className="shrink-0 border-t border-border bg-background/90 backdrop-blur-xl">
        <form
          onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="mx-auto max-w-6xl px-3 sm:px-5 py-2.5"
        >
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface focus-within:border-accent transition px-3 py-2">
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
                  send(input);
                }
              }}
              placeholder="Message Scout…"
              rows={1}
              className="font-chat flex-1 resize-none bg-transparent outline-none text-[15px] font-medium placeholder:text-muted-foreground placeholder:font-normal py-1 overflow-y-auto no-scrollbar"
              style={{ minHeight: "28px" }}
            />
            <button
              type="submit"
              disabled={!input.trim() || mutation.isPending}
              aria-label="Send"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:scale-105 transition shadow-md shadow-accent/30"
            >
              {mutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Send className="h-4 w-4" />}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Bubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === "user";
  if (isUser) {
    return (
      <div className="flex justify-end animate-fade-in">
        <div
          className="font-chat max-w-[80%] rounded-2xl rounded-br-md bg-accent text-accent-foreground px-3.5 py-2 text-[15px] leading-snug font-semibold shadow-md shadow-accent/30 whitespace-pre-wrap tracking-tight"
          style={{ fontFeatureSettings: '"tnum" 1, "ss01" 1' }}
        >
          {msg.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start animate-fade-in">
      <div
        className="font-chat max-w-[82%] rounded-2xl rounded-bl-md bg-surface-2 text-foreground px-3.5 py-2.5 text-[15px] font-medium shadow-md border border-border"
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
      </div>
    </div>
  );
}
