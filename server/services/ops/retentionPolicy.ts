/**
 * Retention policy per data class, in ONE table (Step 13). Purge jobs read their cutoff from here, and a test proves every entry that names a
 * purge job has one. `retentionDays: null` means "kept until erased on request or reviewed by an admin": there is deliberately no automatic purge.
 * These numbers are proposed defaults and are the owner's decision; see docs/OPERATIONS.md.
 */
export interface RetentionEntry {
  key: string;
  dataClass: string;
  tables: string[];
  retentionDays: number | null;
  /** Plain-language basis/purpose. */
  basis: string;
  /** Name of the purge job in retentionService.PURGE_JOBS, or null when nothing is purged automatically. */
  purgeJob: string | null;
  /** Where the retention number comes from. */
  setBy: "policy" | "workspace setting" | "env";
}

export const RETENTION_POLICY: RetentionEntry[] = [
  { key: "social_inbox", dataClass: "Social inbox conversations and messages", tables: ["social_messages", "social_conversations"], retentionDays: 180, basis: "Customer support context; shorter is better for private messages. Per-workspace setting (7 to 3650 days), default 180.", purgeJob: "social_inbox", setBy: "workspace setting" },
  { key: "analytics_events", dataClass: "Website analytics events (page views, form events)", tables: ["analytics_events"], retentionDays: 395, basis: "13 months of history for year-over-year comparison. Events hold a random per-tab session id and UTM data, no names or emails.", purgeJob: "analytics_events", setBy: "policy" },
  { key: "sessions", dataClass: "Expired or revoked login sessions", tables: ["sessions"], retentionDays: 30, basis: "Security investigation window after a session ends.", purgeJob: "sessions", setBy: "policy" },
  { key: "preview_tokens", dataClass: "Expired landing page preview links", tables: ["landing_preview_tokens"], retentionDays: 30, basis: "Hashes only; no value after expiry.", purgeJob: "preview_tokens", setBy: "policy" },
  { key: "critical_exports", dataClass: "Encrypted critical-data exports", tables: ["data_exports"], retentionDays: 30, basis: "Backup copies; newest three are always kept. Configurable with BACKUP_EXPORT_RETENTION_DAYS (minimum 7).", purgeJob: "critical_exports", setBy: "env" },
  { key: "leads_contacts_clients", dataClass: "CRM leads, contacts and clients", tables: ["leads", "contacts", "clients"], retentionDays: null, basis: "Kept while the relationship or enquiry is active; erased on a verified request. Review at least yearly.", purgeJob: null, setBy: "policy" },
  { key: "form_submissions", dataClass: "Form and landing page submissions (incl. IP address and user agent)", tables: ["form_submissions"], retentionDays: null, basis: "Kept with the lead they created; erased with the person on request.", purgeJob: null, setBy: "policy" },
  { key: "consent_records", dataClass: "Consent register (source, status, time, IDs only)", tables: ["consent_records"], retentionDays: null, basis: "Proof of consent. Holds no personal data, so it is kept after an erasure.", purgeJob: null, setBy: "policy" },
  { key: "audit_logs", dataClass: "Audit log", tables: ["audit_logs"], retentionDays: null, basis: "Security and accountability record; privacy entries are immutable. No automatic purge.", purgeJob: null, setBy: "policy" },
  { key: "privacy_requests", dataClass: "Privacy request records (pseudonymous, no personal data)", tables: ["privacy_requests"], retentionDays: null, basis: "Evidence that a request was handled.", purgeJob: null, setBy: "policy" },
];
