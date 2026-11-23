import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Interface du module Notes (compilée puis intégrée dans le binaire powernux-notes).
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
});
