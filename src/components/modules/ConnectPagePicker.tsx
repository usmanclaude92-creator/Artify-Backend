/** After OAuth for providers where one login manages several Pages: choose which ones to connect. Tokens never reach the browser. */
import React, { useEffect, useState } from "react";
import { socialApi, type ConnectSelection } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { useToast } from "../../context/ToastContext";
import { Badge, Button, Modal } from "../ui/ui";
import { ProviderAvatar } from "./socialShared";

export const ConnectPagePicker: React.FC<{ selection: ConnectSelection | null; onClose: () => void; onConnected: () => void }> = ({ selection, onClose, onConnected }) => {
  const { notify } = useToast();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => { setChosen(new Set(selection && selection.pages.length === 1 ? [selection.pages[0]!.externalId] : [])); }, [selection]);
  if (!selection) return null;

  const toggle = (id: string) => setChosen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const connect = async () => {
    setBusy(true);
    try {
      const res = await socialApi.selectPages(selection.id, [...chosen]);
      notify(`${res.accounts.length} Page${res.accounts.length === 1 ? "" : "s"} connected.`, "success");
      res.warnings.forEach((w) => notify(w, "error"));
      onConnected();
      onClose();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not connect the selected Pages.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Choose Pages to connect">
      <div className="space-y-3">
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Pick the Facebook Pages this workspace may publish to and read messages from. You can connect more later.</p>
        <ul className="space-y-2 max-h-[50vh] overflow-y-auto" aria-label="Pages you manage">
          {selection.pages.map((p) => (
            <li key={p.externalId}>
              <label className="flex items-start gap-3 rounded-xl p-2 cursor-pointer" style={{ background: "var(--bg-hover)" }}>
                <input type="checkbox" className="mt-2 w-4 h-4" checked={chosen.has(p.externalId)} onChange={() => toggle(p.externalId)} aria-label={`Connect ${p.name}`} />
                <ProviderAvatar account={{ displayName: p.name, avatarUrl: p.avatarUrl }} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 flex-wrap text-xs font-bold" style={{ color: "var(--text-primary)" }}>{p.name}{p.alreadyConnected && <Badge tone="info">Already connected</Badge>}</span>
                  {p.category && <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>{p.category}</span>}
                  {p.warnings.map((w) => <span key={w} className="block text-[11px]" style={{ color: "#b45309" }}>{w}</span>)}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || chosen.size === 0} onClick={() => void connect()}>Connect {chosen.size || ""} selected</Button>
        </div>
      </div>
    </Modal>
  );
};
