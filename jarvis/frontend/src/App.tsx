import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router";

import { ElevateProvider } from "./components/Elevate";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { setUnauthorizedHandler } from "./lib/api";
import { useMe } from "./lib/auth";
import { connectRealtime, disconnectRealtime, onEvent } from "./lib/realtime";
import { AutomationsPage } from "./pages/Automations";
import { CommandsPage } from "./pages/Commands";
import { ChatPage } from "./pages/Chat";
import { DashboardPage } from "./pages/Dashboard";
import { IntegrationsPage } from "./pages/Integrations";
import { LoginPage } from "./pages/Login";
import { LogsPage } from "./pages/Logs";
import { MemoryPage } from "./pages/Memory";
import { PermissionsPage } from "./pages/Permissions";
import { SettingsPage } from "./pages/Settings";
import { SkillsPage } from "./pages/Skills";
import { TasksPage } from "./pages/Tasks";
import { ToolsPage } from "./pages/Tools";
import { VoicePage } from "./pages/Voice";

/** Keeps react-query caches in sync with server events so every screen is live. */
function LiveSync() {
  const qc = useQueryClient();
  useEffect(() => {
    connectRealtime();
    const off = onEvent((e) => {
      switch (e.type) {
        case "task.updated":
          qc.invalidateQueries({ queryKey: ["tasks"] });
          qc.invalidateQueries({ queryKey: ["task", e.task_id] });
          qc.invalidateQueries({ queryKey: ["stats"] });
          if (["succeeded", "failed"].includes(e.data?.status)) qc.invalidateQueries({ queryKey: ["system"] });
          break;
        case "approval.requested":
        case "approval.resolved":
          qc.invalidateQueries({ queryKey: ["approvals"] });
          break;
        case "notification":
          qc.invalidateQueries({ queryKey: ["notifications"] });
          qc.invalidateQueries({ queryKey: ["automations"] });
          break;
        case "message.completed":
        case "message.created":
          qc.invalidateQueries({ queryKey: ["messages", e.conversation_id] });
          qc.invalidateQueries({ queryKey: ["conversations"] });
          break;
        case "tool.finished":
          if (typeof e.data?.tool === "string") {
            const tool: string = e.data.tool;
            if (tool.startsWith("memory_")) qc.invalidateQueries({ queryKey: ["memory"] });
            if (tool.startsWith("reminder_") || tool.startsWith("automation_")) qc.invalidateQueries({ queryKey: ["automations"] });
            if (tool.startsWith("calendar_")) qc.invalidateQueries({ queryKey: ["calendar"] });
          }
          break;
      }
    });
    return () => {
      off();
      disconnectRealtime();
    };
  }, [qc]);
  return null;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const loc = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.setQueryData(["me"], null);
      navigate("/login", { replace: true });
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate, qc]);
  if (me.isLoading)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  if (!me.data) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return (
    <>
      <LiveSync />
      <ElevateProvider />
      {children}
    </>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/mini" element={<RequireAuth><div className="h-dvh"><VoicePage compact /></div></RequireAuth>} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="chat/:conversationId" element={<ChatPage />} />
        <Route path="voice" element={<VoicePage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="automations" element={<AutomationsPage />} />
        <Route path="commands" element={<CommandsPage />} />
        <Route path="memory" element={<MemoryPage />} />
        <Route path="skills" element={<SkillsPage />} />
        <Route path="tools" element={<ToolsPage />} />
        <Route path="permissions" element={<PermissionsPage />} />
        <Route path="integrations" element={<IntegrationsPage />} />
        <Route path="logs" element={<LogsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
