import React, { useEffect, useRef, useState } from "react";
import { X, ShieldCheck, ChevronDown } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useRouter } from "../../lib/router";
import { useNavBadges } from "../../lib/useNavBadges";
import type { NavBadges } from "../../lib/api";
import { visibleNavItems, NAV_SECTIONS, NAV_ORDER, type NavSection } from "../../lib/permissions";

type Section = NavSection;

const SECTIONS: Section[] = NAV_SECTIONS;

/** Which live count (if any) each nav item shows, and the word a screen reader hears after the number. */
const BADGE_FOR_ITEM: Record<string, { key: keyof NavBadges; word: string }> = {
  approvals: { key: "approvals", word: "pending" },
  "notification-center": { key: "notifications", word: "unread" },
  "my-work": { key: "myWork", word: "open" },
};

/** Presentation state only, like the theme preference — safe to persist client-side. */
const EXPANDED_STORAGE_KEY = "artify_cc_sidebar_expanded_section";

/** Accordion: at most one section open at a time. Every section starts
 * collapsed; the active item's section overrides this via `hasActiveItem`. */
function loadExpanded(): Section | null {
  try {
    const raw = localStorage.getItem(EXPANDED_STORAGE_KEY);
    return raw && (SECTIONS as string[]).includes(raw) ? (raw as Section) : null;
  } catch {
    return null;
  }
}

export const Sidebar: React.FC<{ mobileOpen: boolean; onCloseMobile: () => void }> = ({ mobileOpen, onCloseMobile }) => {
  const { user } = useAuth();
  const { path, navigate } = useRouter();
  const items = visibleNavItems(user?.role.permissions);
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

  const content = (
    <>
      <div className="flex items-center gap-2 px-4 h-14 shrink-0 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-hover))", boxShadow: "var(--shadow-card)" }}>
          <ShieldCheck className="w-4 h-4 text-white" />
        </div>
        <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
          Control Center
        </span>
        <button onClick={onCloseMobile} className="cc-ctl ml-auto md:hidden p-1.5" aria-label="Close menu">
          <X className="w-4 h-4" />
        </button>
      </div>
      <nav className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1" aria-label="Primary">
        {SECTIONS.map((section) => {
          const sectionItems = items
            .filter((item) => item.section === section)
            .sort((a, b) => NAV_ORDER.indexOf(a.id) - NAV_ORDER.indexOf(b.id));
          if (sectionItems.length === 0) return null;

          const isCollapsed = expanded !== section;
          const sectionHasCount = sectionItems.some((item) => countFor(item.id) > 0);

          return (
            <div key={section} className="space-y-1">
              <button
                type="button"
                onClick={() => toggleSection(section)}
                aria-expanded={!isCollapsed}
                className="cc-section-head"
              >
                <span className="flex items-center gap-1.5">
                  {section}
                  {isCollapsed && sectionHasCount && (
                    <>
                      <span className="cc-dot" aria-hidden="true" />
                      <span className="sr-only">(has items needing attention)</span>
                    </>
                  )}
                </span>
                <ChevronDown
                  className="w-3 h-3 shrink-0 transition-transform duration-150"
                  style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
                />
              </button>
              {!isCollapsed && (
                <div className="cc-section-body space-y-0.5">
                {sectionItems.map((item, index) => {
                  const active = path === item.path;
                  const Icon = item.icon;
                  const showGroup = item.group && item.group !== sectionItems[index - 1]?.group;
                  return (
                    <React.Fragment key={item.id}>
                      {showGroup && (
                        <p className="cc-subheading" role="presentation">
                          {item.group}
                        </p>
                      )}
                      <button
                        onClick={() => {
                          navigate(item.path);
                          onCloseMobile();
                        }}
                        aria-current={active ? "page" : undefined}
                        aria-label={countFor(item.id) > 0 ? `${item.label}, ${countFor(item.id)} ${BADGE_FOR_ITEM[item.id]!.word}` : undefined}
                        className="cc-nav-item"
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="flex-1 min-w-0">{item.label}</span>
                        {countFor(item.id) > 0 && (
                          <span className="cc-badge" aria-hidden="true">
                            {countFor(item.id) > 99 ? "99+" : countFor(item.id)}
                          </span>
                        )}
                      </button>
                    </React.Fragment>
                  );
                })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </>
  );

  return (
    <>
      <aside
        className="hidden md:flex md:flex-col w-56 shrink-0 border-r h-screen sticky top-0 overflow-hidden"
        style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
      >
        {content}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 backdrop-blur-sm" style={{ background: "rgba(2,6,23,0.6)" }} onClick={onCloseMobile} />
          <aside
            className="absolute left-0 top-0 h-full w-64 flex flex-col overflow-hidden"
            style={{ background: "var(--bg-surface)", boxShadow: "var(--shadow-pop)" }}
          >
            {content}
          </aside>
        </div>
      )}
    </>
  );
};
