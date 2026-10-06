import React from "react";
import { ChevronRight } from "lucide-react";
import type { NavItem } from "../../lib/permissions";

/** Section + current page, derived from the matched NavItem — no separate breadcrumb config to keep in sync. */
export const Breadcrumbs: React.FC<{ item: NavItem | undefined }> = ({ item }) => {
  if (!item) return null;
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs px-4 sm:px-6 pt-3" style={{ color: "var(--text-muted)" }}>
      <span>{item.section}</span>
      {item.group && (
        <>
          <ChevronRight className="w-3 h-3" aria-hidden="true" />
          <span>{item.group}</span>
        </>
      )}
      <ChevronRight className="w-3 h-3" aria-hidden="true" />
      <span className="font-semibold" aria-current="page" style={{ color: "var(--text-primary)" }}>
        {item.label}
      </span>
    </nav>
  );
};
