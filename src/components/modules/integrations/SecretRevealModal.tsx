/** Shows a one-time secret (webhook signing secret / API key). It exists only in this component's state — once closed it cannot be recovered. */
import React, { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Modal, Button } from "../../ui/ui";

export const SecretRevealModal: React.FC<{ title: string; label: string; secret: string | null; onClose: () => void }> = ({ title, label, secret, onClose }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret ?? "");
      setCopied(true);
    } catch {
      setCopied(false); // clipboard unavailable — the value stays selectable below
    }
  };
  return (
    <Modal open={!!secret} onClose={onClose} title={title}>
      <div className="space-y-3">
        <div className="text-xs rounded-lg px-3 py-2 bg-amber-500/10 text-amber-600 border border-amber-500/30">
          Copy this {label} now. For your security it is shown only once and cannot be retrieved later — if you lose it, rotate or recreate it.
        </div>
        <code data-testid="one-time-secret" className="block break-all text-xs p-3 rounded-lg select-all" style={{ background: "var(--bg-hover)", color: "var(--text-primary)" }}>
          {secret}
        </code>
        <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
          <Button variant="secondary" onClick={() => void copy()}>
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="primary" onClick={onClose}>
            I have saved it
          </Button>
        </div>
      </div>
    </Modal>
  );
};
