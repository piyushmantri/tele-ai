export const qk = {
  me: ["me"] as const,
  health: ["health"] as const,
  chats: ["chats"] as const,
  chatMessages: (id: string) => ["chats", id, "messages"] as const,
  settings: ["settings"] as const,
  rules: ["rules"] as const,
  reminders: ["reminders"] as const,
  mcp: ["mcp"] as const,
  kanban: ["kanban"] as const,
  kanbanTask: (id: string) => ["kanban", id] as const,
  skills: ["skills"] as const,
  slashCommands: ["slashCommands"] as const,
  telegramBot: ["telegramBot"] as const,
  metrics: ["metrics"] as const,
};

