import type { FastifyInstance } from "fastify";
import type { Pager } from "./pager.js";
import { routesFor } from "./pager.js";
import { authed } from "./routes.js";

/** GET /insights/pages and POST /insights/pages/{id}/ack (contracts/openapi.yaml). Role-filtered on the server. */
export function registerPager(app: FastifyInstance, pager: Pager, secret: string): void {
  app.get("/insights/pages", async (req, reply) => {
    const c = authed(req, reply, secret);
    if (!c) return reply;
    if (!routesFor(c.role).length) return reply.code(403).send({ code: "FORBIDDEN", message: "pages are for admin and dispatch" });
    return pager.list(c.role);
  });

  app.get("/insights/pages/setup", async (req, reply) => {
    const c = authed(req, reply, secret);
    if (!c) return reply;
    if (c.role !== "admin") return reply.code(403).send({ code: "FORBIDDEN", message: "pager setup is for admin" });
    return pager.setup();
  });

  app.post<{ Params: { pageId: string } }>("/insights/pages/:pageId/ack", async (req, reply) => {
    const c = authed(req, reply, secret);
    if (!c) return reply;
    if (!routesFor(c.role).length) return reply.code(403).send({ code: "FORBIDDEN", message: "pages are for admin and dispatch" });
    const id = /^\d{1,12}$/.test(req.params.pageId) ? Number(req.params.pageId) : NaN;
    // A page of the other route answers 404, not 403: dispatch does not need to know platform pages exist.
    const page = Number.isFinite(id) ? await pager.ackFromWeb(id, c.role, c.sub) : null;
    return page ?? reply.code(404).send({ code: "NOT_FOUND", message: "no such page" });
  });
}
