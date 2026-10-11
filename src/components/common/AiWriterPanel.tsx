/** "Write with AI" box for the CMS editors. It only fills the form fields; nothing is saved until the editor presses Save, and the last fill can be undone. */
import React, { useState } from "react";
import { Sparkles, Undo2 } from "lucide-react";
import { ApiClientError } from "../../lib/apiClient";
import type { AiWriterTone } from "../../lib/api";
import { Button, Select } from "../ui/ui";

export interface AiWriterOptions { brief: string; tone: AiWriterTone; length: "short" | "medium" | "long" }

export const AiWriterPanel: React.FC<{
  kind: "article" | "product";
  /** Calls the API and fills the form; returns a function that restores the previous values. */
  onGenerate: (o: AiWriterOptions) => Promise<() => void>;
  hasContent: boolean;
}> = ({ kind, onGenerate, hasContent }) => {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [tone, setTone] = useState<AiWriterTone>("professional");
  const [length, setLength] = useState<"short" | "medium" | "long">("medium");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<(() => void) | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      setUndo(null);
      const restore = await onGenerate({ brief: brief.trim(), tone, length });
      setUndo(() => restore);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "AI writing is not available right now.");
    } finally {
      setBusy(false);
    }
  };

  const label = (text: string, htmlFor: string) => <label htmlFor={htmlFor} className="block text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>{text}</label>;

  return (
    <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: "var(--border)", background: "var(--bg-app)" }}>
      <button type="button" className="flex items-center gap-2 text-sm font-bold w-full text-left" style={{ color: "var(--text-primary)" }} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Sparkles className="w-4 h-4" style={{ color: "var(--accent)" }} /> Write with AI
        <span className="ml-auto text-[11px] font-normal" style={{ color: "var(--text-muted)" }}>{open ? "Hide" : "Draft from a short brief"}</span>
      </button>
      {open && (
        <div className="space-y-2">
          {label(kind === "article" ? "What should this article cover?" : "Describe it: what it is, who it is for, what it does", "ai-writer-brief")}
          <textarea
            id="ai-writer-brief" rows={4} value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={4000}
            className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none" style={{ background: "var(--bg-surface, var(--bg-app))", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            placeholder={kind === "article" ? "e.g. How small clinics can use an AI chatbot to answer appointment questions after hours. Mention setup time of one week." : "e.g. AI chatbot package for small businesses: answers customers 24/7 on website and WhatsApp, set up in a week, includes monthly reporting."}
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              {label("Tone", "ai-writer-tone")}
              <Select id="ai-writer-tone" className="w-full" value={tone} onChange={(e) => setTone(e.target.value as AiWriterTone)}>
                <option value="professional">Professional</option><option value="friendly">Friendly</option><option value="persuasive">Persuasive</option><option value="technical">Technical</option>
              </Select>
            </div>
            {kind === "article" && (
              <div>
                {label("Length", "ai-writer-length")}
                <Select id="ai-writer-length" className="w-full" value={length} onChange={(e) => setLength(e.target.value as "short" | "medium" | "long")}>
                  <option value="short">Short (~400 words)</option><option value="medium">Medium (~800 words)</option><option value="long">Long (~1,400 words)</option>
                </Select>
              </div>
            )}
          </div>
          {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30" role="alert">{error}</div>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="primary" disabled={busy || brief.trim().length < 10} onClick={() => void generate()}>
              <Sparkles className="w-3.5 h-3.5" /> {busy ? "Writing…" : "Write with AI"}
            </Button>
            {undo && <Button type="button" variant="ghost" onClick={() => { undo(); setUndo(null); }}><Undo2 className="w-3.5 h-3.5" /> Undo AI changes</Button>}
          </div>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {hasContent ? "This replaces the fields below (you can undo). " : ""}The AI uses only the facts you give it, in your brand voice. Review every line before saving: it can still get things wrong.
          </p>
        </div>
      )}
    </div>
  );
};
