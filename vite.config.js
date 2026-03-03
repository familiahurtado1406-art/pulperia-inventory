import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/pulperia-inventory/", // 👈 ESTA LÍNEA ES LA CLAVE
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Pulpería Inventory",
        short_name: "Inventory",
        description: "Sistema inteligente de inventario",
        theme_color: "#1e3c72",
        background_color: "#1e3c72",
        display: "standalone",
        start_url: "/pulperia-inventory/", // 👈 también cambiar esto
        icons: [
          {
            src: "/pulperia-inventory/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pulperia-inventory/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
    }),
  ],
});
