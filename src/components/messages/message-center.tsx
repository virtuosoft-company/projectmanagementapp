"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search, Send } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { markMessagesReadAction, sendMessageAction } from "@/lib/actions";
import type { Member, Message } from "@/lib/domain";
import { cn } from "@/lib/utils";

export function MessageCenter({
  contacts,
  messages,
}: {
  contacts: Member[];
  messages: Message[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /*
   * Marking read gets its own transition, deliberately.
   *
   * Sharing `send`'s meant that focusing the reply box raised `pending`, and
   * `pending` disables the Send button — so clicking into a thread with unread
   * messages disabled Send for the length of a round trip, which is precisely
   * the moment someone is typing their reply. Nothing should block on a
   * background write the user never asked for.
   */
  const [, startMarkingRead] = useTransition();
  const [activeId, setActiveId] = useState(contacts[0]?.id);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");

  const all = messages;

  const filtered = contacts.filter((contact) =>
    contact.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const active = contacts.find((contact) => contact.id === activeId);
  const thread = all.filter((message) => message.memberId === activeId);

  // Anything from them in this thread that has not been read yet. Checked
  // before calling, so focusing the box on an already-read thread — which is
  // most focuses — writes nothing and does not refresh the page.
  const hasUnread = thread.some((message) => message.from === "them" && !message.read);

  function markRead() {
    if (!activeId || !hasUnread) return;

    startMarkingRead(async () => {
      const result = await markMessagesReadAction(activeId);
      // Deliberately quiet on failure: the badge staying up is the whole
      // consequence, and a toast for it would interrupt someone who is in the
      // middle of typing a reply.
      if (result.ok) router.refresh();
    });
  }

  function send(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !activeId) return;

    startTransition(async () => {
      const result = await sendMessageAction(activeId, text);

      // The draft is deliberately left alone on failure: clearing it would
      // throw away what they typed with nothing to show for it.
      if (!result.ok) {
        toast.error(result.error ?? "That message did not send.");
        return;
      }

      setDraft("");
      router.refresh();
    });
  }

  return (
    <div className="grid h-[calc(100svh-9rem)] grid-cols-1 overflow-hidden rounded-lg border bg-card md:grid-cols-[300px_1fr]">
      <div className="flex min-h-0 flex-col border-b md:border-b-0 md:border-r">
        <div className="border-b p-3">
          <div className="relative flex items-center">
            <Search className="absolute left-2.5 top-7 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search people"
              aria-label="Search people"
              className="pl-8"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
          {filtered.map((contact) => {
            const last = all.filter((m) => m.memberId === contact.id).at(-1);
            return (
              <button
                key={contact.id}
                type="button"
                onClick={() => setActiveId(contact.id)}
                aria-current={contact.id === activeId}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors hover:bg-accent",
                  contact.id === activeId && "bg-accent",
                )}
              >
                <UserAvatar
                  name={contact.name}
                  className="h-9 w-9 bg-primary/10"
                  textClassName="text-xs text-primary"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-medium">{contact.name}</p>
                    {last ? (
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        {last.date}
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {last?.text ?? "No messages yet"}
                  </p>
                </div>
              </button>
            );
          })}
          {filtered.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">No people match that search.</p>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-col">
        {active ? (
          <>
            <div className="flex items-center gap-3 border-b p-3">
              <UserAvatar
                name={active.name}
                className="h-9 w-9 bg-primary/10"
                textClassName="text-xs text-primary"
              />
              <div>
                <p className="text-sm font-medium">{active.name}</p>
                <p className="text-xs text-muted-foreground">{active.email}</p>
              </div>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {thread.length === 0 ? (
                <p className="pt-8 text-center text-sm text-muted-foreground">
                  No messages yet. Say hello.
                </p>
              ) : (
                thread.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "flex",
                      message.from === "me" ? "justify-end" : "justify-start",
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[75%] rounded-2xl px-3.5 py-2 text-sm",
                        message.from === "me"
                          ? "rounded-br-sm bg-primary text-primary-foreground"
                          : "rounded-bl-sm bg-muted",
                      )}
                    >
                      <p className="break-words whitespace-pre-wrap">{message.text}</p>
                      <p
                        className={cn(
                          "mt-1 font-mono text-[10px]",
                          message.from === "me"
                            ? "text-primary-foreground/70"
                            : "text-muted-foreground",
                        )}
                      >
                        {message.time}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={send} className="flex gap-2 border-t p-3">
              <Input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                // `onFocus` rather than `onClick`: it fires for a click and
                // also for tabbing in, so the count clears for someone who
                // never touches the mouse.
                onFocus={markRead}
                placeholder={`Message ${active.name.split(" ")[0]}`}
                aria-label="Message"
              />
              <Button
                type="submit"
                size="icon"
                className="h-10 w-10"
                disabled={pending}
                aria-label="Send message"
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </>
        ) : null}
      </div>
    </div>
  );
}
