export type Tier = "autonomous" | "confirm" | "restricted" | "forbidden";
export type Risk = "read" | "write" | "external" | "high";
export type MemoryKind = "profile" | "semantic" | "episodic" | "project" | "relationship" | "important";

export interface User {
  id: string;
  email: string;
  display_name: string;
  timezone: string;
  locale: string;
  is_owner: boolean;
  totp_enabled: boolean;
  settings: { notify_channels?: string[]; voice?: Record<string, unknown>; theme?: string };
}

export interface Me {
  user: User;
  session: { id: string; kind: string; elevated: boolean };
}

export interface Conversation {
  id: string;
  title: string;
  is_primary: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
  messages?: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "notice";
  content: string;
  channel: string;
  task_id: string | null;
  tool_trace: { name: string; ok: boolean }[];
  attachments: { path: string; name?: string; mime?: string }[];
  meta: Record<string, unknown>;
  created_at: string;
}

export interface Task {
  id: string;
  kind: string;
  status: "queued" | "running" | "waiting_approval" | "succeeded" | "failed" | "cancelled";
  title: string;
  channel: string;
  conversation_id: string | null;
  parent_id: string | null;
  error: string | null;
  attempts: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  result: string | null;
  step: number | null;
}

export interface ToolCallRow {
  id: string;
  tool: string;
  status: string;
  risk: Risk;
  tier: Tier;
  input: Record<string, unknown>;
  output: string | null;
  error: string | null;
  duration_ms: number | null;
  attempts: number;
  at: string;
  task?: string;
  task_id?: string;
}

export interface LlmCallRow {
  id?: string;
  route: string;
  model: string;
  provider?: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens?: number;
  cost_usd: number;
  latency_ms: number;
  status: string;
  stop_reason: string | null;
  error: string | null;
  at: string;
}

export interface Approval {
  id: string;
  task_id: string;
  tool: string;
  summary: string;
  arguments: Record<string, unknown>;
  risk: Risk;
  tier: Tier;
  status: string;
  channel: string;
  expires_at: string;
  created_at: string | null;
}

export interface TaskDetail {
  task: Task;
  input: { text?: string; prompt?: string; agent?: string };
  events: { type: string; data: Record<string, unknown>; at: string }[];
  tool_calls: ToolCallRow[];
  llm_calls: LlmCallRow[];
  approvals: Approval[];
  children: Task[];
}

export interface Memory {
  id: string;
  kind: MemoryKind;
  content: string;
  subject: string | null;
  tags: string[];
  importance: number;
  confidence: number;
  pinned: boolean;
  source: string;
  access_count: number;
  last_accessed_at: string | null;
  created_at: string;
  updated_at: string;
  score?: number;
}

export interface Skill {
  name: string;
  title: string;
  description: string;
  version: string;
  icon: string;
  enabled: boolean;
  triggers: string[];
  tools: string[];
  requires: string[];
  config: Record<string, unknown>;
  error: string | null;
}

export interface ToolInfo {
  name: string;
  description: string;
  risk: Risk;
  tier: Tier;
  tier_reason: string;
  source: string;
  skill: string | null;
  activity: string;
  timeout_s: number;
  retries: number;
  idempotent: boolean;
  requires: string[];
  available: boolean;
  missing: string[];
  input_schema: Record<string, unknown>;
}

export interface Automation {
  id: string;
  name: string;
  kind: "reminder" | "agent";
  schedule_type: "once" | "cron" | "interval";
  cron: string | null;
  run_at: string | null;
  interval_seconds: number | null;
  timezone: string;
  payload: { message?: string; prompt?: string };
  channels: string[];
  enabled: boolean;
  next_run_at: string | null;
  next_run_local: string | null;
  last_run_at: string | null;
  last_status: string | null;
  run_count: number;
  created_by: string;
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  level: string;
  source: string;
  ref: string | null;
  delivered: string[];
  read: boolean;
  created_at: string;
}

export interface Stats {
  period_days: number;
  llm: {
    calls: number;
    cost_usd: number;
    cost_today_usd: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    latency_p50_ms: number;
    latency_p95_ms: number;
    error_rate: number;
    cache_hit_ratio: number;
    daily_limit_usd: number;
    by_model: { model: string; calls: number; cost_usd: number }[];
    daily: { day: string; cost_usd: number; calls: number }[];
  };
  tools: { tool: string; calls: number; failures: number; avg_ms: number; failure_rate: number }[];
  tasks: Record<string, number>;
  active_tasks: number;
  memories: Record<string, number>;
}

export interface SystemStatus {
  version: string;
  env: string;
  brain: {
    configured: boolean;
    demo_mode: boolean;
    provider: "anthropic" | "openai";
    key_name: string;
    main_model: string;
    routes: Record<string, { provider: string; model: string; effort: string | null }>;
  };
  workers: { id: string; running: number; concurrency: number; seen_at: number }[];
  embedded_worker: boolean;
  queue_depth: number;
  embeddings: { model: string; enabled: boolean };
  skills: number;
  tools: number;
  spend_today_usd: number;
  daily_limit_usd: number;
  public_url: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  location: string;
  description: string;
  attendees: string[];
  source: string;
  link: string | null;
}

export interface JarvisEvent {
  type: string;
  ts: string;
  task_id?: string | null;
  conversation_id?: string | null;
  data?: Record<string, any>;
}
