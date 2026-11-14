import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In dev, every API call goes through the local gateway (make up), so the browser sees
// the same origins, TLS and routes as production. Use VITE_API_TARGET to point elsewhere.
// Another project may already own 5173 (common on WSL2 + Windows), so the port is overridable.
const port = Number(process.env.VITE_PORT ?? 5173);
const target = process.env.VITE_API_TARGET ?? "https://localhost";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port,
    strictPort: true, // fail loudly instead of silently moving to a port the README does not mention
    proxy: {
      "/api": { target, changeOrigin: true, secure: false },
      "/grafana": { target, changeOrigin: true, secure: false },
      // Trailing slash: "/insights" and "/chaos" are also pages of this app, only "/insights/..." is the API.
      "^/chaos/": { target, changeOrigin: true, secure: false },
      "^/insights/": { target, changeOrigin: true, secure: false },
      "/mock": { target, changeOrigin: true, secure: false },
    },
  },
});
