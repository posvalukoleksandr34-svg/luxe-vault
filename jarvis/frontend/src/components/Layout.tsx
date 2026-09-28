import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  AudioLines,
  Bell,
  Brain,
  CalendarClock,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  MessagesSquare,
  Plug,
  ScrollText,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";

import { get, post } from "../lib/api";
import { useMe } from "../lib/auth";
import { ago, usd } from "../lib/format";
import { coreStateFrom, useRealtime } from "../lib/realtime";
import type { Approval, Notification, SystemStatus } from "../lib/types";
import { ApprovalCard } from "./Approvals";
import { Orb } from "./Orb";
import { Button, Empty, Kbd, Modal } from "./ui";

export const NAV: { group: string; items: { to: string; label: string; icon: ReactNode }[] }[] = [
  {
    group: "Ядро",
    items: [
      { to: "/", label: "Dashboard", icon: <LayoutDashboard className="size-4" /> },
      { to: "/chat", label: "Чат", icon: <MessagesSquare className="size-4" /> },
      { to: "/voice", label: "Голос", icon: <AudioLines className="size-4" /> },
    ],
  },
  {
    group: "Работа",
    items: [
      { to: "/tasks", label: "Задачи", icon: <ListChecks className="size-4" /> },
      { to: "/automations", label: "Автоматизации", icon: <CalendarClock className="size-4" /> },
    ],
  },
  {
    group: "Разум",
    items: [
      { to: "/memory", label: "Память", icon: <Brain className="size-4" /> },
      { to: "/skills", label: "Навыки", icon: <Sparkles className="size-4" /> },
      { to: "/tools", label: "Инструменты", icon: <Wrench className="size-4" /> },
    ],
  },
  {
    group: "Контроль",
    items: [
      { to: "/permissions", label: "Разрешения", icon: <ShieldCheck className="size-4" /> },
      { to: "/integrations", label: "Интеграции", icon: <Plug className="size-4" /> },
      { to: "/logs", label: "Журнал", icon: <ScrollText className="size-4" /> },
      { to: "/settings", label: "Настройки", icon: <Settings className="size-4" /> },
    ],
  },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { status, connected, voiceState } = useRealtime();
  const core = coreStateFrom(status, connected, voiceState);
  const me = useMe();
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: () => post("/api/auth/logout"),
    onSettled: () => {
      qc.setQueryData(["me"], null);
      location.href = "/login";
    },
  });
  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-5 pb-4">
        <Orb state={core} size={38} showLabel />
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-2.5 pb-4">
        {NAV.map((g) => (
          <div key={g.group}>
            <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">{g.group}</p>
            <ul className="space-y-0.5">
              {g.items.map((it) => (
                <li key={it.to}>
                  <NavLink
                    to={it.to}
                    end={it.to === "/"}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      clsx(
                        "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors",
                        isActive ? "bg-accent-soft text-text" : "text-muted hover:bg-hover hover:text-text",
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span className={isActive ? "text-accent" : ""}>{it.icon}</span>
                        {it.label}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-line px-3 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-full bg-elevated text-xs font-semibold text-muted">
            {(me.data?.user.display_name ?? "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{me.data?.user.display_name}</p>
            <p className="truncate text-[11px] text-faint">{me.data?.user.email}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => logout.mutate()} aria-label="Выйти" title="Выйти">
            <LogOut className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function ApprovalsButton() {
  const { data } = useQuery({ queryKey: ["approvals"], queryFn: () => get<{ approvals: Approval[] }>("/api/approvals"), refetchInterval: 30_000 });
  const [open, setOpen] = useState(false);
  const items = data?.approvals ?? [];
  if (!items.length) return null;
  return (
    <>
      <Button size="sm" variant="outline" className="border-warn/40 text-warn" icon={<ShieldAlert className="size-3.5" />} onClick={() => setOpen(true)}
        aria-label={`${items.length} ждёт подтверждения`}>
        {items.length}<span className="hidden sm:inline"> ждёт подтверждения</span>
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Подтверждения" wide>
        <div className="space-y-3">
          {items.map((a) => (
            <ApprovalCard key={a.id} approval={a} />
          ))}
        </div>
      </Modal>
    </>
  );
}

function NotificationsButton() {
  const qc = useQueryClient();
  const unreadLive = useRealtime((s) => s.unread);
  const setUnread = useRealtime((s) => s.setUnread);
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => get<{ notifications: Notification[] }>("/api/notifications?limit=30"),
  });
  const unread = (data?.notifications ?? []).filter((n) => !n.read).length;
  useEffect(() => setUnread(unread), [unread, setUnread]);
  const markRead = useMutation({
    mutationFn: () => post("/api/notifications/read", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  return (
    <>
      <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Уведомления" className="relative">
        <Bell className="size-4" />
        {unreadLive > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-accent shadow-glow" />}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Уведомления"
        footer={<Button size="sm" variant="ghost" onClick={() => markRead.mutate()}>Отметить все прочитанными</Button>}
      >
        {!data?.notifications.length ? (
          <Empty title="Уведомлений нет" />
        ) : (
          <ul className="divide-y divide-line">
            {data.notifications.map((n) => (
              <li key={n.id} className="py-2.5">
                <div className="flex items-start gap-2">
                  {!n.read && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />}
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{n.title}</p>
                    {n.body && <p className="mt-0.5 line-clamp-3 text-xs text-muted whitespace-pre-line">{n.body}</p>}
                    <p className="mt-1 text-[11px] text-faint">{ago(n.created_at)} · {n.delivered.join(", ")}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const items = useMemo(() => NAV.flatMap((g) => g.items).filter((i) => i.label.toLowerCase().includes(q.toLowerCase())), [q]);
  useEffect(() => {
    if (open) setQ("");
  }, [open]);
  if (!open) return null;
  const ask = async () => {
    if (!q.trim()) return;
    const r = await post<{ conversation_id: string }>("/api/chat", { text: q });
    onClose();
    navigate(`/chat/${r.conversation_id}`);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-line-strong bg-elevated shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 text-faint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") ask();
              if (e.key === "Escape") onClose();
            }}
            placeholder="Спросите JARVIS или перейдите к разделу…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto p-2">
          {q.trim() && (
            <li>
              <button onClick={ask} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-hover">
                <MessagesSquare className="size-4 text-accent" />
                <span className="truncate">Спросить JARVIS: «{q}»</span>
                <span className="ml-auto"><Kbd>Enter</Kbd></span>
              </button>
            </li>
          )}
          {items.map((it) => (
            <li key={it.to}>
              <button
                onClick={() => {
                  navigate(it.to);
                  onClose();
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-hover hover:text-text"
              >
                {it.icon}
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const loc = useLocation();
  const { data: sys } = useQuery({ queryKey: ["system"], queryFn: () => get<SystemStatus>("/api/system/status"), refetchInterval: 30_000 });
  const connected = useRealtime((s) => s.connected);
  useEffect(() => setMobileOpen(false), [loc.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const fullBleed = loc.pathname.startsWith("/chat") || loc.pathname.startsWith("/voice");

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 border-r border-line bg-surface lg:block">
        <Sidebar />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMobileOpen(false)}>
          <aside className="h-full w-64 border-r border-line bg-surface" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end p-2">
              <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)} aria-label="Закрыть меню">
                <X className="size-4" />
              </Button>
            </div>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-13 shrink-0 items-center gap-2 border-b border-line bg-bg/80 px-3 backdrop-blur sm:px-5">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Меню">
            <Menu className="size-4" />
          </Button>
          <button
            onClick={() => setPalette(true)}
            className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-left text-[13px] text-faint hover:border-line-strong sm:max-w-md"
          >
            <Search className="size-3.5 shrink-0" />
            <span className="hidden truncate sm:inline">Спросить JARVIS или найти…</span>
            <span className="ml-auto hidden sm:inline"><Kbd>Ctrl K</Kbd></span>
          </button>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <ApprovalsButton />
            {sys && (
              <span
                className="hidden rounded-md border border-line px-2 py-1 font-mono text-[11px] text-muted tabular md:inline"
                title="Расходы на модели сегодня / дневной лимит"
              >
                {usd(sys.spend_today_usd)} / {usd(sys.daily_limit_usd, 0)}
              </span>
            )}
            <span
              className={clsx("size-2 rounded-full", connected ? "bg-ok" : "bg-danger animate-pulse-soft")}
              title={connected ? "Realtime подключён" : "Нет соединения — переподключаюсь"}
            />
            <NotificationsButton />
          </div>
        </header>
        {sys && !sys.brain.configured && (
          <div className="border-b border-warn/25 bg-warn/[0.07] px-5 py-2 text-xs text-warn">
            Мозг не подключён: добавьте ключ {sys.brain.provider === "openai" ? "OpenAI" : "Anthropic"} в{" "}
            <NavLink to="/settings" className="underline">Настройки → Ключи API</NavLink> или переменную{" "}
            {sys.brain.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"}.
          </div>
        )}
        {sys?.brain.demo_mode && (
          <div className="border-b border-violet/25 bg-violet/[0.07] px-5 py-2 text-xs text-violet">
            Демо-режим: вместо языковой модели работает детерминированный набор правил (JARVIS_FAKE_LLM=true).
          </div>
        )}
        <main className={clsx("min-h-0 flex-1", fullBleed ? "overflow-hidden" : "overflow-y-auto")}>
          {fullBleed ? (
            <Outlet />
          ) : (
            <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
              <Outlet />
            </div>
          )}
        </main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}
