import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Sparkles, Send, Loader2, RotateCw, AlertTriangle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { scoutChat } from "@/server/scout.functions";

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
  const router = useRouter();
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
    // Send the conversation excluding the greeting (system handles persona)
    const forApi = next.filter((m, i) => !(i === 0 && m === GREETING));
    mutation.mutate(forApi);
  };

  const reset = () => {
    setMessages([GREETING]);
    mutation.reset();
    inputRef.current?.focus();
  };

  return (
    <div className="pt-4 sm:pt-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <span className="absolute inset-0 rounded-full bg-accent/30 blur-md animate-pulse" />
            <span className="relative inline-flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent/60 text-accent-foreground shadow-lg shadow-accent/30">
              <Sparkles className="h-5 w-5" strokeWidth={2.5} />
            </span>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-accent font-bold">AI Assistant</div>
            <h1 className="text-2xl font-display font-extrabold tracking-tight">Scout</h1>
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

      {/* Chat container */}
      <div className="rounded-3xl border border-border bg-surface/60 backdrop-blur-sm overflow-hidden flex flex-col h-[calc(100vh-260px)] min-h-[480px]">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-5 py-5 space-y-4">
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
        </div>

        {/* Starter chips (only on the greeting) */}
        {messages.length === 1 && !mutation.isPending && (
          <div className="px-3 sm:px-5 pb-3 flex flex-wrap gap-2">
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

        {/* Composer */}
        <form
          onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="border-t border-border bg-background/40 p-2 sm:p-3"
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
              placeholder="Ask Scout about a team, player, fixture or market…"
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
          <p className="mt-1.5 text-[10px] text-muted-foreground text-center">
            Scout uses live NRL data. Always bet responsibly · 18+
          </p>
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
        <div className="max-w-[80%] rounded-2xl bg-white text-neutral-900 px-3.5 py-2 text-sm shadow-sm whitespace-pre-wrap border border-neutral-200">
          {msg.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2 items-start">
      <span className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-md mt-0.5">
        <Sparkles className="h-4 w-4" strokeWidth={2.5} />
      </span>
      <div className="max-w-[80%] rounded-2xl bg-accent text-accent-foreground px-3.5 py-2.5 text-sm shadow-sm">
        <div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:mt-1.5 prose-headings:mb-1 text-accent-foreground prose-strong:text-accent-foreground prose-li:marker:text-accent-foreground/70">
          <ReactMarkdown>{msg.content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
