/** After OAuth for providers where one login manages several Pages: choose which ones to connect. Tokens never reach the browser. */
import React, { useState } from "react";
import { socialApi, type ConnectSelection } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { useToast } from "../../context/ToastContext";
import { Badge, Button, Modal } from "../ui/ui";
import { ProviderAvatar } from "./socialShared";

export const ConnectPagePicker: React.FC<{ selection: ConnectSelection | null; onClose: () => void; onConnected: () => void }> = ({ selection, ...rest }) =>
  selection ? <PickerBody key={selection.id} selection={selection} {...rest} /> : null;

const PickerBody: React.FC<{ selection: ConnectSelection; onClose: () => void; onConnected: () => void }> = ({ selection, onClose, onConnected }) => {
  const { notify } = useToast();
  // A single Page is preselected from the first render (state is keyed by the selection id).
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(selection.pages.length === 1 ? [selection.pages[0]!.externalId] : []));
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => setChosen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const connect = async () => {
    setBusy(true);
    try {
      const res = await socialApi.selectPages(selection.id, [...chosen]);
      notify(`${res.accounts.length} ${isIg ? "Instagram account" : "Page"}${res.accounts.length === 1 ? "" : "s"} connected.`, "success");
      res.warnings.forEach((w) => notify(w, "error"));
      onConnected();
      onClose();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not connect the selected Pages.", "error");
    } finally {
      setBusy(false);
    }
  };

  const isIg = selection.provider === "meta_instagram";
  return (
    <Modal open onClose={onClose} title={isIg ? "Choose Instagram accounts to connect" : "Choose Pages to connect"}>
      <div className="space-y-3">
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{isIg ? "Pick the Instagram professional accounts (each linked to a Facebook Page you manage) this workspace may publish to and read comments and messages from. You can connect more later." : "Pick the Facebook Pages this workspace may publish to and read messages from. You can connect more later."}</p>
        <ul className="space-y-2 max-h-[50vh] overflow-y-auto" aria-label={isIg ? "Instagram accounts you can connect" : "Pages you manage"}>
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
