import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, proxy the GraphQL endpoint to the BFF so the SPA can use a same-origin
// "/graphql" URL (matching production, where Caddy routes /graphql to the BFF).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/graphql": {
        target: process.env.BFF_URL ?? "http://localhost:8080",
        changeOrigin: true,
      },
      "/api": {
        target: process.env.BFF_URL ?? "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
});
