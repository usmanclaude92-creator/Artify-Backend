import React from "react";
import { ChevronRight } from "lucide-react";
import type { NavItem } from "../../lib/permissions";

/** Section + current page, derived from the matched NavItem — no separate breadcrumb config to keep in sync. */
export const Breadcrumbs: React.FC<{ item: NavItem | undefined }> = ({ item }) => {
  if (!item) return null;
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs px-4 sm:px-6 pt-3" style={{ color: "var(--text-muted)" }}>
      <span>{item.section}</span>
      <ChevronRight className="w-3 h-3" />
      <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
        {item.label}
      </span>
    </nav>
  );
};
