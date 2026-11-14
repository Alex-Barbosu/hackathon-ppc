import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./schema";
import { useSession } from "../state/session";

// "/mock" targets the Prism mock; set VITE_API_BASE="" to talk to the real gateway.
// `??` not `||`: an empty string is a legitimate value meaning "same origin, no prefix".
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "/mock";

const auth: Middleware = {
  onRequest({ request }) {
    request.headers.set("Authorization", `Bearer ${useSession.getState().token}`);
    return request;
  },
};

export const api = createClient<paths>({ baseUrl: API_BASE });
api.use(auth);
