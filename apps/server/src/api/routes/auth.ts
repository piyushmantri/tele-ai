import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../../config.js";

export const AUTH_COOKIE = "tele_auth";
let token: string | null = null;

function makeToken(): string {
  const seed = randomBytes(16).toString("hex") + Date.now().toString();
  return createHash("sha256").update(seed + config.DASHBOARD_PASSWORD).digest("hex");
}

export function getAuthToken(): string {
  if (!token) token = makeToken();
  return token;
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/login", async (req, reply) => {
    const body = z.object({ password: z.string() }).parse(req.body);
    const a = Buffer.from(body.password);
    const b = Buffer.from(config.DASHBOARD_PASSWORD);
    const ok = a.length === b.length && timingSafeEqual(a, b);
    if (!ok) {
      reply.code(401);
      return { error: "invalid password" };
    }
    const t = getAuthToken();
    reply.setCookie(AUTH_COOKIE, t, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return { ok: true };
  });

  app.post("/api/logout", async (_req, reply) => {
    reply.clearCookie(AUTH_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", async (req) => {
    const cookies = (req as typeof req & { cookies?: Record<string, string> }).cookies ?? {};
    return { authenticated: cookies[AUTH_COOKIE] === getAuthToken() };
  });
}
