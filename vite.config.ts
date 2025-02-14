import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: [
      "359e-2405-201-300f-307c-4313-4335-7dda-8081.ngrok-free.app",
      "a180-2405-201-300f-307c-4313-4335-7dda-8081.ngrok-free.app",
      "localhost",
    ],
  },
});
