import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Send, Loader2, RotateCw, AlertTriangle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { scoutChat } from "@/server/scout.functions";
import scoutAvatar from "@/assets/scout-avatar.png";

type Msg = { role: "user" | "assistant"; content: string };

const STARTER_PROMPTS = [
  "Best value bets this round?",
  "Who's hot for anytime tryscorer?",
  "Underdog plays I should watch?",
  "Compare the top two teams on the ladder",
];

const GREETING: Msg = {
  role: "assistant",
  content:
    "G'day — I'm **Scout**, your NRL betting brain. I read every fixture, the ladder, live odds and the latest news so you don't have to.\n\nAsk me about a team, player, fixture, or market. I'll point out the angle.",
};

export const Route = createFileRoute("/scout")({
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
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
    const forApi = next.filter((m, i) => !(i === 0 && m === GREETING));
    mutation.mutate(forApi);
  };

  const reset = () => {
    setMessages([GREETING]);
    mutation.reset();
    inputRef.current?.focus();
  };

  // Layout math: header is h-16 (64px), bottom nav ~92px (incl. fade + safe area).
  // We pin the page to the viewport between them; only the messages list scrolls.
  // z-20 sits above root <Footer> / <main> so they don't bleed through.
  return (
    <div
      className="fixed left-0 right-0 top-16 z-20 flex flex-col bg-background"
      style={{ bottom: "calc(92px + env(safe-area-inset-bottom))" }}
    >
      {/* Static header bar */}
      <div className="shrink-0 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <span className="absolute inset-0 rounded-full bg-accent/30 blur-md animate-pulse" />
              <span className="relative inline-flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent/60 ring-2 ring-accent/40 overflow-hidden shadow-lg shadow-accent/30">
                <img src={scoutAvatar} alt="Scout" width={44} height={44} className="h-full w-full object-cover" />
              </span>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-accent font-bold">AI Assistant</div>
              <h1 className="text-xl font-display font-extrabold tracking-tight leading-tight">Scout</h1>
            </div>
          </div>
          <button
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold hover:bg-surface-2 transition"
          >
            <RotateCw className="h-3.5 w-3.5" />
            New chat
          </button>
        </div>
      </div>

      {/* Scrollable chat dialogue */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-3 sm:px-5 py-5 space-y-3">
          {messages.map((m, i) => (
            <Bubble key={i} msg={m} />
          ))}
          {mutation.isPending && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground pl-11">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Scout is thinking…
            </div>
          )}
          {mutation.isError && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{(mutation.error as Error)?.message ?? "Something went wrong."}</span>
            </div>
          )}
          {messages.length === 1 && !mutation.isPending && (
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
        </div>
      </div>

      {/* Pinned composer */}
      <div className="shrink-0 border-t border-border bg-background/90 backdrop-blur-xl">
        <form
          onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="mx-auto max-w-6xl px-3 sm:px-5 py-2.5"
        >
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface focus-within:border-accent transition px-3 py-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder="Message Scout…"
              rows={1}
              className="flex-1 resize-none bg-transparent outline-none text-sm placeholder:text-muted-foreground max-h-32 py-1"
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
      <div className="flex justify-end">
        <div
          className="font-chat max-w-[80%] rounded-2xl rounded-br-md bg-white text-neutral-950 px-3.5 py-2 text-[15px] leading-snug font-semibold shadow-md whitespace-pre-wrap tracking-tight"
          style={{ fontFeatureSettings: '"tnum" 1, "ss01" 1' }}
        >
          {msg.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2 items-start">
      <span className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 ring-2 ring-accent/40 overflow-hidden mt-0.5">
        <img src={scoutAvatar} alt="Scout" width={32} height={32} className="h-full w-full object-cover" />
      </span>
      <div
        className="scout-bubble font-chat max-w-[82%] rounded-2xl rounded-bl-md bg-accent text-accent-foreground px-3.5 py-2.5 text-[15px] font-medium shadow-md shadow-accent/30"
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
                className="relative pl-4 leading-[1.45] tracking-tight before:content-[''] before:absolute before:left-0 before:top-[0.65em] before:h-1.5 before:w-1.5 before:rounded-sm before:bg-accent-foreground/80"
              >
                {children}
              </li>
            ),
            strong: ({ node, ...props }) => (
              <strong {...props} className="font-extrabold uppercase tracking-wide text-accent-foreground" style={{ fontFamily: 'var(--font-chat-display)' }} />
            ),
            code: ({ node, ...props }) => (
              <code
                {...props}
                className="font-mono text-[13px] font-bold text-accent-foreground bg-accent-foreground/15 border border-accent-foreground/30 rounded px-1.5 py-0.5 mx-0.5 tabular-nums"
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
