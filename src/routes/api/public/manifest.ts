import { createFileRoute } from "@tanstack/react-router";

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#0A0A0A"/><text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="Inter, system-ui, sans-serif" font-weight="900" font-size="280" fill="#FACC15">L</text></svg>`;

const manifest = {
  name: "LINEBREAK – NRL Betting Insights",
  short_name: "LINEBREAK",
  description: "Live NRL odds, official stats, and AI-generated betting insights for every match.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "portrait",
  background_color: "#0A0A0A",
  theme_color: "#0A0A0A",
  icons: [
    { src: "/api/public/app-icon?size=192", sizes: "192x192", type: "image/svg+xml", purpose: "any maskable" },
    { src: "/api/public/app-icon?size=512", sizes: "512x512", type: "image/svg+xml", purpose: "any maskable" },
  ],
};

export const Route = createFileRoute("/api/public/manifest")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify(manifest), {
          headers: {
            "content-type": "application/manifest+json",
            "cache-control": "public, max-age=3600",
          },
        }),
    },
  },
});

export { ICON_SVG };
