import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
export default defineConfig({
  root: "renderer",
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve("renderer") } },
  build: { outDir: "../dist/renderer", emptyOutDir: true },
});
