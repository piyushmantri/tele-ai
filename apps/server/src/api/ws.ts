import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { eventBus } from "../util/eventBus.js";
import { logger } from "../util/logger.js";
import { incCounter, setGauge } from "../util/metrics.js";

const HEARTBEAT_MS = 30_000;

let subscriberCount = 0;

export function registerWs(app: FastifyInstance, authCookieName: string, expectedToken: string) {
  app.get("/ws", { websocket: true }, (socket, req: FastifyRequest) => {
    const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies ?? {};
    if (cookies[authCookieName] !== expectedToken) {
      socket.close(4401, "unauthorized");
      return;
    }

    const unsubscribe = eventBus.on((event) => {
      try {
        socket.send(JSON.stringify(event));
      } catch (err) {
        incCounter("ws.send_error");
        logger.warn("ws send failed", { err: err instanceof Error ? err.message : String(err) });
      }
    });

    subscriberCount++;
    setGauge("ws.subscribers", subscriberCount);

    const heartbeat = setInterval(() => {
      try {
        socket.ping();
      } catch {
        clearInterval(heartbeat);
      }
    }, HEARTBEAT_MS);

    socket.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      subscriberCount = Math.max(0, subscriberCount - 1);
      setGauge("ws.subscribers", subscriberCount);
    });
  });
}

export function broadcast(_event: unknown): void {
  // No-op convenience export. Components should use eventBus.emit directly.
}

export function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
  cookieName: string,
  expectedToken: string,
): boolean {
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies ?? {};
  if (cookies[cookieName] !== expectedToken) {
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }
  return true;
}
