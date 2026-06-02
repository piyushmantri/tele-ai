import type { Content, GenerativeModel, Part, Tool } from "@google/generative-ai";
import type { Chat } from "@tele/shared";
import { runShell } from "./shell.js";
import { readFileTool, writeFileTool, listDirTool, makeSendFileTool } from "./files.js";
import { makeGenerateImageTool } from "./images.js";
import { makeReminderTools } from "./reminders.js";
import { makePollTools } from "./polls.js";
import { makeChatControlTools } from "./chat.js";
import { makeKanbanTools } from "./kanban.js";
import { makeSkillsTools } from "./skills.js";
import { makeBotMessageTools } from "./botMessages.js";
import { makeAskUserChoiceTool } from "./askUserChoice.js";
import { getMCPToolsAsync } from "../../mcp/manager.js";
import { makeStoreKundaliMatchTool } from "./kundali.js";
import { logToolCall } from "../../db/repos/audit.js";
import { eventBus } from "../../util/eventBus.js";
import { logger } from "../../util/logger.js";
import { incCounter, recordHistogram } from "../../util/metrics.js";
import { getCurrentPricing } from "../pricing.js";

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

export async function buildTools(
  currentChatId: string,
  tgChatId: string,
  opts?: { isBot?: boolean; botToken?: string; chatType?: Chat["chat_type"] },
): Promise<{
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
    makeAskUserChoiceTool(currentChatId, tgChatId, opts?.chatType ?? "private"),
    ...makeReminderTools(currentChatId),
    ...makeKanbanTools(),
    ...makeSkillsTools(),
    makeStoreKundaliMatchTool(currentChatId),
    ...mcpTools,
  ];
  if (opts?.isBot) {
    defs.push(...makeBotMessageTools(tgChatId));
  }
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

const MAX_LOOP_ITERATIONS = 15;
const GEMINI_MAX_RETRIES = 3;
const GEMINI_BASE_DELAY_MS = 800;

async function generateWithRetry(model: GenerativeModel, contents: Content[]): Promise<Awaited<ReturnType<GenerativeModel["generateContent"]>>> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < GEMINI_MAX_RETRIES; attempt++) {
    const start = Date.now();
    try {
      const result = await model.generateContent({ contents });
      recordHistogram("gemini.latency_ms", Date.now() - start);
      incCounter("gemini.call.ok");
      // SDK v0.21 may not surface usageMetadata in TS types; cast for forward-compat.
      const usage = (result.response as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }).usageMetadata;
      if (typeof usage?.promptTokenCount === "number") {
        incCounter("gemini.tokens.prompt", usage.promptTokenCount);
      }
      if (typeof usage?.candidatesTokenCount === "number") {
        incCounter("gemini.tokens.completion", usage.candidatesTokenCount);
      }
      // Cost counter in micro-USD. Lazy resolve via getCurrentPricing() — pricing
      // can be refreshed mid-process (24h scheduler), so capturing at module load
      // would go stale (lessons-2026-05-07).
      const pricing = getCurrentPricing();
      if (
        pricing &&
        typeof usage?.promptTokenCount === "number" &&
        typeof usage?.candidatesTokenCount === "number"
      ) {
        // rate is per-1M tokens in USD; counter is in micro-USD.
        // micro_usd = (tokens * rate_per_1m / 1_000_000) * 1_000_000 = tokens * rate_per_1m
        const micros = Math.round(
          usage.promptTokenCount * pricing.input_per_1m_usd +
            usage.candidatesTokenCount * pricing.output_per_1m_usd,
        );
        if (micros > 0) incCounter("gemini.cost_micro_usd", micros);
      }
      return result;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("fetch failed") || attempt === GEMINI_MAX_RETRIES - 1) {
        incCounter("gemini.call.error");
        throw err;
      }
      incCounter("gemini.call.retry");
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
      const toolStart = Date.now();
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
      recordHistogram("tool.duration_ms." + fc.functionCall.name, Date.now() - toolStart);
      const entry = await logToolCall({
        chat_id: opts.chatId,
        tool_name: fc.functionCall.name,
        args: fc.functionCall.args,
        result: toolResult,
        ok,
      });
      eventBus.emit({ type: "tool:invoked", payload: { entry } });
      logger.info("tool invoked", { tool: fc.functionCall.name, ok });
      incCounter("tool.invoked." + fc.functionCall.name + (ok ? ".ok" : ".err"));
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
