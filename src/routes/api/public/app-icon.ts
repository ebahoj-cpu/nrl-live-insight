import { createFileRoute } from "@tanstack/react-router";

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#0A0A0A"/><text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="Inter, system-ui, sans-serif" font-weight="900" font-size="280" fill="#FACC15">L</text></svg>`;

export const Route = createFileRoute("/api/public/app-icon")({
  server: {
    handlers: {
      GET: () =>
        new Response(ICON_SVG, {
          headers: {
            "content-type": "image/svg+xml",
            "cache-control": "public, max-age=86400",
          },
        }),
    },
  },
});
