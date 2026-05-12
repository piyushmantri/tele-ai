import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { MCPServer } from "@tele/shared";
import { listMCPServers } from "../db/repos/mcp.js";
import { logger } from "../util/logger.js";
import { incCounter } from "../util/metrics.js";
import type { ToolDef } from "../ai/tools/index.js";

interface ActiveClient {
  client: Client;
  server: MCPServer;
}

const active = new Map<string, ActiveClient>();

async function connectOne(server: MCPServer): Promise<void> {
  await disconnectOne(server.id);
  if (!server.enabled) return;

  const client = new Client({ name: "tele-agent", version: "1.0.0" });
  try {
    if (server.type === "stdio") {
      if (!server.command) throw new Error("stdio server missing command");
      const [cmd, ...args] = server.command.trim().split(/\s+/);
      const transport = new StdioClientTransport({
        command: cmd!,
        args,
        env: { ...process.env, ...server.env } as Record<string, string>,
      });
      await client.connect(transport);
    } else {
      if (!server.url) throw new Error("sse server missing url");
      const transport = new SSEClientTransport(new URL(server.url));
      await client.connect(transport);
    }
    active.set(server.id, { client, server });
    logger.info("mcp connected", { name: server.name, type: server.type });
  } catch (err) {
    logger.error("mcp connect failed", { name: server.name, err: err instanceof Error ? err.message : String(err) });
  }
}

async function disconnectOne(id: string): Promise<void> {
  const entry = active.get(id);
  if (!entry) return;
  try { await entry.client.close(); } catch {}
  active.delete(id);
}

export async function initMCP(): Promise<void> {
  const servers = await listMCPServers();
  await Promise.all(servers.map(connectOne));
  logger.info("mcp manager ready", { connected: active.size });
}

export async function reloadMCP(server: MCPServer): Promise<void> {
  await connectOne(server);
}

export async function removeMCPClient(id: string): Promise<void> {
  await disconnectOne(id);
}

export async function getMCPToolsAsync(): Promise<ToolDef[]> {
  const tools: ToolDef[] = [];
  for (const { client, server } of active.values()) {
    try {
      const { tools: mcpTools } = await client.listTools();
      for (const t of mcpTools) {
        const prefixed = `mcp__${server.name}__${t.name}`;
        tools.push({
          declaration: {
            name: prefixed,
            description: `[MCP:${server.name}] ${t.description ?? t.name}`,
            parameters: {
              type: "object",
              properties: (t.inputSchema.properties ?? {}) as Record<string, unknown>,
              required: t.inputSchema.required,
            },
          },
          handler: async (args) => {
            try {
              const result = await client.callTool({ name: t.name, arguments: args as Record<string, unknown> });
              return { ok: true, content: result.content };
            } catch (err) {
              return { ok: false, error: err instanceof Error ? err.message : String(err) };
            }
          },
        });
      }
    } catch (err) {
      incCounter("mcp.list_tools_failed." + server.name);
      logger.warn("mcp listTools failed", { server: server.name, err: err instanceof Error ? err.message : String(err) });
    }
  }
  return tools;
}

export function getActiveServers(): Array<{ id: string; name: string; connected: boolean }> {
  return [...active.values()].map(({ server }) => ({ id: server.id, name: server.name, connected: true }));
}
