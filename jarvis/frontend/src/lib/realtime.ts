/** Live event stream: one WebSocket, fanned out into a small store the whole UI reads from. */
import { create } from "zustand";

import type { JarvisEvent } from "./types";

/** What the assistant is doing right now — drives the orb everywhere (IDLE / LISTENING / THINKING /
 * EXECUTING (`tool`) / SPEAKING / ERROR, plus waiting for approval and offline). */
export type CoreState = "offline" | "idle" | "thinking" | "tool" | "waiting" | "speaking" | "listening" | "error";

const ERROR_SHOW_MS = 6000;

interface StreamState {
  text: string;
  conversationId: string | null;
}

interface RealtimeState {
  connected: boolean;
  events: JarvisEvent[];
  streams: Record<string, StreamState>;
  status: Record<string, { state: string; label: string; at: number }>;
  unread: number;
  voiceState: CoreState | null;
  push: (e: JarvisEvent) => void;
  setConnected: (v: boolean) => void;
  clearStream: (taskId: string) => void;
  setUnread: (n: number) => void;
  setVoiceState: (s: CoreState | null) => void;
}

const FEED_TYPES = new Set([
  "task.updated",
  "tool.started",
  "tool.finished",
  "approval.requested",
  "approval.resolved",
  "notification",
  "message.completed",
  "message.created",
]);

export const useRealtime = create<RealtimeState>((set) => ({
  connected: false,
  events: [],
  streams: {},
  status: {},
  unread: 0,
  voiceState: null,
  setConnected: (v) => set({ connected: v }),
  setUnread: (n) => set({ unread: n }),
  setVoiceState: (s) => set({ voiceState: s }),
  clearStream: (taskId) =>
    set((s) => {
      const { [taskId]: _, ...rest } = s.streams;
      return { streams: rest };
    }),
  push: (e) =>
    set((s) => {
      const next: Partial<RealtimeState> = {};
      const tid = e.task_id ?? undefined;
      if (e.type === "message.delta" && tid) {
        const prev = s.streams[tid] ?? { text: "", conversationId: e.conversation_id ?? null };
        next.streams = { ...s.streams, [tid]: { ...prev, text: prev.text + (e.data?.text ?? "") } };
      }
      if (e.type === "agent.status" && tid) {
        const state = e.data?.state === "executing" ? "tool" : e.data?.state;
        next.status = { ...s.status, [tid]: { state, label: e.data?.label, at: Date.now() } };
      }
      if (e.type === "tool.started" && tid) {
        next.status = {
          ...s.status,
          [tid]: { state: "tool", label: e.data?.activity ?? e.data?.tool, at: Date.now() },
        };
      }
      if (e.type === "task.updated" && tid && ["succeeded", "failed", "cancelled"].includes(e.data?.status)) {
        const { [tid]: _, ...rest } = s.status;
        // a failed task shows ERROR briefly instead of silently returning to idle
        next.status = e.data?.status === "failed" ? { ...rest, [tid]: { state: "error", label: "Ошибка", at: Date.now() } } : rest;
      }
      if (e.type === "notification") next.unread = s.unread + 1;
      if (FEED_TYPES.has(e.type)) next.events = [e, ...s.events].slice(0, 200);
      return next;
    }),
}));

export function coreStateFrom(status: RealtimeState["status"], connected: boolean, voice: CoreState | null): CoreState {
  if (!connected) return "offline";
  if (voice && voice !== "idle") return voice;
  const now = Date.now();
  const fresh = Object.values(status).filter((s) => now - s.at < (s.state === "error" ? ERROR_SHOW_MS : 10 * 60_000));
  const states = fresh.map((s) => s.state);
  if (states.includes("waiting_approval")) return "waiting";
  if (states.includes("tool")) return "tool";
  if (states.some((s) => s === "thinking" || s === "transcribing")) return "thinking";
  if (states.includes("error")) return "error";
  return "idle";
}

type Listener = (e: JarvisEvent) => void;
const listeners = new Set<Listener>();
export function onEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let socket: WebSocket | null = null;
let retry = 0;
let stopped = false;

export function connectRealtime() {
  stopped = false;
  if (socket && socket.readyState <= 1) return;
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`;
  const ws = new WebSocket(url);
  socket = ws;
  let ping: ReturnType<typeof setInterval> | undefined;
  ws.onopen = () => {
    retry = 0;
    useRealtime.getState().setConnected(true);
    ping = setInterval(() => ws.readyState === 1 && ws.send("ping"), 25_000);
  };
  ws.onmessage = (m) => {
    try {
      const e = JSON.parse(m.data) as JarvisEvent;
      if (e.type === "pong") return;
      useRealtime.getState().push(e);
      listeners.forEach((fn) => fn(e));
    } catch {
      /* ignore malformed frames */
    }
  };
  ws.onclose = () => {
    clearInterval(ping);
    useRealtime.getState().setConnected(false);
    socket = null;
    if (stopped) return;
    retry = Math.min(retry + 1, 6);
    setTimeout(connectRealtime, 500 * 2 ** retry);
  };
}

export function disconnectRealtime() {
  stopped = true;
  socket?.close();
}
