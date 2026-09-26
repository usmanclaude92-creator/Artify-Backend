/**
 * Phase 15 — AI Copilot & Conversational Workspace (imported from
 * usmanclaude92-creator/Artify-Backend---Google-AI-Studio-, commit
 * 4a1d7cd, then adapted — see docs/COPILOT_ARCHITECTURE.md). Adapted for
 * this repo's UI kit (Card/Button/Badge/Modal/Field from
 * ../../ui/ui, CSS-variable theming, `notify(message, kind)`) and its
 * actual Copilot API response shapes (src/lib/copilotApi.ts) — citations
 * here carry `documentTitle`/`similarityScore`, not the source's
 * `collectionName`/`snippet` pair.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  Bot,
  Send,
  Plus,
  Archive,
  Trash2,
  AlertTriangle,
  FileText,
  Coins,
  Sparkles,
  ChevronRight,
  MessageSquare,
  Wrench,
  Sliders,
} from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import { useToast } from "../../../context/ToastContext";
import { hasPermission } from "../../../lib/permissions";
import { copilotApi, type CopilotWorkspace, type CopilotConversation, type CopilotMessage, type CopilotActionPreview, type CopilotResponseMode } from "../../../lib/copilotApi";
import { ApiClientError } from "../../../lib/apiClient";
import { Button, Badge, Modal, Field, Input, LoadingState, ErrorState } from "../../ui/ui";

const PROMPT_SUGGESTIONS: Record<string, string[]> = {
  "general-assistant": [
    "What are our security compliance standards?",
    "Summarize open organizational tasks",
    "List recent enterprise activity",
    "Create a task: Review security protocol",
  ],
  "crm-assistant": [
    "Search clients with name matching 'Acme'",
    "Breakdown leads by status",
    "Create a task: Schedule follow-up with client",
  ],
  "billing-assistant": [
    "List overdue invoices requiring follow-up",
    "What is our total outstanding invoice balance?",
    "Create a task: Send payment reminder to overdue accounts",
  ],
  "operations-assistant": [
    "Check recent workflow execution statuses",
    "How many automated tasks are pending?",
    "List all background schedules",
  ],
  "knowledge-assistant": [
    "Search documents for our data retention policy",
    "Explain our customer onboarding SLA",
    "List indexed documents in our knowledge base",
  ],
};

const RESPONSE_MODES: CopilotResponseMode[] = ["ANSWER", "EXPLAIN", "SUMMARIZE", "ANALYZE", "RECOMMEND", "DRAFT", "EXECUTE"];

export const AiCopilotPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canManage = hasPermission(user?.role.permissions, "copilot.manage") || hasPermission(user?.role.permissions, "copilot.admin");

  const [workspaces, setWorkspaces] = useState<CopilotWorkspace[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<CopilotWorkspace | null>(null);
  const [conversations, setConversations] = useState<CopilotConversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<CopilotConversation | null>(null);
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [actionPreviews, setActionPreviews] = useState<CopilotActionPreview[]>([]);

  const [inputContent, setInputContent] = useState("");
  const [selectedMode, setSelectedMode] = useState<CopilotResponseMode>("ANSWER");
  const [filterStatus, setFilterStatus] = useState<"ACTIVE" | "ARCHIVED">("ACTIVE");
  const [isSending, setIsSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmingActionId, setConfirmingActionId] = useState<string | null>(null);

  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [newWsName, setNewWsName] = useState("");
  const [newWsDescription, setNewWsDescription] = useState("");
  const [newWsInstruction, setNewWsInstruction] = useState("");
  const [newWsTemperature, setNewWsTemperature] = useState(0.7);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [wsRes, convRes] = await Promise.all([copilotApi.listWorkspaces(), copilotApi.listConversations({ status: filterStatus, limit: 30 })]);

      const wsList = wsRes.workspaces || [];
      setWorkspaces(wsList);
      setSelectedWorkspace((prev) => prev ?? wsList.find((w) => w.isDefault) ?? wsList[0] ?? null);

      const convList = convRes.conversations || [];
      setConversations(convList);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to load Copilot workspaces.");
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (selectedWorkspace) setSelectedMode(selectedWorkspace.defaultMode || "ANSWER");
  }, [selectedWorkspace]);

  const selectConversation = async (conversationId: string) => {
    try {
      const res = await copilotApi.getConversation(conversationId);
      const conv = res.conversation;
      setActiveConversation(conv);
      setMessages(conv.messages || []);
      setActionPreviews((conv.actionPreviews || []).filter((a) => a.status === "PENDING"));
      if (conv.workspace) setSelectedWorkspace(conv.workspace);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Failed to load conversation.", "error");
    }
  };

  const handleStartNewChat = async (workspace?: CopilotWorkspace) => {
    const ws = workspace || selectedWorkspace;
    if (!ws) return;
    try {
      const res = await copilotApi.createConversation({ workspaceId: ws.id, title: "New AI Conversation" });
      setConversations((prev) => [res.conversation, ...prev]);
      setActiveConversation(res.conversation);
      setMessages([]);
      setActionPreviews([]);
      setSelectedWorkspace(ws);
      notify(`Started conversation in ${ws.name}.`, "success");
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Failed to create conversation.", "error");
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const prompt = (textToSend ?? inputContent).trim();
    if (!prompt || isSending) return;

    setInputContent("");
    setIsSending(true);

    const tempUserMsg: CopilotMessage = {
      id: `temp-${Date.now()}`,
      conversationId: activeConversation?.id || "temp",
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
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const result = await copilotApi.sendMessage({
        conversationId: activeConversation?.id,
        workspaceId: selectedWorkspace?.id,
        content: prompt,
        mode: selectedMode,
      });

      setMessages((prev) => [...prev.filter((m) => m.id !== tempUserMsg.id), result.userMessage, result.assistantMessage]);

      if (result.actionPreview) {
        setActionPreviews((prev) => [result.actionPreview as CopilotActionPreview, ...prev.filter((a) => a.id !== result.actionPreview!.id)]);
      }

      if (!activeConversation || activeConversation.id !== result.conversationId) {
        await selectConversation(result.conversationId);
        const convsRes = await copilotApi.listConversations({ status: filterStatus });
        setConversations(convsRes.conversations || []);
      } else {
        setConversations((prev) =>
          prev.map((c) => (c.id === result.conversationId ? { ...c, lastMessageAt: new Date().toISOString(), title: prompt.slice(0, 40) } : c))
        );
      }
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Message failed to send.", "error");
      setMessages((prev) => prev.map((m) => (m.id === tempUserMsg.id ? { ...m, status: "FAILED" } : m)));
    } finally {
      setIsSending(false);
    }
  };

  const handleConfirmAction = async (previewId: string) => {
    setConfirmingActionId(previewId);
    try {
      await copilotApi.confirmAction(previewId);
      notify("Action executed successfully.", "success");
      setActionPreviews((prev) => prev.filter((a) => a.id !== previewId));
      if (activeConversation) {
        const refreshed = await copilotApi.getConversation(activeConversation.id);
        setMessages(refreshed.conversation.messages || []);
      }
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Action failed.", "error");
    } finally {
      setConfirmingActionId(null);
    }
  };

  const handleRejectAction = async (previewId: string) => {
    try {
      await copilotApi.rejectAction(previewId);
      notify("Action was cancelled.", "info");
      setActionPreviews((prev) => prev.filter((a) => a.id !== previewId));
      if (activeConversation) {
        const refreshed = await copilotApi.getConversation(activeConversation.id);
        setMessages(refreshed.conversation.messages || []);
      }
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Failed to cancel action.", "error");
    }
  };

  const handleArchiveConversation = async (convId: string) => {
    try {
      await copilotApi.archiveConversation(convId);
      notify("Conversation archived.", "success");
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (activeConversation?.id === convId) {
        setActiveConversation(null);
        setMessages([]);
      }
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Archive failed.", "error");
    }
  };

  const handleDeleteConversation = async (convId: string) => {
    if (!window.confirm("Delete this conversation permanently?")) return;
    try {
      await copilotApi.deleteConversation(convId);
      notify("Conversation deleted.", "success");
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (activeConversation?.id === convId) {
        setActiveConversation(null);
        setMessages([]);
      }
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Delete failed.", "error");
    }
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWsName.trim()) return;
    setCreatingWorkspace(true);
    try {
      const res = await copilotApi.createWorkspace({
        name: newWsName.trim(),
        description: newWsDescription.trim() || undefined,
        systemInstruction: newWsInstruction.trim() || undefined,
        temperature: newWsTemperature,
        requiredPermissions: ["copilot.use"],
      });
      notify(`Workspace "${res.workspace.name}" created.`, "success");
      setShowWorkspaceModal(false);
      setNewWsName("");
      setNewWsDescription("");
      setNewWsInstruction("");
      await load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Failed to create workspace.", "error");
    } finally {
      setCreatingWorkspace(false);
    }
  };

  const currentSuggestions = selectedWorkspace ? PROMPT_SUGGESTIONS[selectedWorkspace.slug] || PROMPT_SUGGESTIONS["general-assistant"] : [];

  if (loading && workspaces.length === 0) return <LoadingState />;
  if (error && workspaces.length === 0) return <ErrorState message={error} />;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] gap-4">
      <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              AI Copilot
              <Badge tone="info">Phase 15</Badge>
            </h1>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Grounded conversational assistant with RBAC-scoped workspaces, tool safety preview, and citation-backed answers.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <Button variant="secondary" onClick={() => setShowWorkspaceModal(true)}>
              <Sliders className="w-3.5 h-3.5" /> Custom workspace
            </Button>
          )}
          <Button variant="primary" onClick={() => void handleStartNewChat()} disabled={!selectedWorkspace}>
            <Plus className="w-4 h-4" /> New chat
          </Button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-4 min-h-0">
        {/* Sidebar */}
        <div className="md:col-span-3 flex flex-col gap-3 min-h-0 rounded-2xl border p-3" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
          <div>
            <label className="text-[11px] font-semibold block mb-1" style={{ color: "var(--text-muted)" }}>
              Active workspace
            </label>
            <select
              className="w-full text-xs font-medium rounded-lg px-2.5 py-2 focus:outline-none"
              style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
              value={selectedWorkspace?.id || ""}
              onChange={(e) => {
                const ws = workspaces.find((w) => w.id === e.target.value);
                if (ws) void handleStartNewChat(ws);
              }}
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                  {ws.isDefault ? " ★" : ""}
                </option>
              ))}
            </select>
            {selectedWorkspace?.description && (
              <p className="text-[11px] mt-1 line-clamp-2" style={{ color: "var(--text-muted)" }}>
                {selectedWorkspace.description}
              </p>
            )}
          </div>

          <hr style={{ borderColor: "var(--border)" }} />

          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold" style={{ color: "var(--text-muted)" }}>
              Conversations
            </span>
            <div className="flex gap-1">
              {(["ACTIVE", "ARCHIVED"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setFilterStatus(s)}
                  className="px-2 py-0.5 rounded text-[11px] font-medium transition"
                  style={
                    filterStatus === s
                      ? { background: "var(--accent-soft)", color: "var(--accent)" }
                      : { color: "var(--text-muted)" }
                  }
                >
                  {s === "ACTIVE" ? "Active" : "Archived"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1 pr-1 text-xs min-h-0">
            {conversations.length === 0 ? (
              <div className="py-8 text-center" style={{ color: "var(--text-muted)" }}>
                <MessageSquare className="w-6 h-6 mx-auto mb-1 opacity-50" />
                <p>No conversations found.</p>
              </div>
            ) : (
              conversations.map((conv) => {
                const isActive = activeConversation?.id === conv.id;
                return (
                  <div
                    key={conv.id}
                    onClick={() => void selectConversation(conv.id)}
                    className="group flex items-center justify-between p-2 rounded-lg cursor-pointer transition"
                    style={
                      isActive
                        ? { background: "var(--accent-soft)", color: "var(--text-primary)", border: "1px solid var(--accent)" }
                        : { color: "var(--text-secondary)" }
                    }
                  >
                    <div className="flex-1 min-w-0 pr-2">
                      <p className="font-medium truncate">{conv.title}</p>
                      <p className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
                        {new Date(conv.lastMessageAt).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    <div className="hidden group-hover:flex items-center gap-1 opacity-80">
                      {conv.status === "ACTIVE" ? (
                        <button
                          type="button"
                          title="Archive"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleArchiveConversation(conv.id);
                          }}
                          className="p-1 rounded"
                        >
                          <Archive className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          title="Delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeleteConversation(conv.id);
                          }}
                          className="p-1 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Chat stream */}
        <div className="md:col-span-9 flex flex-col min-h-0 rounded-2xl border overflow-hidden" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: "var(--border)" }}>
            <div>
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {selectedWorkspace?.name || "General Assistant"}
              </h2>
              <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                <span>Mode: {selectedMode}</span>
                <span>•</span>
                <span>Grounding: {selectedWorkspace?.requireCitations ? "Citations active" : "Direct"}</span>
              </div>
            </div>
            <select
              value={selectedMode}
              onChange={(e) => setSelectedMode(e.target.value as CopilotResponseMode)}
              className="text-xs rounded-md px-2 py-1 focus:outline-none"
              style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            >
              {RESPONSE_MODES.map((m) => (
                <option key={m} value={m}>
                  {m.charAt(0) + m.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-12 text-center max-w-lg mx-auto">
                <div className="p-4 rounded-2xl mb-3" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                  <Bot className="w-8 h-8" />
                </div>
                <h3 className="text-base font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
                  {selectedWorkspace?.name}
                </h3>
                <p className="text-xs mb-6" style={{ color: "var(--text-muted)" }}>
                  {selectedWorkspace?.systemInstruction?.slice(0, 150) || "Ready to assist with secure enterprise knowledge."}
                </p>
                <div className="w-full flex flex-col gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-left" style={{ color: "var(--text-muted)" }}>
                    Suggested inquiries
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
                    {currentSuggestions.map((sug) => (
                      <button
                        key={sug}
                        type="button"
                        onClick={() => void handleSendMessage(sug)}
                        className="p-2.5 text-xs rounded-lg text-left flex items-start justify-between gap-1 group transition"
                        style={{ background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
                      >
                        <span>{sug}</span>
                        <ChevronRight className="w-3.5 h-3.5 opacity-40 group-hover:opacity-100 shrink-0 mt-0.5" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                  <div className="flex items-center gap-2 mb-1 text-[11px] px-1" style={{ color: "var(--text-muted)" }}>
                    <span className="font-semibold" style={{ color: "var(--text-secondary)" }}>
                      {msg.role === "user" ? "You" : selectedWorkspace?.name || "Copilot"}
                    </span>
                    <span>•</span>
                    <span>{new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    {msg.role === "assistant" && msg.totalTokens > 0 && (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]" style={{ background: "var(--bg-hover)" }}>
                        <Coins className="w-2.5 h-2.5" /> {msg.totalTokens} tokens
                      </span>
                    )}
                  </div>

                  <div
                    className="max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed"
                    style={
                      msg.role === "user"
                        ? { background: "var(--accent)", color: "#fff", borderBottomRightRadius: 0 }
                        : { background: "var(--bg-hover)", color: "var(--text-primary)", border: "1px solid var(--border)", borderBottomLeftRadius: 0 }
                    }
                  >
                    <div className="whitespace-pre-wrap">{msg.content}</div>

                    {msg.citations && msg.citations.length > 0 && (
                      <div className="mt-3 pt-2.5 border-t" style={{ borderColor: "var(--border)" }}>
                        <span className="text-[11px] font-semibold block mb-1.5 flex items-center gap-1" style={{ color: "var(--accent)" }}>
                          <FileText className="w-3 h-3" /> Grounded citations ({msg.citations.length})
                        </span>
                        <div className="space-y-1.5">
                          {msg.citations.map((c, idx) => (
                            <div key={idx} className="p-2 rounded text-[11px]" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
                              <div className="font-semibold flex items-center justify-between gap-2">
                                <span>{c.documentTitle}</span>
                                <Badge tone="neutral">{Math.round(c.similarityScore * 100)}% match</Badge>
                              </div>
                              {c.sectionHeading && (
                                <p className="mt-0.5 italic" style={{ color: "var(--text-muted)" }}>
                                  {c.sectionHeading}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="mt-2.5 pt-2 border-t flex flex-wrap gap-1.5" style={{ borderColor: "var(--border)" }}>
                        {msg.toolCalls.map((tc, idx) => (
                          <div
                            key={idx}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium"
                            style={{ background: "rgba(16,185,129,0.1)", color: "#10b981", border: "1px solid rgba(16,185,129,0.3)" }}
                          >
                            <Wrench className="w-2.5 h-2.5" /> {tc.tool}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}

            {actionPreviews.map((preview) => {
              const isExecuting = confirmingActionId === preview.id;
              return (
                <div
                  key={preview.id}
                  className="border-2 rounded-xl p-4 my-3 text-xs"
                  style={{ borderColor: "rgba(245,158,11,0.5)", background: "rgba(245,158,11,0.06)" }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" style={{ color: "#f59e0b" }} />
                      <div>
                        <span className="font-bold uppercase tracking-wider text-[11px]" style={{ color: "var(--text-primary)" }}>
                          Action preview: {preview.actionType}
                        </span>
                        {preview.targetEntity && (
                          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                            Target: {preview.targetEntity}
                          </p>
                        )}
                      </div>
                    </div>
                    <Badge tone="warning">{preview.status}</Badge>
                  </div>

                  <p className="font-medium mb-2" style={{ color: "var(--text-primary)" }}>
                    {preview.changesSummary}
                  </p>
                  {preview.reason && (
                    <p className="text-[11px] italic mb-3" style={{ color: "var(--text-muted)" }}>
                      Reason: {preview.reason}
                    </p>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-2 border-t" style={{ borderColor: "rgba(245,158,11,0.3)" }}>
                    <Button variant="secondary" disabled={isExecuting} onClick={() => void handleRejectAction(preview.id)}>
                      Cancel action
                    </Button>
                    <Button variant="primary" disabled={isExecuting} onClick={() => void handleConfirmAction(preview.id)}>
                      {isExecuting ? "Executing…" : "Confirm & execute"}
                    </Button>
                  </div>
                </div>
              );
            })}

            {isSending && (
              <div className="flex items-center gap-2 text-xs p-2" style={{ color: "var(--accent)" }}>
                <Sparkles className="w-4 h-4 animate-pulse" />
                <span>Generating grounded response…</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className="p-3 border-t" style={{ borderColor: "var(--border)" }}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSendMessage();
              }}
              className="flex items-end gap-2"
            >
              <div className="flex-1 rounded-xl p-2" style={{ background: "var(--bg-app)", border: "1px solid var(--border)" }}>
                <textarea
                  value={inputContent}
                  onChange={(e) => setInputContent(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSendMessage();
                    }
                  }}
                  rows={2}
                  placeholder={`Ask ${selectedWorkspace?.name || "Copilot"} anything… (Enter to send)`}
                  className="w-full text-xs bg-transparent border-0 resize-none focus:outline-none"
                  style={{ color: "var(--text-primary)" }}
                />
              </div>
              <Button type="submit" variant="primary" disabled={!inputContent.trim() || isSending}>
                <Send className="w-4 h-4" />
              </Button>
            </form>
          </div>
        </div>
      </div>

      <Modal open={showWorkspaceModal} onClose={() => setShowWorkspaceModal(false)} title="Create custom AI workspace">
        <form onSubmit={handleCreateWorkspace} className="space-y-3">
          <Field label="Workspace name">
            <Input required value={newWsName} onChange={(e) => setNewWsName(e.target.value)} placeholder="e.g. Legal Compliance Assistant" />
          </Field>
          <Field label="Description (optional)">
            <Input value={newWsDescription} onChange={(e) => setNewWsDescription(e.target.value)} placeholder="Specialized assistant for contract review" />
          </Field>
          <Field label="System instruction (optional)">
            <textarea
              value={newWsInstruction}
              onChange={(e) => setNewWsInstruction(e.target.value)}
              rows={3}
              className="w-full text-xs rounded-lg p-2 focus:outline-none"
              style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
              placeholder="You are an expert legal advisor for this organization…"
            />
          </Field>
          <Field label={`Creativity / temperature (${newWsTemperature})`}>
            <input type="range" min="0" max="1" step="0.1" value={newWsTemperature} onChange={(e) => setNewWsTemperature(parseFloat(e.target.value))} className="w-full" />
          </Field>
          <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
            <Button type="button" variant="secondary" onClick={() => setShowWorkspaceModal(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={creatingWorkspace}>
              Create workspace
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
