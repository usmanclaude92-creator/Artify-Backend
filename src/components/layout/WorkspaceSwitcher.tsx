/** Workspace switcher shown at the top of the sidebar. Renders nothing unless the user belongs to more than one workspace. */
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { Building2, Check, ChevronsUpDown, Search } from "lucide-react";
import { useActiveWorkspace } from "../../context/ActiveWorkspaceContext";

const SEARCH_THRESHOLD = 6;

export const WorkspaceSwitcher: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { workspaces, current, canSwitch, switching, switchTo } = useActiveWorkspace();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? workspaces.filter((w) => w.organizationName.toLowerCase().includes(q)) : workspaces;
  }, [workspaces, query]);

  const close = (returnFocus = true) => {
    setOpen(false);
    setQuery("");
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    setActiveIndex(Math.max(0, filtered.findIndex((w) => w.isCurrent)));
    const t = setTimeout(() => (searchRef.current ?? panelRef.current?.querySelector<HTMLElement>("[role=option]"))?.focus(), 0);
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node) && !triggerRef.current?.contains(e.target as Node)) close(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", onDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!canSwitch || !current) return null;

  const choose = async (id: string) => {
    close();
    if (id !== current.organizationId) await switchTo(id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered[activeIndex]) {
      e.preventDefault();
      void choose(filtered[activeIndex]!.organizationId);
    }
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Workspace: ${current.organizationName}. Switch workspace`}
        disabled={switching}
        className={`cc-field flex items-center gap-2 text-left disabled:opacity-60 ${compact ? "w-10 h-10 justify-center" : "w-full px-2.5 py-2"}`}
      >
        <span className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 text-[11px] font-bold" style={{ background: "var(--accent-soft)", color: "var(--accent-soft-text)" }}>
          {compact ? current.organizationName.charAt(0).toUpperCase() : <Building2 className="w-3.5 h-3.5" />}
        </span>
        {!compact && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                {current.organizationName}
              </span>
              <span className="block text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
                {current.roleName}
              </span>
            </span>
            <ChevronsUpDown className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--text-muted)" }} />
          </>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          onKeyDown={onKeyDown}
          className={`cc-popover z-50 py-1 ${compact ? "fixed left-[4.25rem] top-16 w-64" : "absolute left-0 right-0 mt-1"}`}
        >
          {workspaces.length > SEARCH_THRESHOLD && (
            <div className="px-2 pb-1 relative">
              <Search className="w-3.5 h-3.5 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-muted)" }} />
              <input
                ref={searchRef}
                type="search"
                aria-label="Search workspaces"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                placeholder="Search workspaces…"
                className="cc-field w-full pl-7 pr-2 py-1.5 text-xs focus:outline-none"
                style={{ color: "var(--text-primary)" }}
              />
            </div>
          )}
          <ul id={listId} role="listbox" aria-label="Workspaces" className="max-h-64 overflow-y-auto">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
                No workspaces match.
              </li>
            )}
            {filtered.map((w, i) => (
              <li
                key={w.organizationId}
                role="option"
                aria-selected={w.isCurrent}
                tabIndex={-1}
                onClick={() => void choose(w.organizationId)}
                className="cc-row flex items-center justify-between gap-2 px-3 py-2 text-xs cursor-pointer"
                style={{ color: "var(--text-primary)", background: i === activeIndex ? "var(--bg-hover)" : undefined }}
              >
                <span className="min-w-0">
                  <span className="block truncate">{w.organizationName}</span>
                  <span className="block text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {w.roleName}
                  </span>
                </span>
                {w.isCurrent && <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" aria-hidden="true" />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
