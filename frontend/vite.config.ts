import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { readFileSync } from "fs";

const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
);

// CSP (Content-Security-Policy) — белый список источников для страницы.
// Инжектится ТОЛЬКО в prod-сборку (apply: "build"): dev-серверу Vite нужны
// инлайн-скрипты и ws:// для HMR, жёсткая политика его ломает.
// В Electron страница грузится с file:// — HTTP-заголовков нет, поэтому
// единственный способ доставить CSP — <meta> в index.html.
function cspPlugin(apiOrigin: string): Plugin {
  const policy = [
    "default-src 'self'", // дефолт: только свои файлы из dist
    "script-src 'self'", // скрипты только свои, инлайн запрещён
    "style-src 'self' 'unsafe-inline'", // Radix/shadcn инжектят инлайн-стили
    "img-src 'self' data:", // data: — иконки/растр в base64
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin}`, // запросы только к своему API
    "object-src 'none'", // <object>/<embed> не нужны
    "base-uri 'none'", // запрет подмены базового URL
    "form-action 'none'", // формы не отправляются напрямую
  ].join("; ");

  return {
    name: "inject-csp",
    apply: "build",
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: {
            "http-equiv": "Content-Security-Policy",
            content: policy,
          },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

export default defineConfig(({ mode }) => {
  // Адрес API из .env.{mode} — тот же VITE_API_URL, что вшивается в api-client;
  // для connect-src нужен только origin (протокол + хост + порт, без /api)
  const env = loadEnv(mode, __dirname);
  const apiUrl = env.VITE_API_URL || "http://localhost:8000/api";
  const apiOrigin = new URL(apiUrl).origin;

  return {
    plugins: [react(), cspPlugin(apiOrigin)],
    base: "./",
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      outDir: "dist",
    },
  };
});
