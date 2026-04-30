import { createFileRoute } from "@tanstack/react-router";

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
    {
      src: "/icon-192.svg",
      sizes: "192x192",
      type: "image/svg+xml",
      purpose: "any maskable",
    },
    {
      src: "/icon-512.svg",
      sizes: "512x512",
      type: "image/svg+xml",
      purpose: "any maskable",
    },
  ],
};

export const Route = createFileRoute("/manifest.webmanifest")({
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
