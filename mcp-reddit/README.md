# Reddit MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives
Claude read-only access to the Reddit API: search posts, browse subreddits,
read comment threads, and look up users.

## Tools

| Tool | What it does |
| --- | --- |
| `search_reddit` | Search posts across Reddit or within one subreddit |
| `get_subreddit_posts` | List a subreddit's posts (`hot`/`new`/`top`/`rising`/`controversial`) |
| `get_post_comments` | Fetch a post and its nested comment tree |
| `search_subreddits` | Find subreddits by name/topic |
| `get_subreddit_info` | Metadata for a subreddit (subscribers, description, …) |
| `get_user_posts` | A user's recent submissions or comments |

## 1. Get Reddit API credentials

1. Sign in to Reddit and go to <https://www.reddit.com/prefs/apps>.
2. Click **"create another app…"** at the bottom.
3. Pick a type:
   - **script** — simplest; supports the optional username/password mode.
   - **web app** — fine for read-only (application-only) access.
4. Set the redirect URI to `http://localhost:8080` (unused for our flow, but required).
5. After creating it:
   - **client id** = the string just under the app name.
   - **secret** = the value labelled `secret`.

## 2. Build

```bash
cd mcp-reddit
npm install      # or: bun install
npm run build    # compiles TypeScript to dist/
```

## 3. Configure credentials

Copy `.env.example` to `.env` and fill it in, or pass the variables through your
MCP client config (below). Required:

- `REDDIT_CLIENT_ID`
- `REDDIT_CLIENT_SECRET`
- `REDDIT_USER_AGENT` — a unique, descriptive string (Reddit requires this)

Optional (enables account-context reads, **script** apps only):

- `REDDIT_USERNAME`
- `REDDIT_PASSWORD`

Without username/password the server uses **application-only OAuth** — read-only
access to public Reddit data, which is all these tools need.

## 4. Connect it in Claude

Use the **absolute path** to the built `dist/index.js`.

### Claude Desktop

Edit `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```jsonc
{
  "mcpServers": {
    "reddit": {
      "command": "node",
      "args": ["/absolute/path/to/geo-aeo-compass/mcp-reddit/dist/index.js"],
      "env": {
        "REDDIT_CLIENT_ID": "your_client_id",
        "REDDIT_CLIENT_SECRET": "your_client_secret",
        "REDDIT_USER_AGENT": "reddit-mcp/1.0 (by /u/your_username)"
      }
    }
  }
}
```

Restart Claude Desktop. The Reddit tools appear in the tools (🔌) menu.

### Claude Code (CLI)

From this repo:

```bash
claude mcp add reddit \
  --env REDDIT_CLIENT_ID=your_client_id \
  --env REDDIT_CLIENT_SECRET=your_client_secret \
  --env "REDDIT_USER_AGENT=reddit-mcp/1.0 (by /u/your_username)" \
  -- node "$(pwd)/mcp-reddit/dist/index.js"
```

Or commit a project-scoped `.mcp.json` (see `.mcp.json.example` in this folder)
and let Claude Code pick it up — keep real secrets out of version control.

## Notes

- Reddit limits OAuth clients to ~60 requests/minute; the server surfaces 429s
  as a clear error.
- All output is JSON, flattened from Reddit's verbose Thing/Listing envelopes to
  the fields that matter.
- During development you can run without building: `npm run dev` (uses `tsx`).
