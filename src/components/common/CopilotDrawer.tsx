/**
 * Phase 15 — Reusable Copilot Drawer (imported from
 * usmanclaude92-creator/Artify-Backend---Google-AI-Studio-, commit
 * 4a1d7cd, then adapted — see docs/COPILOT_ARCHITECTURE.md). Embeddable
 * anywhere in the app for contextual AI assistance scoped to the current
 * module/entity. Adapted for this repo's UI kit, CSS-variable theming, and
 * `src/lib/copilotApi.ts`'s actual response shapes.
 */
import React, { useState } from "react";
import { Bot, X, Sparkles, Send } from "lucide-react";
import { Button } from "../ui/ui";
import { copilotApi, type CopilotMessage, type CopilotActionPreview } from "../../lib/copilotApi";
import { ApiClientError } from "../../lib/apiClient";
import { useToast } from "../../context/ToastContext";

export interface CopilotDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  contextModule: string;
  contextMetadata?: Record<string, unknown>;
  initialPrompt?: string;
}

export const CopilotDrawer: React.FC<CopilotDrawerProps> = ({ isOpen, onClose, contextModule, contextMetadata, initialPrompt }) => {
  const { notify } = useToast();
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [inputContent, setInputContent] = useState(initialPrompt || "");
  const [isSending, setIsSending] = useState(false);
  const [actionPreview, setActionPreview] = useState<CopilotActionPreview | null>(null);

  if (!isOpen) return null;

  const handleSend = async () => {
    const prompt = inputContent.trim();
    if (!prompt || isSending) return;
    setInputContent("");
    setIsSending(true);

    const tempMsg: CopilotMessage = {
      id: `temp-${Date.now()}`,
      conversationId: conversationId || "temp",
      role: "user",
      content: prompt,
      status: "COMPLETED",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      durationMs: 0,
      estimatedCost: 0,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempMsg]);

    try {
      const result = await copilotApi.sendMessage({
        conversationId,
        content: prompt,
        contextMetadata: { currentModule: contextModule, ...(contextMetadata || {}) },
      });

      setConversationId(result.conversationId);
      setMessages((prev) => [...prev.filter((m) => m.id !== tempMsg.id), result.userMessage, result.assistantMessage]);
      if (result.actionPreview) setActionPreview(result.actionPreview);
    } catch (err) {
      notify(err instanceof ApiClientError ? `Copilot failed: ${err.message}` : "Copilot failed.", "error");
      setMessages((prev) => prev.filter((m) => m.id !== tempMsg.id));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      className="fixed inset-y-0 right-0 w-96 z-50 flex flex-col border-l shadow-2xl"
      style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              Copilot
            </h3>
            <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              Context: {contextModule}
            </p>
          </div>
        </div>
        <button onClick={onClose} className="p-1 rounded-md" style={{ color: "var(--text-muted)" }} aria-label="Close Copilot">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
        {messages.length === 0 ? (
          <div className="text-center py-10" style={{ color: "var(--text-muted)" }}>
            <Bot className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="font-medium">How can I assist with this {contextModule} record?</p>
            <p className="text-[11px] mt-1">Ask questions, request summaries, or draft tasks.</p>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
              <div
                className="max-w-[85%] rounded-xl px-3 py-2 text-xs"
                style={m.role === "user" ? { background: "var(--accent)", color: "#fff" } : { background: "var(--bg-hover)", color: "var(--text-primary)" }}
              >
                {m.content}
              </div>
            </div>
          ))
        )}

        {actionPreview && (
          <div className="rounded-lg p-2.5 text-[11px]" style={{ border: "1px solid rgba(245,158,11,0.5)", background: "rgba(245,158,11,0.08)" }}>
            <span className="font-bold block mb-1" style={{ color: "#b45309" }}>
              Action preview: {actionPreview.actionType}
            </span>
            <p style={{ color: "var(--text-secondary)" }}>{actionPreview.changesSummary}</p>
          </div>
        )}

        {isSending && (
          <div className="text-[11px] flex items-center gap-1.5" style={{ color: "var(--accent)" }}>
            <Sparkles className="w-3.5 h-3.5 animate-pulse" />
            <span>Thinking…</span>
          </div>
        )}
      </div>

      <div className="p-3 border-t" style={{ borderColor: "var(--border)" }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={inputContent}
            onChange={(e) => setInputContent(e.target.value)}
            placeholder={`Ask about ${contextModule}…`}
            className="flex-1 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none"
            style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          />
          <Button type="submit" variant="primary" disabled={isSending}>
            <Send className="w-3.5 h-3.5" />
          </Button>
        </form>
      </div>
    </div>
  );
};
