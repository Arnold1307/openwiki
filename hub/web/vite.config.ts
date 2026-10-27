import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Built assets are served by hub/server; no external CDN is referenced.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
});
