export interface Chat {
  id: string;
  tg_chat_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  chat_type: "private" | "group" | "channel" | "bot";
  is_blocked: boolean;
  unread_count: number;
  last_message_at: string | null;
  created_at: string;
  ai_context: string | null;
  slash_only: boolean;
}

export interface Message {
  id: string;
  chat_id: string;
  tg_message_id: string | null;
  direction: "in" | "out";
  text: string;
  source: "user" | "ai" | "manual";
  created_at: string;
}

export interface Settings {
  auto_reply_enabled: boolean;
  persona: string;
  user_name: string;
  ai_username: string;
  temperature: number;
  gemini_model: string;
  workspace_root: string;
  shell_allow: string[];
  shell_deny: string[];
  reply_delay_ms: number;
  bot_prefix: string;
  reaction_thinking: string;
  reaction_done: string;
}

export interface Rule {
  id: string;
  type: "allow" | "block";
  match: string;
  note: string | null;
  created_at: string;
}

export interface Reminder {
  id: string;
  target_chat_id: string;
  message: string;
  cron_expr: string | null;
  fire_at: string | null;
  source: "ai" | "user";
  active: boolean;
  fired: boolean;
  next_fire_at: string | null;
  created_at: string;
  contact_first_name?: string | null;
  contact_last_name?: string | null;
  contact_username?: string | null;
  contact_tg_chat_id?: string | null;
}

export interface ToolAuditEntry {
  id: string;
  chat_id: string | null;
  tool_name: string;
  args: unknown;
  result: unknown;
  ok: boolean;
  created_at: string;
}

export type KanbanStatus = "todo" | "in_progress" | "done";

export interface KanbanTask {
  id: string;
  title: string;
  description: string;
  status: KanbanStatus;
  assignee_chat_id: string | null;
  assignee_name: string | null;
  created_at: string;
  updated_at: string;
  comment_count?: number;
}

export interface KanbanComment {
  id: string;
  task_id: string;
  author: string;
  body: string;
  created_at: string;
}

export type ApplicationType = "code" | "ai_only";

export interface Application {
  id: string;
  slug: string;
  name: string;
  type: ApplicationType;
  description: string;
  system_prompt: string | null;
  knowledge_base: string | null;
  database_url: string | null;
  is_global_default: boolean;
  enabled: boolean;
  registry_slug: string | null;
  installed_path: string | null;
  source_type: "git" | "local" | null;
  created_at: string;
}

export interface ApplicationMetricSummary {
  id: string;
  slug: string;
  name: string;
  type: ApplicationType;
  enabled: boolean;
  calls_ok: number;
  calls_err: number;
  slash_dispatched_total: number;
  slash_dispatched_by_cmd: Array<{ cmd: string; ok: number; err: number }>;
  duration: HistogramSnapshot | null;
  custom_counters: Record<string, number>;
}

export interface AppMetricsTimeseriesPoint {
  // Unix ms; matches `Date.now()` output. JSON-safe, 2x smaller than ISO,
  // no client parse cost.
  t: number;
  v: number;
}

export interface AppMetricsTimeseries {
  name: string;
  points: AppMetricsTimeseriesPoint[];
}

export interface AppMetricsDetail {
  application: ApplicationMetricSummary;
  timeseries: AppMetricsTimeseries[];
}

export interface ApplicationSlashCommandManifest {
  name: string;
  description: string;
}

export interface ApplicationProfileResponse {
  profile: object | null;
  source: "override" | "seed" | "none";
}

export interface ApplicationRegistryEntry {
  slug: string;
  name: string;
  type: ApplicationType;
  description: string;
  required_env_vars: string[];
  system_prompt: string | null;
  knowledge_base: string | null;
  has_hook: boolean;
  installed: boolean;
  slash_commands: ApplicationSlashCommandManifest[];
  source_type: "git" | "local";
  source_url: string | null;
  source_path: string | null;
  installed_path: string | null;
}

export interface ApplicationRegistryRow {
  id: string;
  slug: string;
  source_type: "git" | "local";
  source_url: string | null;
  source_path: string | null;
  created_at: string;
}

export interface CreateApplicationRegistryBody {
  slug: string;
  source_type: "git" | "local";
  source_url?: string;
  source_path?: string;
}

export interface InstallApplicationBody {
  is_global_default?: boolean;
}

export interface ApplicationChatAssignment {
  application_id: string;
  chat_id: string;
  enabled: boolean;
  created_at: string;
}

export interface CreateApplicationBody {
  slug: string;
  name: string;
  type: ApplicationType;
  description?: string;
  system_prompt?: string | null;
  knowledge_base?: string | null;
  database_url?: string | null;
  is_global_default?: boolean;
}

export interface UpdateApplicationBody {
  slug?: string;
  name?: string;
  description?: string;
  system_prompt?: string | null;
  knowledge_base?: string | null;
  database_url?: string | null;
  is_global_default?: boolean;
  enabled?: boolean;
}

export interface SetApplicationChatBody {
  enabled?: boolean;
}

export interface ApplicationFile {
  id: string;
  application_id: string;
  chat_id: string | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  gemini_file_uri: string | null;
  gemini_expires_at: string | null;
  created_at: string;
}

export interface KundaliMatchRow {
  id: string;
  data: Record<string, unknown>;
  created_at: string;
}

export type WsEvent =
  | { type: "message:new"; payload: { chat: Chat; message: Message } }
  | { type: "message:sent"; payload: { chat: Chat; message: Message } }
  | { type: "reminder:fired"; payload: { reminder: Reminder } }
  | { type: "tool:invoked"; payload: { entry: ToolAuditEntry } }
  | { type: "chat:updated"; payload: { chat: Chat } }
  | { type: "chat:deleted"; payload: { chat_id: string } }
  | { type: "kanban:task_changed"; payload: { task: KanbanTask; deleted?: boolean } }
  | { type: "kanban:comment_added"; payload: { comment: KanbanComment } }
  | { type: "application:changed"; payload: { application: Application; deleted?: boolean } }
  | {
      type: "application_chat:changed";
      payload: { application_id: string; chat_id: string; removed?: boolean };
    };

