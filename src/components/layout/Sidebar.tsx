import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  X,
  ShieldCheck,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  GripVertical,
  LayoutDashboard,
  Globe,
  Contact2,
  Share2,
  Megaphone,
  Package,
  Receipt,
  Bot,
  UserCircle,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useNavPreferences } from "../../context/NavPreferencesContext";
import { useRouter } from "../../lib/router";
import { useNavBadges } from "../../lib/useNavBadges";
import type { NavBadges } from "../../lib/api";
import { visibleNavItems, NAV_SECTIONS, NAV_ORDER, type NavItem, type NavSection } from "../../lib/permissions";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

type Section = NavSection;

const SECTIONS: Section[] = NAV_SECTIONS;

const SECTION_ICON: Record<Section, React.ComponentType<{ className?: string }>> = {
  Dashboard: LayoutDashboard,
  "Website Management": Globe,
  CRM: Contact2,
  "Social Media": Share2,
  Marketing: Megaphone,
  Catalog: Package,
  Commercial: Receipt,
  "Automation & AI": Bot,
  Administration: ShieldCheck,
  "Client Portal": UserCircle,
};

/** Which live count (if any) each nav item shows, and the word a screen reader hears after the number. */
const BADGE_FOR_ITEM: Record<string, { key: keyof NavBadges; word: string }> = {
  approvals: { key: "approvals", word: "pending" },
  "notification-center": { key: "notifications", word: "unread" },
  "my-work": { key: "myWork", word: "open" },
  "social-posts": { key: "socialApprovals", word: "awaiting approval" },
};

/** Presentation state only, like the theme preference — safe to persist client-side. */
const EXPANDED_STORAGE_KEY = "artify_cc_sidebar_expanded_section";

/** Accordion: at most one section open at a time. Every section starts collapsed; the active item's section opens on navigation. */
function loadExpanded(): Section | null {
  try {
    const raw = localStorage.getItem(EXPANDED_STORAGE_KEY);
    return raw && (SECTIONS as string[]).includes(raw) ? (raw as Section) : null;
  } catch {
    return null;
  }
}

const byOrder = (a: NavItem, b: NavItem) => NAV_ORDER.indexOf(a.id) - NAV_ORDER.indexOf(b.id);
const badgeText = (n: number) => (n > 99 ? "99+" : String(n));

interface RowContext {
  path: string;
  countFor: (id: string) => number;
  isPinned: (id: string) => boolean;
  pinsFull: boolean;
  onNavigate: (item: NavItem) => void;
  onTogglePin: (item: NavItem) => void;
}

