import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In dev, every API call goes through the local gateway (make up), so the browser sees
// the same origins, TLS and routes as production. Use VITE_API_TARGET to point elsewhere.
const target = process.env.VITE_API_TARGET ?? "https://localhost";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target, changeOrigin: true, secure: false },
      "/chaos": { target, changeOrigin: true, secure: false },
      "/insights": { target, changeOrigin: true, secure: false },
      "/mock": { target, changeOrigin: true, secure: false },
    },
  },
});
