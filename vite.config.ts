import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/client",
  plugins: [react()],
  build: {
    outDir: "../../dist/public",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/socket.io": { target: "http://localhost:3001", ws: true },
    },
  },
});