/** One nav entry: the navigation button plus a sibling pin button (never nested buttons). */
const NavRow: React.FC<{
  item: NavItem;
  ctx: RowContext;
  reorder?: { index: number; count: number; onMove: (delta: number) => void; draggable: React.HTMLAttributes<HTMLDivElement> };
}> = ({ item, ctx, reorder }) => {
  const active = ctx.path === item.path;
  const Icon = item.icon;
  const count = ctx.countFor(item.id);
  const pinned = ctx.isPinned(item.id);
  const word = BADGE_FOR_ITEM[item.id]?.word;
  const disabledPin = !pinned && ctx.pinsFull;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (reorder && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      reorder.onMove(e.key === "ArrowUp" ? -1 : 1);
    }
  };

  return (
    <div className="cc-nav-row" {...reorder?.draggable}>
      {reorder && <GripVertical className="cc-grip" aria-hidden="true" />}
      <button
        type="button"
        onClick={() => ctx.onNavigate(item)}
        onKeyDown={onKeyDown}
        aria-current={active ? "page" : undefined}
        aria-label={count > 0 && word ? `${item.label}, ${count} ${word}` : undefined}
        aria-keyshortcuts={reorder ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
        className="cc-nav-item"
        data-nav-item={item.id}
      >
        <Icon className="w-4 h-4 shrink-0" />
        <span className="flex-1 min-w-0">{item.label}</span>
        {count > 0 && (
          <span className="cc-badge" aria-hidden="true">
            {badgeText(count)}
          </span>
        )}
      </button>
      <button
        type="button"
        className="cc-pin"
        aria-label={pinned ? `Unpin ${item.label}` : `Pin ${item.label}`}
        aria-pressed={pinned}
        disabled={disabledPin}
        title={disabledPin ? "Pin limit reached (8)" : pinned ? "Unpin" : "Pin to top"}
        onClick={() => ctx.onTogglePin(item)}
      >
        {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
};

const ItemList: React.FC<{ items: NavItem[]; ctx: RowContext }> = ({ items, ctx }) => (
  <>
    {items.map((item, index) => (
      <React.Fragment key={item.id}>
        {item.group && item.group !== items[index - 1]?.group && (
          <p className="cc-subheading" role="presentation">
            {item.group}
          </p>
        )}
        <NavRow item={item} ctx={ctx} />
      </React.Fragment>
    ))}
  </>
);

/** "Pinned" group: reorderable with Alt+Arrow keys or drag and drop. */
const PinnedGroup: React.FC<{ items: NavItem[]; ctx: RowContext; onMove: (id: string, delta: number) => void; onReorder: (from: number, to: number) => void }> = ({
  items,
  ctx,
  onMove,
  onReorder,
}) => {
  const dragFrom = useRef<number | null>(null);
  const [announce, setAnnounce] = useState("");
  return (
    <div className="space-y-1" data-testid="pinned-group">
      <p className="cc-section-label">Pinned</p>
      <div className="cc-section-body space-y-0.5" role="group" aria-label="Pinned pages">
        {items.map((item, index) => (
          <NavRow
            key={item.id}
            item={item}
            ctx={ctx}
            reorder={{
              index,
              count: items.length,
              onMove: (delta) => {
                const target = index + delta;
                if (target < 0 || target >= items.length) return;
                onMove(item.id, delta);
                setAnnounce(`${item.label} moved to position ${target + 1} of ${items.length}`);
                requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="pinned-group"] [data-nav-item="${item.id}"]`)?.focus());
              },
              draggable: {
                draggable: true,
                onDragStart: (e) => {
                  dragFrom.current = index;
                  e.dataTransfer.effectAllowed = "move";
                },
                onDragOver: (e) => e.preventDefault(),
                onDrop: (e) => {
                  e.preventDefault();
                  if (dragFrom.current !== null) onReorder(dragFrom.current, index);
                  dragFrom.current = null;
                },
              },
            }}
          />
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  );
};

export const Sidebar: React.FC<{ mobileOpen: boolean; onCloseMobile: () => void }> = ({ mobileOpen, onCloseMobile }) => {
  const { user } = useAuth();
  const { path, navigate } = useRouter();
  const prefs = useNavPreferences();
  const items = useMemo(() => visibleNavItems(user?.role.permissions), [user?.role.permissions]);
  const badges = useNavBadges();
  const countFor = (itemId: string): number => {
    const def = BADGE_FOR_ITEM[itemId];
    return def ? (badges?.[def.key] ?? 0) : 0;
  };
  const activeSection = items.find((item) => item.path === path)?.section ?? null;
  // Strict accordion: exactly one section open at a time. Opening a section closes the others — including
  // the one holding the current page. Navigating to a page opens that page's section.
  const [expanded, setExpanded] = useState<Section | null>(() => activeSection ?? loadExpanded());
  const lastPath = useRef(path);
  useEffect(() => {
    if (lastPath.current === path) return;
    lastPath.current = path;
    if (activeSection) setExpanded(activeSection);
  }, [path, activeSection]);

  const toggleSection = (section: Section) => {
    setExpanded((prev) => {
      const next = prev === section ? null : section;
      try {
        if (next) localStorage.setItem(EXPANDED_STORAGE_KEY, next);
        else localStorage.removeItem(EXPANDED_STORAGE_KEY);
      } catch {
        // Best-effort persistence — a private-mode browser just won't remember it.
      }
      return next;
    });
  };

  // Pinned items the user can no longer access (or that no longer exist) are hidden automatically; they stay stored.
  const pinnedItems = useMemo(
    () => prefs.pinned.map((id) => items.find((i) => i.id === id)).filter((i): i is NavItem => !!i),
    [prefs.pinned, items]
  );
  const [pinNotice, setPinNotice] = useState("");

  const ctx: RowContext = {
    path,
    countFor,
    isPinned: prefs.isPinned,
    pinsFull: prefs.pinned.length >= prefs.maxPins,
    onNavigate: (item) => {
      navigate(item.path);
      onCloseMobile();
    },
    onTogglePin: (item) => {
      const was = prefs.isPinned(item.id);
      const ok = prefs.togglePin(item.id);
      setPinNotice(!ok ? `You can pin up to ${prefs.maxPins} pages.` : was ? `${item.label} unpinned.` : `${item.label} pinned.`);
    },
  };

  const sectionItemsOf = (section: Section) => items.filter((item) => item.section === section).sort(byOrder);

  // ---------- expanded sidebar (default; also the mobile drawer) ----------
  const expandedContent = (inDrawer: boolean) => (
    <>
      <div className="flex items-center gap-2 px-4 h-14 shrink-0 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-hover))", boxShadow: "var(--shadow-card)" }}>
          <ShieldCheck className="w-4 h-4 text-white" />
        </div>
        <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
          Control Center
        </span>
        {inDrawer ? (
          <button onClick={onCloseMobile} className="cc-ctl ml-auto md:hidden p-1.5" aria-label="Close menu">
            <X className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={prefs.toggleRail}
            className="cc-ctl ml-auto p-1.5"
            aria-label="Collapse sidebar to icons"
            aria-expanded={true}
            aria-controls="primary-nav"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="px-2 pt-2 empty:hidden">
        <WorkspaceSwitcher />
      </div>
      <nav id={inDrawer ? undefined : "primary-nav"} className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1" aria-label="Primary">
        {pinnedItems.length > 0 && <PinnedGroup items={pinnedItems} ctx={ctx} onMove={prefs.movePin} onReorder={prefs.reorderPin} />}
        {SECTIONS.map((section) => {
          const sectionItems = sectionItemsOf(section);
          if (sectionItems.length === 0) return null;
          const isCollapsed = expanded !== section;
          const sectionHasCount = sectionItems.some((item) => countFor(item.id) > 0);

          return (
            <div key={section} className="space-y-1">
              <button type="button" onClick={() => toggleSection(section)} aria-expanded={!isCollapsed} className="cc-section-head">
                <span className="flex items-center gap-1.5">
                  {section}
                  {isCollapsed && sectionHasCount && (
                    <>
                      <span className="cc-dot" aria-hidden="true" />
                      <span className="sr-only">(has items needing attention)</span>
                    </>
                  )}
                </span>
                <ChevronDown className="w-3 h-3 shrink-0 transition-transform duration-150" style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }} />
              </button>
              {!isCollapsed && (
                <div className="cc-section-body space-y-0.5">
                  <ItemList items={sectionItems} ctx={ctx} />
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <p className="sr-only" role="status">
        {pinNotice}
      </p>
    </>
  );

  return (
    <>
      <aside
        className={`hidden md:flex md:flex-col shrink-0 border-r h-screen sticky top-0 overflow-hidden transition-[width] duration-200 ${prefs.railCollapsed ? "w-16" : "w-56"}`}
        style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
        data-rail={prefs.railCollapsed ? "true" : "false"}
      >
        {prefs.railCollapsed ? (
          <RailNav
            sections={SECTIONS}
            sectionItemsOf={sectionItemsOf}
            pinnedItems={pinnedItems}
            ctx={ctx}
            activeSection={activeSection}
                        onExpand={prefs.toggleRail}
          />
        ) : (
          expandedContent(false)
        )}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 backdrop-blur-sm" style={{ background: "rgba(2,6,23,0.6)" }} onClick={onCloseMobile} />
          <aside className="absolute left-0 top-0 h-full w-64 flex flex-col overflow-hidden" style={{ background: "var(--bg-surface)", boxShadow: "var(--shadow-pop)" }}>
            {expandedContent(true)}
          </aside>
        </div>
      )}
    </>
  );
};

// ---------- icon rail (md and up) ----------

const RailNav: React.FC<{
  sections: Section[];
  sectionItemsOf: (s: Section) => NavItem[];
  pinnedItems: NavItem[];
  ctx: RowContext;
  activeSection: Section | null;
  onExpand: () => void;
}> = ({ sections, sectionItemsOf, pinnedItems, ctx, activeSection, onExpand }) => {
  const [openKey, setOpenKey] = useState<string | null>(null); // section name or "__pinned"
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const flyoutRef = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(64);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);

  const closeFlyout = (returnFocus: boolean) => {
    const key = openKey;
    setOpenKey(null);
    if (returnFocus && key) buttonRefs.current[key]?.focus();
  };

  useLayoutEffect(() => {
    if (!openKey) return;
    const rect = buttonRefs.current[openKey]?.getBoundingClientRect();
    if (rect) {
      // Align with the icon, but keep the whole panel on screen (it scrolls inside when taller).
      const t = Math.max(8, Math.min(rect.top, window.innerHeight - 420));
      setTop(t);
      setMaxHeight(window.innerHeight - t - 8);
    }
  }, [openKey]);

  useEffect(() => {
    if (!openKey) return;
    flyoutRef.current?.querySelector<HTMLElement>("[data-nav-item]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeFlyout(true);
      }
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const trigger = buttonRefs.current[openKey];
      if (!flyoutRef.current?.contains(target) && !trigger?.contains(target)) setOpenKey(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey]);

  // Close the flyout after navigating.
  const flyoutCtx: RowContext = {
    ...ctx,
    onNavigate: (item) => {
      setOpenKey(null);
      ctx.onNavigate(item);
    },
  };

  const railButton = (key: string, label: string, Icon: React.ComponentType<{ className?: string }>, count: number, active: boolean) => (
    <button
      key={key}
      ref={(el) => {
        buttonRefs.current[key] = el;
      }}
      type="button"
      onClick={() => setOpenKey((cur) => (cur === key ? null : key))}
      aria-haspopup="true"
      aria-expanded={openKey === key}
      aria-current={active ? "true" : undefined}
      aria-label={count > 0 ? `${label}, ${count} items need attention` : label}
      data-tip={label}
      className="cc-rail-btn cc-tip"
      data-active={active ? "true" : "false"}
    >
      <Icon className="w-[18px] h-[18px]" />
      {count > 0 && (
        <span className="cc-badge cc-rail-badge" aria-hidden="true">
          {badgeText(count)}
        </span>
      )}
    </button>
  );

  const openItems = openKey === "__pinned" ? pinnedItems : openKey ? sectionItemsOf(openKey as Section) : [];
  const sumCount = (list: NavItem[]) => list.reduce((n, i) => n + ctx.countFor(i.id), 0);

  return (
    <>
      <div className="flex flex-col items-center gap-2 h-14 shrink-0 border-b justify-center" style={{ borderColor: "var(--border)" }}>
        <button
          type="button"
          onClick={onExpand}
          className="cc-ctl p-2"
          aria-label="Expand sidebar"
          aria-expanded={false}
          aria-controls="primary-nav"
          data-tip="Expand sidebar"
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>
      </div>
      <div className="flex justify-center pt-2 empty:hidden">
        <WorkspaceSwitcher compact />
      </div>
      <nav id="primary-nav" className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-2 flex flex-col items-center gap-1" aria-label="Primary">
        {pinnedItems.length > 0 && railButton("__pinned", "Pinned", Pin, sumCount(pinnedItems), false)}
        {sections.map((section) => {
          const list = sectionItemsOf(section);
          if (list.length === 0) return null;
          return railButton(section, section, SECTION_ICON[section], sumCount(list), activeSection === section);
        })}
      </nav>

      {openKey && openItems.length > 0 && (
        <div
          ref={flyoutRef}
          role="dialog"
          aria-label={openKey === "__pinned" ? "Pinned pages" : openKey}
          className="cc-popover cc-flyout"
          style={{ top, maxHeight }}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            const buttons = Array.from(flyoutRef.current?.querySelectorAll<HTMLElement>("[data-nav-item]") ?? []);
            const index = buttons.indexOf(document.activeElement as HTMLElement);
            if (index < 0) return;
            e.preventDefault();
            buttons[(index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
          }}
        >
          <p className="cc-section-label">{openKey === "__pinned" ? "Pinned" : openKey}</p>
          <div className="space-y-0.5 p-1">
            <ItemList items={openItems} ctx={flyoutCtx} />
          </div>
        </div>
      )}
    </>
  );
};
