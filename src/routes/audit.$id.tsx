import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy detail URL - the terminal workspace now lives at /summary?audit=<id>.
export const Route = createFileRoute("/audit/$id")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/summary", search: { audit: params.id } });
  },
});
