import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Top Tier Basketball Shooting Ladder",
    short_name: "TTB Shooting",
    description:
      "Phone-first Top Tier Basketball shooting workout tracker for team stats, season totals, and career leaderboards.",
    start_url: "/",
    display: "standalone",
    background_color: "#020617",
    theme_color: "#0f172a",
    orientation: "portrait",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}