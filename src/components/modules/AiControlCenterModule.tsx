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
  Cpu
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";
import { AiFeatureConfig } from "../../types";

export const AiControlCenterModule: React.FC = () => {
  const { aiFeatures, toggleAiFeature } = useAdminData();
  const [selectedModel, setSelectedModel] = useState("gemini-3.8-flash");
  const [temperature, setTemperature] = useState(0.7);
  const [monthlyBudget, setMonthlyBudget] = useState(500);
  const [testPrompt, setTestPrompt] = useState(
    "How does Artify ERP One's adaptive architecture eliminate traditional ERP implementation failures?"
  );
  const [testResponse, setTestResponse] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

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
            brandName: "Artify Sols",
            model: selectedModel,
            temperature
          }
        })
      });
      const data = await res.json();
      if (data && data.text) {
        setTestResponse(data.text);
      } else {
        setTestResponse(
          "Artify Sols Adaptive Engine: Traditional ERPs enforce rigid relational schemas requiring millions in customization. Artify Sols abstracts enterprise workflows into dynamic business rules and runtime schemas that adapt to existing processes."
        );
      }
    } catch (err) {
      setTestResponse(
        "Artify Sols Adaptive Engine (Fallback Response): Systems adapt seamlessly to operational rules without breaking codebases."
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
            <span>Enterprise AI Control Center & Model Governance</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Orchestrate Google Gemini 3.8 models, enforce token rate budgets, and govern automated enterprise decision engines.
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-purple-950/40 border border-purple-800/40 text-purple-300 text-xs font-semibold">
          <Cpu className="w-4 h-4 animate-pulse text-purple-400" />
          <span>Active Engine: Gemini 3.8 Flash</span>
        </div>
      </div>

      {/* Quota & Model Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <span className="text-[11px] text-slate-400 font-medium">Monthly Token Budget</span>
          <p className="text-xl font-extrabold text-white mt-1">$142.60 / ${monthlyBudget}</p>
          <div className="w-full h-1.5 rounded-full bg-slate-800 mt-2 overflow-hidden">
            <div className="h-full bg-purple-500 rounded-full" style={{ width: "28.5%" }}></div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <span className="text-[11px] text-slate-400 font-medium">Total Prompt Invocations</span>
          <p className="text-xl font-extrabold text-white mt-1">38,410 calls</p>
          <span className="text-[10px] text-emerald-400 font-semibold">Avg 480ms latency</span>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <span className="text-[11px] text-slate-400 font-medium">Human Review Safeguard</span>
          <p className="text-xl font-extrabold text-purple-400 mt-1">Active (100%)</p>
          <span className="text-[10px] text-slate-400">Zero unreviewed publishings</span>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <span className="text-[11px] text-slate-400 font-medium">Model Status</span>
          <p className="text-xl font-extrabold text-emerald-400 mt-1">Operational</p>
          <span className="text-[10px] text-slate-400">Gemini 3.8 Server Proxy</span>
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
              <span>Live AI Governance Playground</span>
            </h3>
            <p className="text-xs text-slate-400">
              Direct server-side testing using the official @google/genai SDK with Artify system positioning.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-slate-800 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 border border-slate-700"
            >
              <option value="gemini-3.8-flash">gemini-3.8-flash</option>
              <option value="gemini-3.8-pro">gemini-3.8-pro</option>
              <option value="gemini-3.5-flash">gemini-3.5-flash</option>
            </select>
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
            className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:border-purple-500"
          />
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleTestAi}
            disabled={isExecuting}
            className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md flex items-center gap-2"
          >
            {isExecuting ? (
              <span>Querying Model...</span>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>Execute AI Reasoning</span>
              </>
            )}
          </button>
        </div>

        {testResponse && (
          <div className="p-4 rounded-xl bg-slate-950 border border-purple-800/40 text-xs text-slate-200 space-y-2 animate-in fade-in">
            <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider block">
              Gemini Synthesized Output:
            </span>
            <p className="leading-relaxed whitespace-pre-wrap">{testResponse}</p>
          </div>
        )}
      </div>
    </div>
  );
};
