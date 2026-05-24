# open-reason

OpenCode plugin that optimizes DeepSeek API calls by maintaining a stable system-prompt prefix for maximum prefix-cache hit rates.

## Features

- **Immutable prefix** – freezes the system prompt + tool specs so every request starts with identical tokens
- **Dynamic tool sync** – detects when OpenCode adds/removes tools mid-session and updates the prefix accordingly
- **Real cache stats** – reads `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` from DeepSeek's streaming response and logs the actual ratio
- **Cost logging** – computes per-request cost from token usage
- **Transparent** – logs every fetch with fingerprint, cache stability flag, message counts, and tool count

## How it works

DeepSeek's prefix caching reuses computation for identical initial tokens across requests. `open-reason` ensures the system prompt (which appears at the start of every request) never changes:

1. On first request, it captures the system prompt and tool specs into an `ImmutablePrefix`
2. On subsequent requests, `addTool` / `removeTool` keep the prefix in sync with OpenCode's tool list
3. If the system prompt itself changes (e.g., after a session reset), `replaceSystem` updates the prefix
4. Every fetch is logged with the current fingerprint and whether it differs from the previous one (`cacheStable`)
5. The response stream is read to extract DeepSeek's actual cache hit/miss token counts and compute the real ratio

## Installation

### Prerequisites

- [OpenCode](https://opencode.ai) with a DeepSeek provider configured
- Node.js 18+

### Quick start

```bash
# Clone the repo wherever you like
git clone https://github.com/YOUR_USER/open-reason.git
cd open-reason

# Install dependencies
npm install

# Build the plugin bundle
npm run bundle

# Link it into your project
mkdir -p .opencode/plugins
cp dist/bundle.js .opencode/plugins/open-reason.js
```

Or from an existing OpenCode project directory:

```bash
npm install open-reason
# then symlink or copy .opencode/plugins/open-reason.js
```

### Verify

Start a conversation in OpenCode and check the logs:

```bash
tail -f ~/.local/share/opencode/log/*.log | grep --line-buffered "open-reason"
```

You should see entries like:

```
INFO  service=open-reason fingerprint=abc123 cacheStable=true tools=11 messages=32 sysFs=1 conv=31 fetch: https://api.deepseek.com/chat/completions
INFO  service=open-reason cache: 213376 hit / 858 miss (99.6%) cost_usd=0.0003 model=deepseek-v4-flash
```

## Log reference

| Field | Description |
|---|---|
| `fingerprint` | SHA256(System + Tools + FewShots), 16 hex chars |
| `cacheStable` | Whether fingerprint matches the previous request |
| `tools` | Number of tool specs in the current request |
| `messages` | Total messages sent (sysFs + conv) |
| `sysFs` | Number of prefix messages (system + few-shots) |
| `conv` | Number of conversation messages (non-system) |
| `hit` | `prompt_cache_hit_tokens` from DeepSeek |
| `miss` | `prompt_cache_miss_tokens` from DeepSeek |
| `ratio` | hit / (hit + miss) as percentage |
| `cost_usd` | Estimated cost in USD (using reasonix pricing) |

## Build

```bash
npm run build    # tsc → dist/*.js
npm run bundle   # esbuild → dist/bundle.js
```

The bundle is a single ESM file with all dependencies inlined.

## License

MIT
