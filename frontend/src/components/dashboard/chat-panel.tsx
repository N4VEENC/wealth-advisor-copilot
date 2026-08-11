import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { ChevronDown, Flag, MessageCircle, Send, ShieldCheck, Trash2, TriangleAlert } from "lucide-react"

import { NarrativeText } from "@/components/dashboard/narrative-text"
import { useCurrency } from "@/components/providers/currency-provider"
import {
  ApiError,
  deleteChatHistory,
  getChatHistory,
  getFlaggedMessages,
  postChatMessage,
  postFlagForReport,
  type ChatMessage,
  type ChatMode,
  type FlaggedMessage,
} from "@/lib/api"
import { cn } from "@/lib/utils"

// Same overlay pattern as clients-page.tsx's ModalOverlay (rgba(22,19,15,0.55)
// tint + blur, dismiss on backdrop click) — duplicated locally rather than
// extracted into a shared component, matching this app's existing convention
// of a page/section-local modal wrapper rather than a shared one.
function ConfirmOverlay({ children, onDismiss }: { children: ReactNode; onDismiss: () => void }) {
  return (
    <div
      // overflow-y-auto: without it, a dialog taller than the viewport is
      // centered but unreachable past its clipped top/bottom edges.
      className="fixed inset-0 z-[80] flex animate-in items-center justify-center overflow-y-auto p-8 fade-in-0 duration-150"
      style={{ background: "rgba(22, 19, 15, 0.55)", backdropFilter: "blur(3px)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDismiss()
      }}
    >
      {children}
    </div>
  )
}

function FlagConfirmDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <ConfirmOverlay onDismiss={onCancel}>
      <div className="w-full max-w-[420px] animate-in overflow-hidden rounded-[14px] border border-border bg-card fade-in-0 zoom-in-95 duration-150 shadow-[var(--shadow-elevated)]">
        <div className="flex flex-col gap-[3px] border-b border-border p-[20px_22px_16px]">
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">Flag for report reference?</span>
          <span className="text-[12px] text-muted-3">
            This marks the estimate as advisor-reviewed. It is never inserted into a report automatically — you
            still decide what, if anything, to reference when writing one.
          </span>
        </div>
        <div className="flex justify-end gap-2 p-[16px_22px_20px]">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border bg-card px-[13px] py-2 text-[12.5px] font-medium text-muted-foreground transition-transform duration-150 ease-out hover:scale-[1.02] active:scale-[0.98]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg border border-secondary bg-secondary px-3.5 py-2 text-[12.5px] font-medium text-secondary-foreground transition-transform duration-150 ease-out hover:scale-[1.02] active:scale-[0.98]"
          >
            Flag it
          </button>
        </div>
      </div>
    </ConfirmOverlay>
  )
}

function ThreeDots() {
  return (
    <span className="flex items-center gap-[3px]" aria-hidden="true">
      <span className="h-[5px] w-[5px] animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
      <span className="h-[5px] w-[5px] animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
      <span className="h-[5px] w-[5px] animate-bounce rounded-full bg-primary" />
    </span>
  )
}

function UserBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[78%] rounded-[10px] border border-border bg-card px-3.5 py-2.5 text-[12.5px] leading-[1.5] text-foreground shadow-[var(--shadow-card)]">
        {message.content}
      </div>
    </div>
  )
}

