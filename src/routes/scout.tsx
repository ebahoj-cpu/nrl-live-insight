import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Send, Loader2, AlertTriangle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { z } from "zod";
import { scoutChat } from "@/server/scout.functions";
import scoutAvatar from "@/assets/scout-avatar.png";
import scoutHead from "@/assets/scout-bubble.png";

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
        {/* Scout — bigger and pushed right on mobile, dominant on desktop.
            Mobile only: hide once Scout has replied to keep chat clean. */}
        {(() => {
          const hasAssistantReply = messages.some((m) => m.role === "assistant");
          return (
            <div
              className={
                "pointer-events-none absolute inset-y-0 -right-[8%] sm:right-0 w-[80%] sm:w-[55%] lg:w-[58%] items-end justify-end " +
                (hasAssistantReply ? "hidden sm:flex" : "flex")
              }
            >
              <div className="pointer-events-none absolute right-0 top-1/4 h-[60%] w-[80%] rounded-full bg-accent/20 blur-3xl" />
              <img
                src={scoutAvatar}
                alt="Scout"
                draggable={false}
                aria-hidden="true"
                style={{ pointerEvents: "none" }}
                className="relative h-[96%] sm:h-[88%] lg:h-[94%] w-auto object-contain object-bottom drop-shadow-[0_0_40px_var(--accent)] select-none"
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
                    <Bubble key={i} msg={m} />
                  ))}

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
              {/* Mobile: header at top, composer at bottom (preserve current mobile layout) */}
              <div className="sm:hidden flex flex-col h-full">
                <div className="shrink-0 px-5 pt-16 pb-3">
                  <div className="text-xs uppercase tracking-[0.25em] text-accent font-bold">Scout — Your Assistant</div>
                  <h1 className="mt-2 font-display font-extrabold tracking-tight text-foreground text-4xl leading-[1.02]">
                    How can I <span className="text-accent">assist?</span>
                  </h1>
                </div>
                <div className="flex-1" />
                <div className="shrink-0 px-3 pb-4 pt-2">
                  <div className="text-[17px]">
                    <Composer
                      input={input}
                      setInput={setInput}
                      inputRef={inputRef}
                      onSend={() => send(input)}
                      isPending={mutation.isPending}
                    />
                  </div>
                </div>
              </div>

              {/* Desktop/tablet: heading + composer stacked, vertically centered. Constrained to left column so it doesn't overlay Scout. */}
              <div className="hidden sm:flex flex-1 flex-col justify-center items-start px-8 lg:px-12 gap-8">
                <div className="w-full max-w-xl">
                  <div className="text-xs uppercase tracking-[0.3em] text-accent font-bold">Scout — Your Assistant</div>
                  <h1 className="mt-3 font-display font-extrabold tracking-tight text-foreground text-5xl lg:text-6xl xl:text-7xl leading-[1.02]">
                    How can I <span className="text-accent">assist?</span>
                  </h1>
                </div>
                <div className="w-full max-w-xl text-[17px]">
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
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSend(); }}
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
            onSend();
          }
        }}
        placeholder="Message Scout…"
        rows={1}
        className="font-chat flex-1 resize-none bg-transparent outline-none text-[15px] font-medium placeholder:text-muted-foreground placeholder:font-normal py-1 overflow-y-auto no-scrollbar"
        style={{ minHeight: "28px" }}
      />
      <button
        type="submit"
        onClick={(e) => { e.preventDefault(); onSend(); }}
        disabled={!input.trim() || isPending}
        aria-label="Send"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:scale-105 transition shadow-md shadow-accent/30"
      >
        {isPending
          ? <Loader2 className="h-4 w-4 animate-spin" />
          : <Send className="h-4 w-4" />}
      </button>
    </form>
  );
}

function Bubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === "user";

  if (isUser) {
    // No bubble — plain right-aligned text with strong shadow for legibility over Scout
    return (
      <div className="flex justify-end animate-fade-in">
        <div
          className="font-chat max-w-[85%] text-right text-[15px] leading-snug font-semibold text-foreground whitespace-pre-wrap tracking-tight px-2"
          style={{
            fontFeatureSettings: '"tnum" 1, "ss01" 1',
            textShadow: "0 1px 8px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9)",
          }}
        >
          {msg.content}
        </div>
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
      </div>
    </div>
  );
}
