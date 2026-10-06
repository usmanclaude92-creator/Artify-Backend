import React, { useState } from "react";
import { Menu, Sun, Moon, ChevronDown, LogOut, LogOutIcon, KeyRound, Building2, Search } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { useRouter } from "../../lib/router";
import { ChangePasswordModal } from "../modules/ChangePasswordModal";
import { NotificationBell } from "./NotificationBell";

export const Header: React.FC<{ onOpenMobileMenu: () => void; onOpenCommandPalette: () => void }> = ({
  onOpenMobileMenu,
  onOpenCommandPalette,
}) => {
  const { user, organizations, logout, logoutAll } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { navigate } = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  const currentOrg = organizations.find((o) => o.isCurrent);

  return (
    <header
      className="h-14 flex items-center gap-3 px-4 border-b sticky top-0 z-30 backdrop-blur"
      style={{ background: "color-mix(in srgb, var(--bg-surface) 92%, transparent)", borderColor: "var(--border)" }}
    >
      <button onClick={onOpenMobileMenu} className="cc-ctl md:hidden p-2" aria-label="Open menu">
        <Menu className="w-5 h-5" />
      </button>

      {/* Read-only: the active workspace. Switching lives in the sidebar's workspace switcher. */}
      {currentOrg && (
        <span
          className="cc-field hidden sm:flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 max-w-[14rem]"
          style={{ color: "var(--text-secondary)" }}
          aria-label={`Active workspace: ${currentOrg.organizationName}`}
        >
          <Building2 className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{currentOrg.organizationName}</span>
        </span>
      )}

      <button
        onClick={onOpenCommandPalette}
        className="cc-field hidden sm:flex items-center gap-2 text-xs px-3 py-1.5 w-64 max-w-xs"
        style={{ color: "var(--text-muted)" }}
      >
        <Search className="w-3.5 h-3.5 shrink-0" />
        <span className="flex-1 text-left">Search…</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded border shrink-0" style={{ borderColor: "var(--border)" }}>
          {navigator.platform.toLowerCase().includes("mac") ? "⌘K" : "Ctrl K"}
        </span>
      </button>

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={onOpenCommandPalette}
          aria-label="Search"
          className="cc-ctl sm:hidden p-2"
        >
          <Search className="w-4 h-4" />
        </button>
        <NotificationBell />
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="cc-ctl p-2"
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        <div className="relative">
          <button onClick={() => setMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={menuOpen} className="cc-field flex items-center gap-2 pl-1 pr-2 py-1">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
              style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-hover))" }}
            >
              {user?.firstName?.charAt(0) ?? "U"}
            </div>
            <span className="text-xs font-semibold hidden sm:block" style={{ color: "var(--text-primary)" }}>
              {user?.displayName ?? `${user?.firstName} ${user?.lastName}`}
            </span>
            <ChevronDown className="w-3 h-3" style={{ color: "var(--text-muted)" }} />
          </button>

          {menuOpen && (
            <div
              className="cc-popover absolute right-0 mt-1 w-56 py-1 z-40 text-xs"
            >
              <div className="px-3 py-2 border-b" style={{ borderColor: "var(--border)" }}>
                <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                  {user?.email}
                </p>
                <p style={{ color: "var(--text-muted)" }}>{user?.role.name}</p>
              </div>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setChangePasswordOpen(true);
                }}
                className="cc-row w-full flex items-center gap-2 px-3 py-2 text-left"
                style={{ color: "var(--text-primary)" }}
              >
                <KeyRound className="w-3.5 h-3.5" /> Change password
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  navigate("/security");
                }}
                className="cc-row w-full flex items-center gap-2 px-3 py-2 text-left"
                style={{ color: "var(--text-primary)" }}
              >
                <Building2 className="w-3.5 h-3.5" /> Sessions &amp; security
              </button>
              <button
                onClick={() => void logout()}
                className="cc-row w-full flex items-center gap-2 px-3 py-2 text-left"
                style={{ color: "var(--text-primary)" }}
              >
                <LogOut className="w-3.5 h-3.5" /> Sign out
              </button>
              <button
                onClick={() => void logoutAll()}
                className="cc-row w-full flex items-center gap-2 px-3 py-2 text-left text-rose-500"
              >
                <LogOutIcon className="w-3.5 h-3.5" /> Sign out everywhere
              </button>
            </div>
          )}
        </div>
      </div>

      <ChangePasswordModal open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
    </header>
  );
};
