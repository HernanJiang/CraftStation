/**
 * Browser-only UI preview entry (served by the Vite dev server at
 * /ui-preview.html). Replicates the full v0.2.0 home-screen layout — sidebar,
 * tabs, update banner, hero, composer — as pure UI without the Electron
 * bridge, so UI iterations can be reviewed in a plain browser with HMR.
 *
 * The Craft Table tab mounts the REAL CraftingGrid component; its onCraft is
 * stubbed to render the compiled CraftResult JSON instead of launching a
 * thread. Everything else is static review markup.
 */
import "./tailwind.css";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  ArrowUp,
  Bell,
  Briefcase,
  Calendar,
  CircleGauge,
  Download,
  FolderGit2,
  GitPullRequest,
  Globe,
  Hammer,
  House,
  Menu,
  Mic,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  Shield,
  Smartphone,
  Sparkles,
  SquareTerminal,
  Zap,
} from "lucide-react";
import { BrandWordmark } from "@/renderer/components/common/BrandWordmark";
import { CraftingGrid } from "@/renderer/components/crafting/CraftingGrid";
import type { CraftResult } from "@/shared/crafting";

document.documentElement.classList.add("dark");
document.documentElement.dataset.theme = "dark";

const sidebarItemClass =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-[var(--row-hover,rgba(255,255,255,0.04))] hover:text-foreground";

function Sidebar() {
  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-border bg-[var(--surface)]">
      <div className="flex items-center gap-1 px-3 pt-3 pb-2 text-muted">
        {[House, Search, FolderGit2, Menu, Globe].map((Icon, i) => (
          <button
            key={i}
            type="button"
            className="rounded-md p-1.5 transition-colors hover:bg-[var(--row-hover,rgba(255,255,255,0.04))] hover:text-foreground"
          >
            <Icon className="size-4" />
          </button>
        ))}
      </div>
      <div className="px-3">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg bg-[var(--surface-secondary)] px-2.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-[var(--row-hover,rgba(255,255,255,0.06))]"
        >
          <Plus className="size-4" />
          新线程
        </button>
      </div>
      <div className="flex-1" />
      <div className="flex flex-col gap-0.5 border-t border-border px-3 py-2">
        <div className="px-2.5 py-1 text-xs text-muted">用量</div>
        <div className="flex justify-center py-1">
          <CircleGauge className="size-9 text-muted" />
        </div>
      </div>
      <div className="flex flex-col gap-0.5 border-t border-border px-3 py-2">
        <button type="button" className={sidebarItemClass}>
          <Briefcase className="size-4" /> Work
        </button>
        <button type="button" className={sidebarItemClass}>
          <GitPullRequest className="size-4" /> 拉取请求
        </button>
        <button type="button" className={sidebarItemClass}>
          <Calendar className="size-4" /> 计划
        </button>
        <button type="button" className={`${sidebarItemClass} justify-between`}>
          <span className="flex items-center gap-2.5">
            <Settings className="size-4" /> 设置
          </span>
          <Smartphone className="size-3.5 opacity-60" />
        </button>
        <button type="button" className={`${sidebarItemClass} justify-between`}>
          <span className="flex items-center gap-2.5">
            <PanelLeftClose className="size-4" /> 隐藏侧边栏
          </span>
        </button>
      </div>
    </aside>
  );
}

function Composer() {
  return (
    <div className="w-full max-w-[680px] rounded-2xl border border-border bg-[var(--surface)] p-3.5 shadow-xl">
      <p className="px-1 pb-6 text-sm text-muted">发送消息…</p>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 rounded-full px-1 py-1 text-sm font-medium text-foreground">
          <Sparkles className="size-4" /> ChatGPT-5.6-Sol
        </span>
        <span className="flex items-center gap-1.5 text-sm text-muted">
          <Zap className="size-3.5" /> High · 400k
        </span>
        <Zap className="size-4 text-muted" />
        <span className="flex items-center gap-1.5 text-sm text-muted">
          <Hammer className="size-4" /> 工作
        </span>
        <Shield className="size-4 text-muted" />
        <div className="flex-1" />
        <Plus className="size-4.5 text-muted" />
        <Mic className="size-4.5 text-muted" />
        <button
          type="button"
          className="rounded-full bg-[var(--surface-secondary)] p-2 text-foreground transition-colors hover:bg-[var(--row-hover,rgba(255,255,255,0.08))]"
        >
          <ArrowUp className="size-4" />
        </button>
      </div>
    </div>
  );
}

