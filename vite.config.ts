import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwind from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
    plugins: [
        vue(),
        tailwind(),
        VitePWA({
            registerType: "prompt",
            injectRegister: false,
            manifest: {
                name: "Sinlink Auto Accessories",
                short_name: "Sinlink",
                description: "Cash sales invoicing, online and offline",
                theme_color: "#0f4c45",
                background_color: "#f4f6f5",
                display: "standalone",
                start_url: "/",
                icons: [
                    {
                        src: "/icon-192.png",
                        sizes: "192x192",
                        type: "image/png",
                    },
                    {
                        src: "/icon-512.png",
                        sizes: "512x512",
                        type: "image/png",
                        purpose: "any maskable",
                    },
                ],
            },
            workbox: {
                clientsClaim: true,
                globPatterns: ["**/*.{js,css,html,png,svg,woff2,ttf}"],
                maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
                navigateFallback: "/index.html",
                navigateFallbackDenylist: [
                    /^\/api\//,
                    /^\/sanctum\//,
                    /^\/up$/,
                ],
                cleanupOutdatedCaches: true,
            },
        }),
    ],
    publicDir: "resources/static",
    build: { outDir: "public/app", emptyOutDir: true },
    server: {
        proxy: {
            "/api": "http://127.0.0.1:8000",
            "/sanctum": "http://127.0.0.1:8000",
        },
    },
});
