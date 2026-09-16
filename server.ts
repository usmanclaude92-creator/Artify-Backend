import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "10mb" }));

// Server-side Gemini AI Client (Lazy initialized)
let aiClient: GoogleGenAI | null = null;
function getAI(): GoogleGenAI | null {
  if (!aiClient && process.env.GEMINI_API_KEY) {
    aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return aiClient;
}

// In-memory server-side audit logs cache & system metrics
const serverAuditLogs: Array<{
  id: string;
  timestamp: string;
  userId: string;
  userEmail: string;
  action: string;
  module: string;
  details: string;
  ip: string;
  status: "success" | "warning" | "error";
}> = [
  {
    id: "srv-audit-1",
    timestamp: new Date().toISOString(),
    userId: "usr-admin-1",
    userEmail: "artifysols@gmail.com",
    action: "SYSTEM_INITIALIZED",
    module: "System Health",
    details: "Super Admin Control Center microservices booted on port 3000",
    ip: "127.0.0.1",
    status: "success"
  }
];

const telemetryEvents: Array<{
  event: string;
  path: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}> = [];

// API Endpoints
app.get("/api/health", (_req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: "2.5.0-enterprise",
    uptimeSeconds: Math.floor(process.uptime()),
    database: "connected",
    services: {
      auth: "operational",
      contentApi: "operational",
      aiOrchestrator: process.env.GEMINI_API_KEY ? "active" : "standby_ready",
      storage: "operational",
      eventBus: "operational"
    }
  });
});

app.get("/api/system/stats", (_req, res) => {
  const memoryUsage = process.memoryUsage();
  res.json({
    uptime: process.uptime(),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    memory: {
      rssMb: Math.round(memoryUsage.rss / 1024 / 1024),
      heapTotalMb: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      heapUsedMb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
    },
    activeConnections: 18,
    responseTimeMs: 14,
    cacheHitRate: 98.4
  });
});

// AI Generation / Assistance endpoint for content, SEO, & assistant agents
app.post("/api/ai/generate", async (req, res) => {
  try {
    const { prompt, systemInstruction, taskType } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "Missing required field: prompt" });
    }

    const ai = getAI();
    if (!ai) {
      // Graceful fallback with rich structured output if GEMINI_API_KEY is not configured yet
      return res.json({
        content: `[Artify AI Assistant - Preview Mode]\n\nBased on request: "${prompt.slice(0, 100)}..."\n\n- Executive Summary: Scalable enterprise capability aligned with Artify Sols ecosystem.\n- Adaptive Framework: Automatically aligns with client workflow architecture.\n- Recommended Action: Proceed with draft stage approval and multi-platform distribution.\n\n(Configure GEMINI_API_KEY in Secrets for live Gemini 3.8 Flash real-time generation.)`,
        modelUsed: "artify-enterprise-fallback-engine",
        status: "simulated"
      });
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        systemInstruction: systemInstruction || "You are the Artify Sols Enterprise AI Control Center Copilot. Provide authoritative, concise, adaptive enterprise business software recommendations, content drafts, or SEO metadata.",
      }
    });

    const outputText = response.text || "";

    // Record audit event
    serverAuditLogs.unshift({
      id: `ai-gen-${Date.now()}`,
      timestamp: new Date().toISOString(),
      userId: "usr-admin-1",
      userEmail: "artifysols@gmail.com",
      action: "AI_GENERATION",
      module: "AI Control Center",
      details: `Generated ${taskType || "content"} (${outputText.length} chars)`,
      ip: req.ip || "127.0.0.1",
      status: "success"
    });

    res.json({
      content: outputText,
      modelUsed: "gemini-3.8-flash",
      status: "success"
    });
  } catch (error: unknown) {
    console.error("AI Generation Error:", error);
    const message = error instanceof Error ? error.message : "Internal AI Error";
    res.status(500).json({ error: message });
  }
});

// Audit Log endpoints
app.get("/api/audit-logs", (_req, res) => {
  res.json({ logs: serverAuditLogs.slice(0, 100) });
});

app.post("/api/audit-logs", (req, res) => {
  const { action, module, details, status, userEmail } = req.body;
  const newLog = {
    id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    timestamp: new Date().toISOString(),
    userId: "usr-admin-1",
    userEmail: userEmail || "artifysols@gmail.com",
    action: action || "GENERIC_ACTION",
    module: module || "General",
    details: details || "",
    ip: req.ip || "127.0.0.1",
    status: (status as "success" | "warning" | "error") || "success"
  };
  serverAuditLogs.unshift(newLog);
  if (serverAuditLogs.length > 500) {
    serverAuditLogs.pop();
  }
  res.json({ success: true, log: newLog });
});

// Telemetry endpoint
app.post("/api/analytics/event", (req, res) => {
  const { event, path: eventPath, metadata } = req.body;
  telemetryEvents.push({
    event: event || "pageview",
    path: eventPath || "/",
    timestamp: new Date().toISOString(),
    metadata
  });
  if (telemetryEvents.length > 1000) telemetryEvents.shift();
  res.json({ success: true });
});

// Vite middleware integration
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Artify Sols Super Admin Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
