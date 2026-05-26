## Backend Architecture

This project tracks brand visibility across LLM answer engines (AEO — 
Answer Engine Optimization).

**v1 scope:** ChatGPT only. Other LLMs come in subsequent releases.

### Folder Structure

- `src/lib/llm/` — LLM client wrappers
- `src/lib/audit/` — Audit orchestrator, query generation, citation parsing
- `src/lib/db/` — Supabase client and TypeScript types
- `src/lib/server/` — TanStack Start server functions

### Environment Variables

See `.env.example` for the manifest. Real keys live in Cloudflare 
dashboard:

  Workers & Pages → geo-aeo-compass → Settings → Variables and Secrets

To rotate keys, use Cloudflare dashboard or:
  wrangler secret put OPENAI_API_KEY

### Database

Postgres hosted on Supabase (free tier, Singapore region). Schema 
migrations live in `supabase/migrations/`. Run migrations manually 
via the Supabase SQL Editor for v1.

### Deployment

Auto-deploys from `main` branch to Cloudflare Workers on every push.