function AssistantBubble({
  message,
  onFlagClick,
}: {
  message: ChatMessage
  onFlagClick: (messageId: string) => void
}) {
  const { convertMentionsInText } = useCurrency()
  const isExploratory = message.mode === "exploratory"
  const sourceLabel = message.tools_used.length > 0 ? message.tools_used.join(" + ") : null

  return (
    <div className="flex justify-start">
      <div
        className={cn(
          "flex max-w-[85%] flex-col gap-1.5 rounded-[10px] border border-l-[3px] px-3.5 py-2.5",
          isExploratory ? "border-border border-l-secondary bg-secondary/10" : "border-border border-l-primary bg-accent"
        )}
      >
        <span
          className={cn(
            "inline-flex w-fit items-center rounded-[5px] px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.04em]",
            isExploratory ? "bg-secondary/15 text-secondary" : "bg-primary/15 font-mono text-primary"
          )}
        >
          {isExploratory ? "Estimate — not a verified calculation" : `Source: ${sourceLabel ?? "no tool matched"}`}
        </span>
        <NarrativeText text={convertMentionsInText(message.content)} />
        {isExploratory && (
          <>
            {message.flagged_for_report ? (
              <span className="mt-0.5 flex w-fit items-center gap-1 text-[11px] text-muted-3">
                <Flag aria-hidden="true" size={11} />
                Flagged for report reference
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onFlagClick(message.id)}
                className="mt-0.5 flex w-fit cursor-pointer items-center gap-1 rounded-[6px] border border-border bg-card px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted"
              >
                <Flag aria-hidden="true" size={11} />
                Flag for report reference
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// Same terracotta/estimate treatment as an exploratory AssistantBubble
// above — a flagged note is exactly that kind of message, just shown
// outside the conversation thread. Retrievable entirely on its own: this
// list has no connection to report generation, and renders whether or not
// the client has ever had a report generated at all.
function FlaggedNotesList({ notes }: { notes: FlaggedMessage[] }) {
  return (
    <div className="flex flex-col gap-2 border-t border-border bg-secondary/10 px-[18px] py-3">
      {notes.map((note) => (
        <div
          key={note.id}
          className="flex flex-col gap-1 rounded-[9px] border border-border border-l-[3px] border-l-secondary bg-card px-3 py-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex w-fit items-center rounded-[5px] bg-secondary/15 px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.04em] text-secondary">
              AI estimate — reviewed by advisor, not a verified calculation
            </span>
            <span className="shrink-0 text-[11px] text-muted-3">
              {new Date(note.flagged_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </span>
          </div>
          {note.prompted_by && <span className="text-[11.5px] font-medium text-muted-foreground">Q: {note.prompted_by}</span>}
          <p className="m-0 text-[12.5px] leading-[1.5] text-foreground">{note.content}</p>
        </div>
      ))}
    </div>
  )
}

export function ChatPanel({ clientId }: { clientId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [mode, setMode] = useState<ChatMode>("verified")
  const [inputText, setInputText] = useState("")
  const [sending, setSending] = useState(false)
  const [checkingTool, setCheckingTool] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flagTargetId, setFlagTargetId] = useState<string | null>(null)
  const [flaggedNotes, setFlaggedNotes] = useState<FlaggedMessage[]>([])
  const [notesExpanded, setNotesExpanded] = useState(false)
  const threadEndRef = useRef<HTMLDivElement>(null)

  function refreshFlaggedNotes() {
    getFlaggedMessages(clientId)
      .then((res) => setFlaggedNotes(res.flagged_messages))
      .catch(() => {
        // Same non-blocking treatment as chat history below — a fetch
        // failure just means the list stays whatever it last was, not a
        // panel-wide error.
      })
  }

  useEffect(() => {
    let cancelled = false
    setLoadingHistory(true)
    getChatHistory(clientId)
      .then((res) => {
        if (!cancelled) setMessages(res.messages)
      })
      .catch(() => {
        // No history yet (or a transient fetch failure) just means the
        // conversation starts empty — never blocks the rest of the panel.
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false)
      })
    setNotesExpanded(false)
    refreshFlaggedNotes()
    return () => {
      cancelled = true
    }
  }, [clientId])

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "nearest" })
  }, [messages, checkingTool])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const text = inputText.trim()
    if (!text || sending) return

    setSending(true)
    setError(null)
    setCheckingTool(null)
    setInputText("")

    try {
      await postChatMessage(clientId, text, mode, (event) => {
        switch (event.type) {
          case "user_message":
            setMessages((prev) => [...prev, event.message])
            break
          case "tool_call":
            setCheckingTool(event.tool_label)
            break
          case "tool_result":
            // Keep showing the indicator (it'll flip to the next tool's
            // label, or clear on "final") — a real multi-tool turn should
            // read as continuous progress, not a flicker to blank.
            break
          case "final":
            setMessages((prev) => [...prev, event.message])
            setCheckingTool(null)
            break
          case "error":
            setError(event.detail)
            setCheckingTool(null)
            break
        }
      })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send that message.")
      setCheckingTool(null)
    } finally {
      setSending(false)
    }
  }

  async function handleClearConversation() {
    if (!window.confirm("Clear this conversation? This can't be undone.")) return
    try {
      await deleteChatHistory(clientId)
      setMessages([])
      setError(null)
      setFlaggedNotes([]) // clearing history deletes every message, flagged ones included
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not clear the conversation.")
    }
  }

  async function handleConfirmFlag() {
    if (!flagTargetId) return
    const targetId = flagTargetId
    setFlagTargetId(null)
    try {
      const updated = await postFlagForReport(clientId, targetId)
      setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
      refreshFlaggedNotes()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not flag that message.")
    }
  }

  return (
    <div className="flex flex-col rounded-[12px] border border-border bg-card shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3 p-[16px_18px_14px]">
        <div className="flex items-start gap-2.5">
          <MessageCircle aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-foreground" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-medium text-foreground">Ask about this portfolio</span>
            <span className="text-[11.5px] text-muted-3">
              Verified mode only answers using real, already-computed portfolio data.
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex gap-1 rounded-[9px] bg-muted p-[3px]">
            <button
              type="button"
              onClick={() => setMode("verified")}
              aria-pressed={mode === "verified"}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-[7px] px-3 text-[12px] font-medium transition-colors",
                mode === "verified" ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground"
              )}
            >
              <ShieldCheck aria-hidden="true" size={13} />
              Verified
            </button>
            <button
              type="button"
              onClick={() => setMode("exploratory")}
              aria-pressed={mode === "exploratory"}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-[7px] px-3 text-[12px] font-medium transition-colors",
                mode === "exploratory" ? "bg-secondary text-secondary-foreground" : "bg-transparent text-muted-foreground"
              )}
            >
              <TriangleAlert aria-hidden="true" size={13} />
              Exploratory
            </button>
          </div>

          {flaggedNotes.length > 0 && (
            <button
              type="button"
              onClick={() => setNotesExpanded((v) => !v)}
              aria-expanded={notesExpanded}
              className="flex cursor-pointer items-center gap-1 text-[12px] font-medium text-secondary transition-colors hover:text-secondary/80"
            >
              <Flag aria-hidden="true" size={13} />
              Flagged notes ({flaggedNotes.length})
              <ChevronDown
                aria-hidden="true"
                size={13}
                className={cn("transition-transform duration-150", notesExpanded && "rotate-180")}
              />
            </button>
          )}

          <button
            type="button"
            onClick={handleClearConversation}
            className="flex cursor-pointer items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-destructive"
          >
            <Trash2 aria-hidden="true" size={13} />
            Clear conversation
          </button>
        </div>
      </div>

      {/* Retrievable entirely on its own — this list has no connection to
          report generation (see FlaggedNotesList's own docstring). */}
      {notesExpanded && flaggedNotes.length > 0 && <FlaggedNotesList notes={flaggedNotes} />}

      {mode === "exploratory" && (
        <div className="flex items-start gap-2 border-t border-border bg-secondary/10 px-[18px] py-2.5 text-[12px] text-secondary">
          <TriangleAlert aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
          <span>
            <strong className="font-semibold">Exploratory mode:</strong> answers may include AI estimates, not
            verified calculations. Nothing here is used in a report unless you explicitly review and flag it.
          </span>
        </div>
      )}

      {/* Nested sub-panel — a visually distinct, recessed box (bg-background,
          duller than the outer bg-card) that holds ONLY the conversation
          itself. Height-capped and internally scrollable so a long
          conversation never grows the whole Dashboard card — it stays a
          fixed-size window onto the last few exchanges, matching the
          screenshot's compact conversation area. */}
      <div className="border-t border-border p-[18px]">
        <div className="flex max-h-[300px] flex-col gap-3 overflow-y-auto rounded-[10px] border border-border bg-background p-3">
          {loadingHistory && <p className="text-[12px] text-muted-foreground">Loading conversation&hellip;</p>}

          {!loadingHistory && messages.length === 0 && (
            <p className="text-[12px] text-muted-3">Ask a question about this client's portfolio to get started.</p>
          )}

          {messages.map((message) =>
            message.role === "user" ? (
              <UserBubble key={message.id} message={message} />
            ) : (
              <AssistantBubble key={message.id} message={message} onFlagClick={setFlagTargetId} />
            )
          )}

          {sending && (
            <div className="flex w-fit items-center gap-2 rounded-[10px] border border-border bg-card px-3 py-2 text-[12px] text-muted-foreground">
              <ThreeDots />
              {checkingTool
                ? `Checking ${checkingTool}…`
                : mode === "exploratory"
                  ? "Generating a response…"
                  : "Analyzing your question…"}
            </div>
          )}

          {error && <p className="text-[12px] text-destructive">{error}</p>}

          <div ref={threadEndRef} />
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-border p-[14px_18px]">
        <input
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Ask a question about this client's portfolio…"
          disabled={sending}
          className="h-[38px] flex-1 rounded-[10px] border border-border bg-background px-3.5 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-70"
        />
        <button
          type="submit"
          disabled={!inputText.trim() || sending}
          className="flex h-[38px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[10px] border border-primary bg-primary px-4 text-[12.5px] font-medium text-primary-foreground transition-transform duration-150 ease-out hover:not-disabled:scale-[1.02] active:not-disabled:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Send aria-hidden="true" size={14} />
          Send
        </button>
      </form>

      {flagTargetId && <FlagConfirmDialog onCancel={() => setFlagTargetId(null)} onConfirm={handleConfirmFlag} />}
    </div>
  )
}
