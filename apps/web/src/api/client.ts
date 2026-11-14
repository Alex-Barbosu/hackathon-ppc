import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./schema";
import { getToken, useSession } from "../state/session";

// Default is the real gateway (same origin). Set VITE_API_BASE=/mock to work against the Prism mock.
// `??` not `||`: an empty string is a legitimate value meaning "same origin, no prefix".
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "";

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const auth: Middleware = {
  onRequest({ request }) {
    for (const [k, v] of Object.entries(authHeaders())) request.headers.set(k, v);
    return request;
  },
  onResponse({ request, response }) {
    // A wrong password is also a 401; only an expired or revoked token should end the session.
    if (response.status === 401 && request.headers.has("Authorization")) useSession.getState().signOut();
    return response;
  },
};

export const api = createClient<paths>({ baseUrl: API_BASE });
api.use(auth);
