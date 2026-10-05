/** Phase 13 — Client Documents: reuses the existing Media Library/storage pipeline (signed upload, server-side verification), associated with a Client (and optionally one onboarding record) rather than a second document system. */
import React, { useEffect, useState } from "react";
import { FileText, Upload, Download, Archive, Eye, EyeOff } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { mediaApi, type CmsMedia, type AllowedMediaMimeType } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

const ALLOWED_MIME_TYPES: AllowedMediaMimeType[] = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml", "application/pdf"];
const CATEGORY_OPTIONS = ["contract", "id_verification", "brand_assets", "deliverable", "invoice", "other"];

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  PENDING: "warning",
  ACTIVE: "success",
  FAILED: "danger",
  ARCHIVED: "neutral",
};

export const ClientDocumentsPanel: React.FC<{ clientId: string; onboardingId?: string }> = ({ clientId, onboardingId }) => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canUpload = hasPermission(user?.role.permissions, "media.upload");
  const canUpdate = hasPermission(user?.role.permissions, "media.update");
  const canDelete = hasPermission(user?.role.permissions, "media.delete");

  const [documents, setDocuments] = useState<CmsMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState(CATEGORY_OPTIONS[0]!);
  const [isClientVisible, setIsClientVisible] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await mediaApi.list({ clientId, onboardingId, limit: 50, sort: "createdAt", order: "desc" });
      setDocuments(res.items);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not load documents.");
    } finally {
      setLoading(false);
    }
  }, [clientId, onboardingId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUpload = async () => {
    if (!file) return;
    if (!ALLOWED_MIME_TYPES.includes(file.type as AllowedMediaMimeType)) {
      notify("Unsupported file type.", "error");
      return;
    }
    setUploading(true);
    try {
      const media = await mediaApi.uploadFile(file, { mimeType: file.type as AllowedMediaMimeType, clientId, onboardingId, documentCategory: category });
      if (isClientVisible) {
        await mediaApi.update(media.id, { isClientVisible: true });
      }
      notify("Document uploaded.", "success");
      setFile(null);
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not upload document.", "error");
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (media: CmsMedia) => {
    try {
      const { url } = await mediaApi.getReadUrl(media.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not open document.", "error");
    }
  };

  const handleToggleVisible = async (media: CmsMedia) => {
    try {
      await mediaApi.update(media.id, { isClientVisible: !media.isClientVisible });
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not update document.", "error");
    }
  };

  const handleArchive = async (media: CmsMedia) => {
    try {
      await mediaApi.archive(media.id);
      notify("Document archived.", "success");
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not archive document.", "error");
    }
  };

  return (
    <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
      <h3 className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
        Documents
      </h3>

      {canUpload && (
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <input
            type="file"
            accept={ALLOWED_MIME_TYPES.join(",")}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-xs"
            style={{ color: "var(--text-secondary)" }}
          />
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-40">
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={isClientVisible} onChange={(e) => setIsClientVisible(e.target.checked)} />
            Visible to client
          </label>
          <Button variant="primary" disabled={!file || uploading} onClick={() => void handleUpload()}>
            <Upload className="w-3.5 h-3.5" /> Upload
          </Button>
        </div>
      )}

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : documents.length === 0 ? (
        <EmptyState title="No documents" description="Upload a document for this client." />
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {documents.map((d) => (
            <li key={d.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
              <div className="min-w-0 flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--text-muted)" }} />
                <div className="min-w-0">
                  <p className="font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                    {d.displayName ?? d.originalFilename}
                  </p>
                  <p style={{ color: "var(--text-muted)" }}>
                    {d.documentCategory?.replace(/_/g, " ") ?? "uncategorized"} · {new Date(d.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge>
                {d.isClientVisible && <Badge tone="info">Client-visible</Badge>}
                <Button variant="ghost" onClick={() => void handleDownload(d)} aria-label="Download">
                  <Download className="w-3.5 h-3.5" />
                </Button>
                {canUpdate && (
                  <Button variant="ghost" onClick={() => void handleToggleVisible(d)} aria-label="Toggle client visibility">
                    {d.isClientVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </Button>
                )}
                {canDelete && d.status !== "ARCHIVED" && (
                  <Button variant="ghost" onClick={() => void handleArchive(d)} aria-label="Archive">
                    <Archive className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
