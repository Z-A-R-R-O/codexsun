import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import dotenv from "dotenv";

// Load .env into process.env
dotenv.config();

export default defineConfig({
    plugins: [react()],

    root: __dirname,
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "src"),
        },
    },

    server: {
        port: 5173,
        proxy: {
            "/api": {
                target: "http://localhost:3006", // consistent with .env
                changeOrigin: true,
                secure: false,
                rewrite: (path) => path.replace(/^\/api/, ""),
            },
        },
    },

    build: {
        outDir: "dist",
        emptyOutDir: true,
    },
});
