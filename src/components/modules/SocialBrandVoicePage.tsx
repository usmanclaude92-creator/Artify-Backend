/** Brand Voice: how AI and the guardrails should write for this workspace, plus the approval mode. */
import React, { useEffect, useState } from "react";
import { Megaphone, X } from "lucide-react";
import { socialContentApi, type SocialBrandVoice } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useActiveWorkspace } from "../../context/ActiveWorkspaceContext";
import { hasPermission } from "../../lib/permissions";
import { Card, Button, Input, Select, LoadingState, ErrorState } from "../ui/ui";

const EMPTY: SocialBrandVoice = { toneDescriptors: [], audience: null, dos: [], donts: [], bannedWords: [], requiredDisclaimers: [], defaultHashtags: [], ctaPhrases: [], languages: ["en"] };

const ListField: React.FC<{ label: string; hint?: string; values: string[]; onChange: (v: string[]) => void; disabled: boolean; placeholder?: string }> = ({ label, hint, values, onChange, disabled, placeholder }) => {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  };
  const id = `bv-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
        {label}
      </label>
      {hint && <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{hint}</p>}
      <ul className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <li key={v} className="cc-field flex items-center gap-1 px-2 py-1 text-xs" style={{ color: "var(--text-primary)" }}>
            {v}
            {!disabled && (
              <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
                <X className="w-3 h-3" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {!disabled && (
        <div className="flex gap-2">
          <Input
            id={id}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder={placeholder ?? "Type and press Enter"}
          />
          <Button variant="secondary" onClick={add} disabled={!draft.trim()}>
            Add
          </Button>
        </div>
      )}
    </div>
  );
};

export const SocialBrandVoicePage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const { current } = useActiveWorkspace();
  const canEdit = hasPermission(user?.role.permissions, "social.accounts.manage");
  const isAdmin = user?.role.key === "ADMIN" || user?.role.key === "SUPER_ADMIN";
  const [voice, setVoice] = useState<SocialBrandVoice>(EMPTY);
  const [approvalMode, setApprovalMode] = useState<"ALWAYS_REQUIRE" | "AUTO_IF_GUARDRAILS_PASS">("ALWAYS_REQUIRE");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([socialContentApi.brandVoice(), socialContentApi.settings()])
      .then(([v, s]) => {
        if (cancelled) return;
        setVoice(v);
        setApprovalMode(s.approvalMode);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not load the brand voice."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [current?.organizationId]);

  const set = <K extends keyof SocialBrandVoice>(key: K, value: SocialBrandVoice[K]) => setVoice((v) => ({ ...v, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      setVoice(await socialContentApi.saveBrandVoice(voice));
      notify("Brand voice saved.", "success");
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not save the brand voice.", "error");
    } finally {
      setSaving(false);
    }
  };

  const changeMode = async (mode: "ALWAYS_REQUIRE" | "AUTO_IF_GUARDRAILS_PASS") => {
    try {
      await socialContentApi.saveSettings(mode);
      setApprovalMode(mode);
      notify("Approval mode updated.", "success");
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not change the approval mode.", "error");
    }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <Megaphone className="w-5 h-5" /> Brand Voice
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          How {current?.organizationName ?? "this workspace"} sounds on social. AI drafting follows it, and the guardrails enforce banned words and required disclaimers.
        </p>
      </div>

      <Card className="p-4 space-y-4">
        <ListField label="Tone" hint="e.g. friendly, confident, plain-spoken" values={voice.toneDescriptors} onChange={(v) => set("toneDescriptors", v)} disabled={!canEdit} />
        <div>
          <label htmlFor="bv-audience" className="block text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>
            Audience
          </label>
          <textarea id="bv-audience" rows={2} disabled={!canEdit} value={voice.audience ?? ""} onChange={(e) => set("audience", e.target.value || null)} className="cc-field w-full px-3 py-2 text-sm focus:outline-none" style={{ color: "var(--text-primary)" }} placeholder="Who are we talking to?" />
        </div>
        <ListField label="Do" values={voice.dos} onChange={(v) => set("dos", v)} disabled={!canEdit} />
        <ListField label="Don't" values={voice.donts} onChange={(v) => set("donts", v)} disabled={!canEdit} />
        <ListField label="Banned words" hint="Posts containing these words cannot be submitted or scheduled." values={voice.bannedWords} onChange={(v) => set("bannedWords", v)} disabled={!canEdit} />
        <ListField label="Required disclaimers" hint="Every post must contain each of these (exact wording)." values={voice.requiredDisclaimers} onChange={(v) => set("requiredDisclaimers", v)} disabled={!canEdit} />
        <ListField label="Default hashtags" values={voice.defaultHashtags} onChange={(v) => set("defaultHashtags", v)} disabled={!canEdit} placeholder="#brand" />
        <ListField label="Call-to-action phrases" values={voice.ctaPhrases} onChange={(v) => set("ctaPhrases", v)} disabled={!canEdit} />
        <ListField label="Languages" hint="Language codes, the first is the default (en, fr, pt-BR)." values={voice.languages} onChange={(v) => set("languages", v.length ? v : ["en"])} disabled={!canEdit} />
        {canEdit ? (
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save brand voice"}
          </Button>
        ) : (
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            You can view the brand voice but need the &ldquo;manage social accounts&rdquo; permission to edit it.
          </p>
        )}
      </Card>

      <Card className="p-4 space-y-2">
        <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
          Approval mode
        </h2>
        <label className="block text-xs" htmlFor="approval-mode" style={{ color: "var(--text-secondary)" }}>
          How posts get approved in this workspace
        </label>
        <Select id="approval-mode" value={approvalMode} disabled={!isAdmin || !canEdit} onChange={(e) => void changeMode(e.target.value as "ALWAYS_REQUIRE" | "AUTO_IF_GUARDRAILS_PASS")}>
          <option value="ALWAYS_REQUIRE">Always require approval (recommended)</option>
          <option value="AUTO_IF_GUARDRAILS_PASS">Auto-approve if guardrails pass</option>
        </Select>
        {!isAdmin && (
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            Only administrators can change this setting.
          </p>
        )}
      </Card>
    </div>
  );
};
