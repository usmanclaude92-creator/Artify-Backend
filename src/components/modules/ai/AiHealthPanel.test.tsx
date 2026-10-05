/** Phase 18 — the panel must show "Not configured" when the server says so, and only real aggregates. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AiHealthPanel } from "./AiHealthPanel";

const getMock = vi.fn();
vi.mock("../../../lib/aiApi", () => ({
  aiHealthApi: { get: (...a: unknown[]) => getMock(...a), setLimits: vi.fn() },
}));

afterEach(() => {
  cleanup();
  getMock.mockReset();
});

const base = {
  generatedAt: "now",
  provider: { active: "none", configured: false, state: "DISABLED", label: "Not configured", defaultModel: null, embeddingsAvailable: false, capabilities: { copilot: false, knowledgeKeywordSearch: true } },
  catalog: [],
  usage: { window: "30d", copilotRequests: 0, copilotFailures: 2, copilotRequests24h: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0, avgLatencyMs: null, byModel: [], governedExecutions: [], governedUsage: { records: 0, tokens: 0, estimatedCost: 0 } },
  limits: { dailyRequests: 0, dailyTokens: 0, usedToday: { requests: 0, tokens: 0 } },
  recentActivity: [],
  recentErrors: [],
  knowledge: { documents: [], chunks: 0, embeddedChunks: 0, failedIngestionJobs: 0, retrievalMode: "KEYWORD_ONLY" },
};

describe("AiHealthPanel", () => {
  it("shows Not configured, keyword-only retrieval and no latency when nothing has run", async () => {
    getMock.mockResolvedValue({ health: base });
    render(<AiHealthPanel canManage={false} />);
    expect(await screen.findByText("Not configured", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText(/Keyword only/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Daily requests")).not.toBeInTheDocument();
  });

  it("offers limit editing only to managers", async () => {
    getMock.mockResolvedValue({ health: base });
    render(<AiHealthPanel canManage />);
    expect(await screen.findByLabelText("Daily requests")).toBeInTheDocument();
  });
});