function PreviewApp() {
  const [tab, setTab] = useState<"home" | "craft">("home");
  const [lastResult, setLastResult] = useState<string | null>(null);

  const handleCraft = async (result: CraftResult, prompt: string) => {
    setLastResult(JSON.stringify({ prompt, result }, null, 2));
  };

  return (
    <div className="flex h-screen bg-[var(--content-background)] text-foreground">
      <Sidebar />

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col px-8 pt-10 pb-12">
          {/* Tabs */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setTab("home")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  tab === "home"
                    ? "border border-border bg-[var(--surface-secondary)] font-medium text-foreground"
                    : "border border-transparent text-muted hover:text-foreground"
                }`}
              >
                <House className="size-4" /> Home
              </button>
              <button
                type="button"
                onClick={() => setTab("craft")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  tab === "craft"
                    ? "border border-amber-500/40 bg-amber-500/15 font-medium text-amber-400"
                    : "border border-transparent text-muted hover:text-foreground"
                }`}
              >
                <Sparkles className="size-4" /> Craft Table
              </button>
            </div>
            <div className="flex items-center gap-3 text-sm text-muted">
              <span className="flex items-center gap-1.5">
                <SquareTerminal className="size-4" /> 聊天
              </span>
              <span className="opacity-40">|</span>
              <span className="flex items-center gap-1.5">
                <SquareTerminal className="size-4" /> CLI
              </span>
            </div>
          </div>

          {/* Update banner */}
          <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-border bg-[var(--surface)] px-4 py-2.5 text-sm">
            <Download className="size-4 shrink-0 text-muted" />
            <span className="font-medium">可用更新</span>
            <span className="min-w-0 flex-1 truncate text-muted">
              Codex: Windows · v0.146.0 → v0.149.0 · codex update
            </span>
            <button
              type="button"
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-muted transition-colors hover:bg-[var(--row-hover,rgba(255,255,255,0.06))] hover:text-foreground"
            >
              <Download className="size-3.5" /> 更新
            </button>
          </div>

          {tab === "home" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-10 py-10">
              <div className="text-center">
                <h1 className="text-[clamp(1.875rem,4.25vw,3.125rem)] font-semibold leading-[1.28] tracking-normal">
                  <BrandWordmark className="inline-block pr-[0.04em] pb-[0.12em]" />
                </h1>
                <div className="mt-3 flex flex-col items-center gap-3">
                  <p className="text-sm tracking-wide text-muted">
                    Agent Runtime Composition System
                  </p>
                  <div aria-hidden="true" className="flex items-center gap-2 opacity-80">
                    <span className="size-2.5 rounded-[3px] border border-border bg-[var(--surface-secondary)]" />
                    <span className="size-2.5 rounded-[3px] border border-border bg-[var(--surface-secondary)]" />
                    <ArrowRight className="size-3 text-muted" />
                    <span className="size-2.5 rounded-[3px] border border-amber-500/50 bg-amber-500/15" />
                  </div>
                </div>
              </div>
              <Composer />
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center gap-6 py-8">
              <CraftingGrid onCraft={handleCraft} />
              {lastResult && (
                <pre className="w-full max-w-3xl overflow-x-auto rounded-lg border border-border bg-[var(--surface)] p-4 text-left font-mono text-xs text-muted">
                  {lastResult}
                </pre>
              )}
            </div>
          )}

          <div className="mt-auto flex items-center justify-center gap-1.5 pt-8 text-xs text-muted/60">
            <Bell className="size-3" /> UI Preview v0.2.0 · 纯界面预览，不含功能
          </div>
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<PreviewApp />);