export interface SendMessageBody {
  text: string;
}

export interface CreateRuleBody {
  type: "allow" | "block";
  match: string;
  note?: string;
}

export interface CreateReminderBody {
  target_chat_id: string;
  message: string;
  cron_expr?: string;
  fire_at?: string;
}

export interface CreateKanbanTaskBody {
  title: string;
  description?: string;
  status?: KanbanStatus;
  assignee_chat_id?: string | null;
}

export interface UpdateKanbanTaskBody {
  title?: string;
  description?: string;
  status?: KanbanStatus;
  assignee_chat_id?: string | null;
}

export interface CreateKanbanCommentBody {
  author?: string;
  body: string;
}

export interface MCPServer {
  id: string;
  name: string;
  type: "stdio" | "sse";
  command: string | null;
  url: string | null;
  env: Record<string, string>;
  enabled: boolean;
  created_at: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
  path: string | null;
  enabled: boolean;
  created_at: string;
}

export interface CreateSkillBody {
  name: string;
  description?: string;
  content?: string;
  path?: string | null;
}

export interface UpdateSkillBody {
  name?: string;
  description?: string;
  content?: string;
  path?: string | null;
  enabled?: boolean;
}

export type SlashCommandType = "shell" | "message" | "ai_prompt" | "noop";

export interface SlashCommand {
  id: string;
  name: string;
  description: string;
  type: SlashCommandType;
  action: string;
  enabled: boolean;
  created_at: string;
}

export interface CreateSlashCommandBody {
  name: string;
  description?: string;
  type: SlashCommandType;
  action: string;
}

export interface UpdateSlashCommandBody {
  name?: string;
  description?: string;
  type?: SlashCommandType;
  action?: string;
  enabled?: boolean;
}

export interface LoginBody {
  password: string;
}

export interface TelegramBotConfig {
  id: string;
  token: string;
  system_prompt: string;
  enabled: boolean;
  created_at: string;
}

export interface UpdateTelegramBotConfigBody {
  token?: string;
  system_prompt?: string;
  enabled?: boolean;
}

export interface HealthResponse {
  telegram_connected: boolean;
  uptime_s: number;
}

export interface HistogramSnapshot {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

export interface ErrorBucket {
  level: "warn" | "error";
  source: string;
  message: string;
  count: number;
  last_seen: string;
}

export interface MetricsResponse {
  generated_at: string;
  server: {
    uptime_s: number;
    ready: boolean;
    telegram_connected: boolean;
    bot_connected: boolean;
    db_ping_ms: number | null;
    last_migration: { filename: string; applied_at: string } | null;
    snapshot_at: string | null;
  };
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, HistogramSnapshot>;
  errors_recent: ErrorBucket[];
  telegram: {
    chats_total: number;
    chats_by_type: Record<"private" | "group" | "channel" | "bot", number>;
    chats_blocked: number;
    chats_active_24h: number;
    messages_total: number;
    messages_in_1h: number;
    messages_in_24h: number;
    messages_in_7d: number;
    messages_out_1h: number;
    messages_out_24h: number;
    messages_out_7d: number;
    messages_by_source_24h: Record<"user" | "ai" | "manual", number>;
    messages_hourly_24h: Array<{ hour: string; in: number; out: number }>;
  };
  bot: {
    configured: boolean;
    enabled: boolean;
    pending_choices_outstanding: number;
    pending_choices_consumed: number;
    pending_choices_expired: number;
    pending_choices_total: number;
  };
  ai: {
    tool_calls_total: number;
    tool_calls_24h: number;
    tool_calls_24h_by_tool: Array<{ tool_name: string; ok: number; err: number }>;
    // Mirror of counters["gemini.cost_micro_usd"] — provided here so the dashboard
    // selector is one path. Persisted via the existing counter-restore.
    cost_micro_usd_total: number;
    // Flux-computed delta of the cost counter over the last 24h.
    // null when Influx is unconfigured OR the query failed.
    cost_micro_usd_24h: number | null;
    pricing: {
      model_id: string;
      input_per_1m_usd: number | null;
      output_per_1m_usd: number | null;
      fetched_at: string | null;
      source_url: string | null;
      is_override: boolean;
    };
  };
  mcp: {
    total: number;
    enabled: number;
    connected: number;
    servers: Array<{ name: string; enabled: boolean; connected: boolean }>;
  };
  scheduler: {
    reminders_total: number;
    reminders_active: number;
    reminders_fired: number;
    jobs_scheduled_in_memory: number;
  };
  slash: {
    total: number;
    enabled: number;
  };
  skills: {
    total: number;
    enabled: number;
  };
  kanban: {
    todo: number;
    in_progress: number;
    done: number;
    total: number;
    comments_total: number;
  };
  polls: {
    total: number;
  };
  rules: {
    allow: number;
    block: number;
  };
  db: {
    table_rows: Record<string, number>;
  };
  applications: ApplicationMetricSummary[];
}

export interface MetricsTimeseriesResponse {
  metric: string;
  points: Array<{ t: string; value: number }>;
}

export interface UpdatePricingOverrideBody {
  model_id?: string;
  override_input_per_1m_usd: number | null;
  override_output_per_1m_usd: number | null;
}

export interface ApplicationMessage {
  id: string;
  application_id: string;
  tg_chat_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface ApplicationChat {
  tg_chat_id: string;
  message_count: number;
  last_at: string;
  last_preview: string;
}
