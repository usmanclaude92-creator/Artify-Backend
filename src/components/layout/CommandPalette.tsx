/**
 * Global Command Center (Ctrl/Cmd+K) — Control Center Foundation.
 *
 * Two modes depending on whether the user has typed anything:
 *  - Empty query: permission-gated quick actions + every nav item the user
 *    can see, so the palette also works as a fast navigator.
 *  - Non-empty query: nav items matching the label, plus a live, debounced
 *    search against the real Posts/Pages/Leads/Clients/Products/Media list
 *    endpoints (each of which already accepts `?search=` and is already
 *    protected server-side by the same RBAC middleware as the rest of the
 *    app) — never a client-only mock index. A type is only queried if the
 *    signed-in user actually holds its `*.read` permission, so an
 *    unauthorized 403 never even round-trips.
 *
 * Selecting a nav item or entity navigates via the app's own history-API
 * router. Entity results and quick "New …" actions deep-link with a
 * `?q=`/`?new=1` query param; the six list pages that support search read
 * `q` to pre-fill their filter, and each list page reads `new=1` once on
 * mount to open its own create flow — no separate "open record" API needed.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  CornerDownLeft,
  FileText,
  Newspaper,
  Briefcase,
  Building2,
  Package,
  Image as ImageIcon,
  UploadCloud,
  Target,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useRouter } from "../../lib/router";
import { hasPermission, visibleNavItems } from "../../lib/permissions";
import { postsApi, pagesApi, leadsApi, clientsApi, productsApi, mediaApi, opportunitiesApi } from "../../lib/api";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface PaletteItem {
  id: string;
  label: string;
  sublabel?: string;
  group: string;
  icon: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
}

interface QuickAction {
  id: string;
  label: string;
  permission: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
}

const QUICK_ACTIONS: QuickAction[] = [
  { id: "new-post", label: "New Post", permission: "content.create", path: "/cms/posts?new=1", icon: Newspaper },
  { id: "new-page", label: "New Page", permission: "content.create", path: "/cms/pages?new=1", icon: FileText },
  { id: "new-lead", label: "New Lead", permission: "leads.create", path: "/crm/leads?new=1", icon: Briefcase },
  { id: "new-client", label: "New Client", permission: "clients.create", path: "/crm/clients?new=1", icon: Building2 },
  { id: "new-opportunity", label: "New Opportunity", permission: "opportunities.create", path: "/crm/opportunities?new=1", icon: Target },
  { id: "upload-media", label: "Upload Media", permission: "media.upload", path: "/cms/media?new=1", icon: UploadCloud },
];

const ENTITY_SEARCHERS: {
  id: string;
  group: string;
  permission: string;
  icon: React.ComponentType<{ className?: string }>;
  navPath: string;
  search: (query: string) => Promise<{ id: string; label: string; sublabel?: string }[]>;
}[] = [
  {
    id: "posts",
    group: "Blog Posts",
    permission: "content.read",
    icon: Newspaper,
    navPath: "/cms/posts",
    search: async (query) => {
      const { items } = await postsApi.list({ search: query, limit: 5 });
      return items.map((p) => ({ id: p.id, label: p.title, sublabel: p.status }));
    },
  },
  {
    id: "pages",
    group: "Pages",
    permission: "content.read",
    icon: FileText,
    navPath: "/cms/pages",
    search: async (query) => {
      const { items } = await pagesApi.list({ search: query, limit: 5 });
      return items.map((p) => ({ id: p.id, label: p.title, sublabel: p.status }));
    },
  },
  {
    id: "leads",
    group: "Leads",
    permission: "leads.read",
    icon: Briefcase,
    navPath: "/crm/leads",
    search: async (query) => {
      const { items } = await leadsApi.list({ search: query, limit: 5 });
      return items.map((l) => ({ id: l.id, label: l.companyName, sublabel: l.status }));
    },
  },
  {
    id: "clients",
    group: "Clients",
    permission: "clients.read",
    icon: Building2,
    navPath: "/crm/clients",
    search: async (query) => {
      const { items } = await clientsApi.list({ search: query, limit: 5 });
      return items.map((c) => ({ id: c.id, label: c.name, sublabel: c.clientCode }));
    },
  },
  {
    id: "products",
    group: "Products",
    permission: "products.read",
    icon: Package,
    navPath: "/products",
    search: async (query) => {
      const { items } = await productsApi.list({ search: query, limit: 5 });
      return items.map((p) => ({ id: p.id, label: p.name, sublabel: p.type }));
    },
  },
  {
    id: "media",
    group: "Media",
    permission: "media.read",
    icon: ImageIcon,
    navPath: "/cms/media",
    search: async (query) => {
      const { items } = await mediaApi.list({ search: query, limit: 5 });
      return items.map((m) => ({ id: m.id, label: m.displayName || m.originalFilename, sublabel: m.mimeType }));
    },
  },
  {
    id: "opportunities",
    group: "Opportunities",
    permission: "opportunities.read",
    icon: Target,
    navPath: "/crm/opportunities",
    search: async (query) => {
      const { items } = await opportunitiesApi.list({ search: query, limit: 5 });
      return items.map((o) => ({ id: o.id, label: o.name, sublabel: o.stage }));
    },
  },
];

export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose }) => {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [entityResults, setEntityResults] = useState<PaletteItem[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const permissions = user?.role.permissions;

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setEntityResults([]);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const go = (path: string) => {
    navigate(path);
    onClose();
  };

  // Live entity search, debounced — only queries endpoints the user can
  // actually read, and drops stale responses if the query changes mid-flight.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setEntityResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      const searchers = ENTITY_SEARCHERS.filter((s) => hasPermission(permissions, s.permission));
      Promise.all(
        searchers.map((s) =>
          s.search(trimmed)
            .then((rows) =>
              rows.map(
                (row): PaletteItem => ({
                  id: `${s.id}-${row.id}`,
                  label: row.label,
                  sublabel: row.sublabel,
                  group: s.group,
                  icon: s.icon,
                  onSelect: () => go(`${s.navPath}?q=${encodeURIComponent(row.label)}`),
                })
              )
            )
            .catch(() => [])
        )
      ).then((groups) => {
        if (cancelled) return;
        setEntityResults(groups.flat());
        setSearching(false);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, permissions]);

  const navItemResults = useMemo((): PaletteItem[] => {
    const visible = visibleNavItems(permissions);
    const trimmed = query.trim().toLowerCase();
    const matches = trimmed ? visible.filter((item) => item.label.toLowerCase().includes(trimmed) || item.section.toLowerCase().includes(trimmed)) : visible;
    return matches.map((item) => ({
      id: `nav-${item.id}`,
      label: item.label,
      sublabel: item.section,
      group: "Go to",
      icon: item.icon,
      onSelect: () => go(item.path),
    }));
  }, [query, permissions]);

  const quickActionResults = useMemo((): PaletteItem[] => {
    if (query.trim()) return [];
    return QUICK_ACTIONS.filter((a) => hasPermission(permissions, a.permission)).map((a) => ({
      id: `qa-${a.id}`,
      label: a.label,
      group: "Quick actions",
      icon: a.icon,
      onSelect: () => go(a.path),
    }));
  }, [query, permissions]);

  const allItems = useMemo(
    () => [...quickActionResults, ...navItemResults, ...entityResults],
    [quickActionResults, navItemResults, entityResults]
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [allItems.length]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, allItems.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        allItems[activeIndex]?.onSelect();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, allItems, activeIndex, onClose]);

  if (!open) return null;

  let renderedIndex = -1;
  const groups = new Map<string, PaletteItem[]>();
  for (const item of allItems) {
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group)!.push(item);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4" style={{ background: "rgba(2,6,23,0.6)" }} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command Center"
        className="w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[70vh]"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
          <Search className="w-4 h-4 shrink-0" style={{ color: "var(--text-muted)" }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages, posts, leads, clients, products, media…"
            className="flex-1 bg-transparent text-sm focus:outline-none"
            style={{ color: "var(--text-primary)" }}
          />
          {searching && <span className="text-[10px] shrink-0" style={{ color: "var(--text-muted)" }}>Searching…</span>}
        </div>

        <div className="overflow-y-auto py-2">
          {allItems.length === 0 && (
            <div className="px-4 py-8 text-center text-xs" style={{ color: "var(--text-muted)" }}>
              {query.trim() ? "No matches." : "Type to search, or pick an action above."}
            </div>
          )}
          {[...groups.entries()].map(([group, items]) => (
            <div key={group} className="mb-1">
              <div className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                {group}
              </div>
              {items.map((item) => {
                renderedIndex += 1;
                const isActive = renderedIndex === activeIndex;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onMouseEnter={() => setActiveIndex(renderedIndex)}
                    onClick={item.onSelect}
                    className="w-full flex items-center gap-3 px-4 py-2 text-left text-sm"
                    style={{ background: isActive ? "var(--bg-hover)" : "transparent", color: "var(--text-primary)" }}
                  >
                    <Icon className="w-4 h-4 shrink-0" style={{ color: "var(--text-secondary)" }} />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.sublabel && (
                      <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>
                        {item.sublabel}
                      </span>
                    )}
                    {isActive && <CornerDownLeft className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--text-muted)" }} />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div
          className="flex items-center gap-4 px-4 py-2 text-[10px] border-t"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          <span>↑↓ Navigate</span>
          <span>↵ Select</span>
          <span>Esc Close</span>
        </div>
      </div>
    </div>
  );
};

export const useCommandPaletteShortcut = (onOpen: () => void) => {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpen]);
};
