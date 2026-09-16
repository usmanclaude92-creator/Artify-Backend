import React, { useState } from "react";
import {
  BarChart3,
  TrendingUp,
  Globe,
  Smartphone,
  Laptop,
  ArrowUpRight,
  Eye,
  Clock,
  Compass
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";

export const AnalyticsModule: React.FC = () => {
  const { selectedDateRange } = useAdminData();

  const topPages = [
    { path: "/", title: "Homepage • Ecosystem Overview", views: 24500, time: "2m 14s", bounce: "32.1%" },
    { path: "/products/artify-erp-one", title: "Artify ERP One Architecture", views: 12800, time: "4m 02s", bounce: "21.4%" },
    { path: "/pricing", title: "Adaptive Enterprise Pricing", views: 9400, time: "3m 45s", bounce: "24.6%" },
    { path: "/ai-solutions", title: "AI Business Suite & Models", views: 8200, time: "3m 10s", bounce: "26.0%" },
    { path: "/blog/why-software-must-adapt-your-business", title: "Whitepaper • Adaptive Philosophy", views: 6100, time: "5m 22s", bounce: "18.5%" }
  ];

  const trafficSources = [
    { source: "Direct Enterprise Inbound", share: "42%", count: "20,265 visitors" },
    { source: "Organic Search (Google)", share: "34%", count: "16,405 visitors" },
    { source: "LinkedIn & B2B Social", share: "16%", count: "7,720 visitors" },
    { source: "Partner / Technology Referrals", share: "8%", count: "3,860 visitors" }
  ];

  const geoLocations = [
    { country: "United States", visitors: "24,120", share: "50%" },
    { country: "United Kingdom", visitors: "8,680", share: "18%" },
    { country: "Germany & EU", visitors: "7,230", share: "15%" },
    { country: "Singapore & APAC", visitors: "5,300", share: "11%" },
    { country: "Others", visitors: "2,920", share: "6%" }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-400" />
            <span>Traffic, Session Diagnostics & Funnel Analytics</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Observability across visitor engagement, enterprise demo conversions, and global platform interactions for ({selectedDateRange}).
          </p>
        </div>
      </div>

      {/* Top Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
          <span className="text-[11px] text-slate-400 uppercase font-semibold">Total Unique Visitors</span>
          <p className="text-2xl font-extrabold text-white mt-1">48,250</p>
          <span className="text-xs text-emerald-400 font-bold flex items-center mt-1">
            <ArrowUpRight className="w-3.5 h-3.5" /> +22.4% vs last period
          </span>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
          <span className="text-[11px] text-slate-400 uppercase font-semibold">Total Page Impressions</span>
          <p className="text-2xl font-extrabold text-white mt-1">184,910</p>
          <span className="text-xs text-slate-400 mt-1 block">3.83 pages per session</span>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
          <span className="text-[11px] text-slate-400 uppercase font-semibold">Avg. Engagement Time</span>
          <p className="text-2xl font-extrabold text-indigo-400 mt-1">3m 48s</p>
          <span className="text-xs text-emerald-400 font-semibold mt-1 block">Deep evaluation sessions</span>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
          <span className="text-[11px] text-slate-400 uppercase font-semibold">Average Bounce Rate</span>
          <p className="text-2xl font-extrabold text-emerald-400 mt-1">26.4%</p>
          <span className="text-xs text-slate-400 mt-1 block">-4.2% lower than industry avg</span>
        </div>
      </div>

      {/* Top Pages & Sources Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Pages */}
        <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4">
            Most Visited Architectural Pages & Whitepapers
          </h3>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-800/60 text-[11px] uppercase text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-3 py-2.5">Page Route</th>
                  <th className="px-3 py-2.5">Views</th>
                  <th className="px-3 py-2.5">Avg Time</th>
                  <th className="px-3 py-2.5 text-right">Bounce Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {topPages.map((pg) => (
                  <tr key={pg.path} className="hover:bg-slate-800/40">
                    <td className="px-3 py-3">
                      <p className="font-semibold text-white">{pg.title}</p>
                      <span className="text-[11px] text-indigo-400 font-mono">{pg.path}</span>
                    </td>
                    <td className="px-3 py-3 font-bold text-white font-mono">
                      {pg.views.toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-slate-300">{pg.time}</td>
                    <td className="px-3 py-3 text-right font-medium text-emerald-400">
                      {pg.bounce}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Traffic Channels */}
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Acquisition Channels
          </h3>
          <div className="space-y-3">
            {trafficSources.map((src) => (
              <div key={src.source} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-medium text-slate-200">{src.source}</span>
                  <span className="font-bold text-indigo-400">{src.share}</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full"
                    style={{ width: src.share }}
                  ></div>
                </div>
                <span className="text-[10px] text-slate-400 block">{src.count}</span>
              </div>
            ))}
          </div>

          <div className="pt-4 border-t border-slate-800">
            <span className="text-[11px] font-bold uppercase text-slate-400 block mb-2">
              Device Form Factors
            </span>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700">
                <Laptop className="w-4 h-4 mx-auto text-indigo-400 mb-1" />
                <span className="block font-bold text-white">74%</span>
                <span className="text-[10px] text-slate-400">Desktop</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700">
                <Smartphone className="w-4 h-4 mx-auto text-cyan-400 mb-1" />
                <span className="block font-bold text-white">22%</span>
                <span className="text-[10px] text-slate-400">Mobile</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700">
                <Compass className="w-4 h-4 mx-auto text-emerald-400 mb-1" />
                <span className="block font-bold text-white">4%</span>
                <span className="text-[10px] text-slate-400">Tablet</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
