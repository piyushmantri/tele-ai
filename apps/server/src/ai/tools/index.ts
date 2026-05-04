import type { Content, GenerativeModel, Part, Tool } from "@google/generative-ai";
import { runShell } from "./shell.js";
import { readFileTool, writeFileTool, listDirTool, makeSendFileTool } from "./files.js";
import { makeGenerateImageTool } from "./images.js";
import { makeReminderTools } from "./reminders.js";
import { makePollTools } from "./polls.js";
import { makeChatControlTools } from "./chat.js";
import { makeKanbanTools } from "./kanban.js";
import { makeSkillsTools } from "./skills.js";
import { getMCPToolsAsync } from "../../mcp/manager.js";
import { logToolCall } from "../../db/repos/audit.js";
import { eventBus } from "../../util/eventBus.js";
import { logger } from "../../util/logger.js";

export interface ToolDef {
  declaration: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
  handler: (args: unknown) => Promise<unknown>;
}

export async function buildTools(currentChatId: string, tgChatId: string): Promise<{
  tools: Tool[];
  registry: Map<string, ToolDef>;
  summary: string;
}> {
  const mcpTools = await getMCPToolsAsync();
  const defs: ToolDef[] = [
    runShell,
    readFileTool,
    writeFileTool,
    listDirTool,
    makeSendFileTool(currentChatId, tgChatId),
    makeGenerateImageTool(currentChatId),
    ...makePollTools(currentChatId, tgChatId),
    ...makeChatControlTools(currentChatId),
    ...makeReminderTools(currentChatId),
    ...makeKanbanTools(),
    ...makeSkillsTools(),
    ...mcpTools,
  ];
  const registry = new Map<string, ToolDef>();
  for (const d of defs) registry.set(d.declaration.name, d);

  const tools: Tool[] = [
    {
      functionDeclarations: defs.map((d) => ({
        name: d.declaration.name,
        description: d.declaration.description,
        parameters: d.declaration.parameters as never,
      })),
    },
  ];

  const summary = defs
    .map((d) => `- ${d.declaration.name}: ${d.declaration.description}`)
    .join("\n");

  return { tools, registry, summary };
}

const MAX_LOOP_ITERATIONS = 6;
const GEMINI_MAX_RETRIES = 3;
const GEMINI_BASE_DELAY_MS = 800;

async function generateWithRetry(model: GenerativeModel, contents: Content[]): Promise<Awaited<ReturnType<GenerativeModel["generateContent"]>>> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < GEMINI_MAX_RETRIES; attempt++) {
    try {
      return await model.generateContent({ contents });
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("fetch failed") || attempt === GEMINI_MAX_RETRIES - 1) throw err;
      const delay = GEMINI_BASE_DELAY_MS * 2 ** attempt;
      logger.warn("gemini transient error, retrying", { attempt: attempt + 1, delay_ms: delay });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export async function runToolLoop(opts: {
  model: GenerativeModel;
  contents: Content[];
  registry: Map<string, ToolDef>;
  chatId: string;
}): Promise<string> {
  let { contents } = opts;
  for (let iter = 0; iter < MAX_LOOP_ITERATIONS; iter++) {
    const result = await generateWithRetry(opts.model, contents);
    const candidate = result.response.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const functionCalls = parts.filter(
      (p): p is Part & { functionCall: { name: string; args: Record<string, unknown> } } =>
        "functionCall" in p && p.functionCall != null,
    );

    if (functionCalls.length === 0) {
      const text = parts
        .map((p) => (typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : ""))
        .join("")
        .trim();
      return text;
    }

    contents = [
      ...contents,
      { role: "model", parts: parts as never },
    ];

    const responseParts: Array<{ functionResponse: { name: string; response: unknown } }> = [];
    for (const fc of functionCalls) {
      const def = opts.registry.get(fc.functionCall.name);
      let toolResult: unknown;
      let ok = true;
      try {
        if (!def) {
          toolResult = { ok: false, error: `unknown tool: ${fc.functionCall.name}` };
          ok = false;
        } else {
          toolResult = await def.handler(fc.functionCall.args);
          if (typeof toolResult === "object" && toolResult !== null && "ok" in toolResult) {
            ok = Boolean((toolResult as { ok?: unknown }).ok);
          }
        }
      } catch (err) {
        ok = false;
        toolResult = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      const entry = await logToolCall({
        chat_id: opts.chatId,
        tool_name: fc.functionCall.name,
        args: fc.functionCall.args,
        result: toolResult,
        ok,
      });
      eventBus.emit({ type: "tool:invoked", payload: { entry } });
      logger.info("tool invoked", { tool: fc.functionCall.name, ok });
      responseParts.push({
        functionResponse: { name: fc.functionCall.name, response: toolResult as never },
      });
    }

    contents = [
      ...contents,
      { role: "user", parts: responseParts as never },
    ];
  }
  return "";
}
