# Compass Capture — Browser Extension (build plan)

## Goal
Capture LLM answers from the **client's own browser**, in a **logged-out**
session, and post them back into Compass — a real-UI, real-sources capture that
avoids server-side bot-blocking, while staying a **neutral (cold) view**.

Complements the API audit; it does not replace it. Shown side-by-side: API
audit (server, cold) vs browser capture (client's machine, cold). They should
agree — divergence is a QA signal.

## Non-negotiable: logged-OUT only
Logged-in ChatGPT/Gemini personalize via **memory + history**, so a logged-in
capture is biased ("false" for audit purposes — the model already knows the
brand). The extension therefore:

1. **Detects auth state BEFORE any capture** and refuses to scrape a logged-in
   session — shows "You're signed in to ChatGPT. Sign out (or use a guest/
   incognito window) so we capture what a *new buyer* sees, not your
   personalized view." with a short explainer on memory bias.
2. Re-checks state right before each query (session can change mid-run).

### Auth-state detection (per LLM, best-effort, resilient to DOM change)
- **ChatGPT** — logged-out shows the "Log in / Sign up" buttons and no account
  avatar; check for the login CTA / absence of the profile menu, and/or a
  `GET /api/auth/session` returning an empty/anonymous session. Treat "unsure"
  as logged-in (fail safe → refuse).
- **Perplexity** — usable logged-out; detect the "Sign in" control vs avatar.
- **Gemini** — effectively requires a Google login; likely **out of scope for
  logged-out capture**. Flag as "not available logged-out" rather than capture a
  personalized view.

## Architecture (Manifest V3)
- `manifest.json` — host permissions for `https://chatgpt.com/*`,
  `https://www.perplexity.ai/*` (Gemini deferred); `activeTab`, `scripting`,
  `storage`. Minimal permissions; explain each at install.
- **Popup** — connect to a Compass audit (paste an audit token / one-time code),
  show login-state per LLM, run/queue queries, progress, consent + education.
- **Content scripts** (per LLM) — the fragile layer:
  - submit the prompt into the composer,
  - wait for the streamed answer to finish (observe the stop/regenerate state),
  - expand + read the **Sources** panel,
  - extract `{ query, llm, answer_text, sources:[{title,url}], captured_at,
    logged_in:false }`.
- **Background service worker** — orchestrates the queue (one tab/query at a
  time, throttled), holds the Compass token, POSTs results.

## Compass side
- New endpoint `POST /api/audit/browser-capture` (token-authed): accepts the
  per-query capture, stores it as a distinct source set tagged
  `origin: 'browser'` alongside the API polls.
- One-time capture token minted per audit (short TTL) so the extension can write
  only to that audit.
- UI: a "Browser capture" toggle on each query card showing the client-side
  answer next to the API answer, with an `origin` + `logged_in=false` badge.

## Consent & education (first-run + per-run)
- Explicit consent screen: what it does, which sites, that it runs in *their*
  browser, that data goes to Compass.
- Memory-bias explainer (why logged-out): one short paragraph + the login-state
  gate above.
- ToS note: automating LLM UIs is a gray area even in your own browser; the
  client runs it on their own machine and account, at their discretion.

## Scope
- **v1:** ChatGPT only, logged-out, manual "run" from the popup, login-state
  gate, POST back. Prove the loop end-to-end.
- **v2:** Perplexity; batch/queue polish; retry on DOM timeouts.
- **Gemini:** only if a logged-out capture is viable; otherwise mark
  unsupported.

## Risks
- **DOM churn** — the LLM UIs change often; content scripts need monitoring and
  quick patches. Keep selectors centralized + defensive.
- **Bot defenses** — real-browser use is far safer than server scraping, but
  rapid automated submits can still trip rate limits; throttle.
- **ToS** — disclaim; user-initiated, own account.
- **Distribution** — unlisted Chrome Web Store item or enterprise/dev-mode load
  for controlled clients; store review adds latency.

## Effort (rough)
- v1 ChatGPT loop (manifest, popup, content script, background, Compass
  endpoint + token + UI): a focused build, not a weekend hack — the DOM capture
  + auth gate + secure write-back are the real work.
