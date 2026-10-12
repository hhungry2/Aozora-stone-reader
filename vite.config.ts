import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { webNovelProxyPlugin } from "./server/web-novel-proxy";

export default defineConfig({
  plugins: [react(), webNovelProxyPlugin()],
  base: process.env.VITE_BASE_PATH || "./",
  server: { watch: { ignored: ["**/.cache/**", "**/public/data/**"] } },
});
