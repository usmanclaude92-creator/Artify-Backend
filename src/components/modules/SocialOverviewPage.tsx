/** Social Media — placeholder. The module itself ships in a later phase; this page only reserves the section. */
import React from "react";
import { Share2 } from "lucide-react";
import { Card, EmptyState } from "../ui/ui";

export const SocialOverviewPage: React.FC = () => (
  <div className="p-4 sm:p-6 space-y-4">
    <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
      <Share2 className="w-5 h-5" style={{ color: "var(--accent)" }} /> Social Overview
    </h1>
    <Card>
      <EmptyState title="Social Media Management is coming in the next phase" description="Channels, scheduling and publishing will live here." />
    </Card>
  </div>
);
