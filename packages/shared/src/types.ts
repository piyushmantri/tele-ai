export interface Chat {
  id: string;
  tg_chat_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  chat_type: "private" | "group" | "channel";
  is_blocked: boolean;
  unread_count: number;
  last_message_at: string | null;
  created_at: string;
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

export type WsEvent =
  | { type: "message:new"; payload: { chat: Chat; message: Message } }
  | { type: "message:sent"; payload: { chat: Chat; message: Message } }
  | { type: "reminder:fired"; payload: { reminder: Reminder } }
  | { type: "tool:invoked"; payload: { entry: ToolAuditEntry } }
  | { type: "chat:updated"; payload: { chat: Chat } }
  | { type: "kanban:task_changed"; payload: { task: KanbanTask; deleted?: boolean } }
  | { type: "kanban:comment_added"; payload: { comment: KanbanComment } };

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

export interface HealthResponse {
  telegram_connected: boolean;
  uptime_s: number;
}
