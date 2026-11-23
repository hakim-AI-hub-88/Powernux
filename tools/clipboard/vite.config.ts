import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Interface du module Clipboard (compilée puis intégrée dans le binaire powernux-clipboard).
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
});
