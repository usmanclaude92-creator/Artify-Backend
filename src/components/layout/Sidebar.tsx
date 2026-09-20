import React from "react";
import { X, ShieldCheck } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useRouter } from "../../lib/router";
import { visibleNavItems } from "../../lib/permissions";

export const Sidebar: React.FC<{ mobileOpen: boolean; onCloseMobile: () => void }> = ({ mobileOpen, onCloseMobile }) => {
  const { user } = useAuth();
  const { path, navigate } = useRouter();
  const items = visibleNavItems(user?.role.permissions);

  const content = (
    <>
      <div className="flex items-center gap-2 px-4 h-14 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "var(--accent)" }}>
          <ShieldCheck className="w-4 h-4 text-white" />
        </div>
        <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
          Control Center
        </span>
        <button onClick={onCloseMobile} className="ml-auto md:hidden" aria-label="Close menu" style={{ color: "var(--text-muted)" }}>
          <X className="w-4 h-4" />
        </button>
      </div>
      <nav className="p-2 space-y-0.5" aria-label="Primary">
        {items.map((item) => {
          const active = path === item.path;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => {
                navigate(item.path);
                onCloseMobile();
              }}
              aria-current={active ? "page" : undefined}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition text-left"
              style={
                active
                  ? { background: "var(--accent-soft)", color: "var(--accent)" }
                  : { color: "var(--text-secondary)" }
              }
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </button>
          );
        })}
      </nav>
    </>
  );

  return (
    <>
      <aside
        className="hidden md:flex md:flex-col w-56 shrink-0 border-r h-screen sticky top-0"
        style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
      >
        {content}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0" style={{ background: "rgba(2,6,23,0.6)" }} onClick={onCloseMobile} />
          <aside
            className="absolute left-0 top-0 h-full w-64 flex flex-col shadow-2xl"
            style={{ background: "var(--bg-surface)" }}
          >
            {content}
          </aside>
        </div>
      )}
    </>
  );
};
