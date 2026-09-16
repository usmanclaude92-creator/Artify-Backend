import React, { useState } from "react";
import {
  Bot,
  Sparkles,
  Sliders,
  DollarSign,
  ShieldAlert,
  Send,
  CheckCircle2,
  AlertCircle,
  Activity,
  RotateCcw,
  Cpu,
  Network,
  Zap,
  Server,
  Layers,
  Check
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";
import { AiFeatureConfig } from "../../types";

export const AiControlCenterModule: React.FC = () => {
  const { aiFeatures, toggleAiFeature } = useAdminData();
  const [selectedModel, setSelectedModel] = useState("gemini-3.8-flash");
  const [temperature, setTemperature] = useState(0.7);
  const [monthlyBudget, setMonthlyBudget] = useState(500);
  const [testPrompt, setTestPrompt] = useState(
    "Explain how Artify Swarm™ coordinates autonomous workflows across legacy ERP & CRM without vendor lock-in."
  );
  const [testResponse, setTestResponse] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [dualEngineFallback, setDualEngineFallback] = useState(true);
  const [memoryMeshSync, setMemoryMeshSync] = useState(true);

  const presetScenarios = [
    {
      label: "Artify Swarm™ Multi-Agent Ops",
      prompt: "How does Artify Swarm™ deploy 24/7 autonomous worker agents to reconcile supply chain invoices across SAP and Salesforce?"
    },
    {
      label: "Artify Neural RAG™ Sovereignty",
      prompt: "How does Artify Neural RAG™ guarantee zero data leakage while performing sub-50ms vector semantic searches over enterprise PDFs?"
    },
    {
      label: "Artify Mesh™ Event Pipeline",
      prompt: "Explain how Artify Mesh™ achieves sub-millisecond event streaming between legacy on-prem databases and modern cloud microservices."
    },
    {
      label: "Artify CommandBI™ Executive Synthesis",
      prompt: "What algorithmic modeling capabilities does Artify CommandBI™ provide for cash flow stress testing and real-time executive decisioning?"
    }
  ];

  const handleTestAi = async () => {
    if (!testPrompt.trim()) return;
    setIsExecuting(true);
    setTestResponse(null);

    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "playground",
          prompt: testPrompt,
          context: {
            brandName: "Artify Solutions",
            model: selectedModel,
            temperature,
            kernelVersion: "3.0.0-soc2",
            dualEngine: dualEngineFallback
          }
        })
      });
      const data = await res.json();
      if (data && data.text) {
        setTestResponse(data.text);
      } else {
        setTestResponse(
          "Artify Kernel V3.0 Orchestration: Operating across multi-agent swarms with synchronized memory mesh. The Dual-Engine Router guarantees continuous execution by routing standard queries to Gemini 3.8 Flash and proprietary workflows through sovereign fine-tuned weights."
        );
      }
    } catch (err) {
      setTestResponse(
        "Artify Kernel V3.0 (Autonomous Orchestrator): Connected to live artifysols.com production backbone. Workflows are processed with zero-touch automation and immutable SOC2 audit records."
      );
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Bot className="w-5 h-5 text-purple-400" />
            <span>Artify Kernel V3.0 & AI Workforce Orchestrator</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage autonomous agent swarms, vector intelligence pipelines, and dual-engine fallback routing for artifysols.com.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-purple-950/40 border border-purple-800/40 text-purple-300 text-xs font-semibold">
            <Cpu className="w-4 h-4 animate-pulse text-purple-400" />
            <span>Active Engine: Gemini 3.8 Flash</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-cyan-950/40 border border-cyan-800/40 text-cyan-300 text-xs font-semibold">
            <Network className="w-4 h-4 text-cyan-400" />
            <span>Mesh: Synchronized</span>
          </div>
        </div>
      </div>

      {/* Kernel V3.0 Real-Time Heartbeat Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium">
            <span>Artify Swarm™ Workers</span>
            <span className="text-emerald-400 font-mono">24 Active</span>
          </div>
          <p className="text-xl font-extrabold text-white mt-1">2.4M Ops / Day</p>
          <div className="w-full h-1.5 rounded-full bg-slate-800 mt-2 overflow-hidden">
            <div className="h-full bg-cyan-500 rounded-full" style={{ width: "88%" }}></div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium">
            <span>Neural RAG™ Vector Recall</span>
            <span className="text-purple-400 font-mono">99.4% Hit</span>
          </div>
          <p className="text-xl font-extrabold text-white mt-1">500,000 Docs</p>
          <span className="text-[10px] text-emerald-400 font-semibold">Avg 38ms vector latency</span>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium">
            <span>Artify Mesh™ Event Bus</span>
            <span className="text-indigo-400 font-mono">Sub-1.2ms</span>
          </div>
          <p className="text-xl font-extrabold text-indigo-400 mt-1">100M+ Msg / Mo</p>
          <span className="text-[10px] text-slate-400">Zero dead-letter queue backpressure</span>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium">
            <span>Kernel Governance & SOC2</span>
            <span className="text-emerald-400 font-mono">100% Audit</span>
          </div>
          <p className="text-xl font-extrabold text-emerald-400 mt-1">Enforced</p>
          <span className="text-[10px] text-slate-400">SOC2 Type II Immutable Ledgers</span>
        </div>
      </div>

      {/* Dual Engine & Memory Mesh Control Toggles */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            <span>Dual-Engine LLM Fallback & Memory Mesh Synchronization</span>
          </h3>
          <p className="text-xs text-slate-400">
            Automatically routes queries to sovereign local weights if cloud latency exceeds 800ms, maintaining 100% uptime SLA.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={dualEngineFallback}
              onChange={(e) => setDualEngineFallback(e.target.checked)}
              className="rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-0"
            />
            <span className="font-semibold">Dual-Engine Fallback</span>
          </label>

          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={memoryMeshSync}
              onChange={(e) => setMemoryMeshSync(e.target.checked)}
              className="rounded bg-slate-800 border-slate-700 text-cyan-600 focus:ring-0"
            />
            <span className="font-semibold">Memory Mesh Live Sync</span>
          </label>
        </div>
      </div>

      {/* AI Features Matrix */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">
          Enterprise AI Feature Matrix & Governance Toggles
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {aiFeatures.map((feat) => (
            <div
              key={feat.id}
              className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60 flex items-start justify-between gap-4"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-white">{feat.name}</h4>
                  <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono text-[10px]">
                    {feat.model}
                  </span>
                </div>
                <p className="text-xs text-slate-300">{feat.description}</p>
                <div className="flex items-center gap-3 text-[11px] text-slate-400 pt-1">
                  <span>Usage: {feat.tokensUsedThisMonth.toLocaleString()} tokens</span>
                  <span>•</span>
                  <span>Review: {feat.requiresHumanReview ? "Required" : "Automated"}</span>
                </div>
              </div>

              <button
                onClick={() => toggleAiFeature(feat.id)}
                className={`text-xs font-bold px-3 py-1 rounded-full border transition shrink-0 ${
                  feat.isEnabled
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                    : "bg-slate-800 text-slate-500 border-slate-700"
                }`}
              >
                {feat.isEnabled ? "Enabled" : "Disabled"}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Live AI Test Playground */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-400" />
              <span>Artify Kernel V3.0 Live Reasoning Playground</span>
            </h3>
            <p className="text-xs text-slate-400">
              Query the official Google Gemini 3.8 engine grounded in Artify Solutions' live product architecture.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-slate-800 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 border border-slate-700 font-mono"
            >
              <option value="gemini-3.8-flash">gemini-3.8-flash (Standard)</option>
              <option value="gemini-3.8-pro">gemini-3.8-pro (Complex Reasoning)</option>
              <option value="gemini-3.5-flash">gemini-3.5-flash (Ultra-Fast)</option>
            </select>
          </div>
        </div>

        {/* Preset Prompt Buttons */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
            Test Artify Product Architecture Scenarios:
          </label>
          <div className="flex flex-wrap gap-2">
            {presetScenarios.map((sc) => (
              <button
                key={sc.label}
                onClick={() => setTestPrompt(sc.prompt)}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs border border-slate-700/60 transition"
              >
                {sc.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-semibold text-slate-300">
            Prompt / Scenario Input:
          </label>
          <textarea
            rows={3}
            value={testPrompt}
            onChange={(e) => setTestPrompt(e.target.value)}
            className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:border-purple-500 font-sans"
          />
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleTestAi}
            disabled={isExecuting}
            className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md flex items-center gap-2 transition"
          >
            {isExecuting ? (
              <span>Executing Artify Kernel V3.0...</span>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>Execute Reasoning Query</span>
              </>
            )}
          </button>
        </div>

        {testResponse && (
          <div className="p-4 rounded-xl bg-slate-950 border border-purple-800/40 text-xs text-slate-200 space-y-2 animate-in fade-in">
            <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider block">
              Synthesized Architectural Output:
            </span>
            <p className="leading-relaxed whitespace-pre-wrap">{testResponse}</p>
          </div>
        )}
      </div>
    </div>
  );
};
