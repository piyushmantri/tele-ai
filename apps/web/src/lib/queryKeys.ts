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
  // NOTE: ["metrics", "app", slug] is a SUBSET of ["metrics"] so invalidating
  // qk.metrics also invalidates per-app caches (RQ prefix-match).
  appMetrics: (slug: string) => ["metrics", "app", slug] as const,
  applications: ["applications"] as const,
  // NOTE: ["applications", "registry"] is a SUBSET of ["applications"], so
  // invalidating qk.applications also invalidates this key (RQ matches by prefix).
  // Intentional: any change to the applications list should refresh "Installed" badges.
  applicationsRegistry: ["applications", "registry"] as const,
  applicationAssignments: (id: string) => ["applications", id, "assignments"] as const,
  applicationFiles: (id: string) => ["applications", id, "files"] as const,
  applicationChats: (id: string) => ["applications", id, "chats"] as const,
  applicationChatMessages: (id: string, tgChatId: string) => ["applications", id, "chats", tgChatId] as const,
  applicationMatches: (id: string) => ["applications", id, "matches"] as const,
  applicationBotConfig: (id: string) => ["applications", id, "bot-config"] as const,
  applicationGitStatus: (id: string) => ["applications", id, "git-status"] as const,
  chatApplications: (chatId: string) => ["chats", chatId, "applications"] as const,
};

