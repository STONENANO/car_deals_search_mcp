# Security

This server drives a real browser against third-party websites and feeds the
result into an AI assistant's context. That puts two untrusted inputs in the
path, and the code is organized around keeping both of them contained.

## Threat model

| Untrusted input | Who controls it | What it could do unchecked |
| --- | --- | --- |
| Tool arguments (`make`, `model`, `zip`, …) | The model, which may itself be steered by content it has read | Steer navigation to an unintended URL, crash the server, exhaust host resources |
| Listing content (titles, dealer names, links) | Dealers and sellers who write the listings, and anyone who can influence the pages we load | Inject instructions into the assistant's context, plant phishing links, forge output structure |
| The loaded page itself | The site, plus any third party it embeds | Exploit the browser renderer, write files, open dialogs and popups |

## Controls

### Arguments are validated before use — `src/validate.js`

Every argument is checked for type, range, length, and character set, and the
validated object contains only known keys. `make` and `model` become URL path
segments, so they are restricted to letters, digits, spaces, and `. + -`, which
keeps `/`, `?`, `#`, `\`, `@`, `%`, and `..` out of the path entirely. `zip`
must be exactly five digits; numerics must be real integers in range; booleans
must be booleans. `sources` is checked against an allowlist, and `maxResults` is
capped.

Unknown keys are dropped rather than passed along, so a caller cannot smuggle
values toward Puppeteer's launch options.

### URLs are constructed, not concatenated — `src/scraper.js`, `src/listing.js`

Query strings are built with `URLSearchParams` and paths with `buildPath`,
which encodes each segment and rejects `.` and `..` outright — `encodeURIComponent`
leaves dot segments untouched, so encoding alone would not stop traversal.

### Scraped links are validated against the source's own origin — `src/sanitize.js`

Previously an href was concatenated onto a base string, so a page could hand
back any link it liked. `sanitizeUrl` now resolves each href with the `URL`
parser and keeps it only if it is `https:`, carries no embedded credentials, and
sits on the source site or a subdomain of it. `javascript:`, `data:`, `file:`,
plain `http:`, off-site hosts, and look-alikes like `www.cars.com.evil.com` are
dropped.

### Scraped text cannot forge instructions or structure — `src/sanitize.js`

Listing text is the main prompt-injection vector. Each field is stripped of
control, zero-width, and bidi-override characters, flattened to a single line
(which removes line-anchored markdown and "new instruction begins here"
framing), markdown-escaped so it cannot forge headings, links, code fences,
tables, or HTML, and length-capped per field. The listing block is then wrapped
in an `<untrusted-listing-data>` envelope telling the reading model to treat the
contents as data.

This reduces risk; it does not eliminate it. A determined injection can still
express itself in plain prose. Treat anything a listing "says" as a claim by its
seller.

### The browser stays sandboxed — `src/browser.js`

The previous launch passed `--no-sandbox`, `--disable-setuid-sandbox`, and
`--disable-web-security`. Together those meant a renderer compromise from a
hostile page ran as the user with no same-origin policy. All three are gone.

The Chromium sandbox is now on by default. Container images that genuinely
cannot run it can set `CAR_DEALS_ALLOW_NO_SANDBOX=1`, which restores the old
flags and prints a warning; only do that inside an isolated container.

Each page additionally denies downloads, dismisses dialogs, blocks new web
contents, clears site permissions, and aborts any non-`http(s)` scheme. It also
aborts `image`, `media`, and `font` requests — none of which are needed to read
text, and all of which are parser surface. If a site turns out to gate its
rendering on them, `CAR_DEALS_LOAD_ALL_RESOURCES=1` restores them.

### Resources are bounded — `src/browser.js`, `src/server.js`

Concurrent Chromium instances are capped by a semaphore
(`CAR_DEALS_MAX_CONCURRENT_BROWSERS`, default 2), extraction runs under an
explicit timeout because `page.evaluate` has none of its own, a whole search is
capped at 180 s, cards read per page are capped at 60, and the response is
capped at 60 000 characters. Browsers are closed in a `finally` block, and a
close failure falls back to `SIGKILL` rather than masking the original error.

### Errors and logs do not leak the host — `src/sanitize.js`, `src/server.js`

Puppeteer errors routinely embed local filesystem paths. `sanitizeErrorMessage`
reduces any error to a single line with path-like substrings replaced before it
reaches the caller. Per-search progress logging (which includes search terms and
ZIP codes) is off unless `CAR_DEALS_DEBUG=1`.

## Supply chain notes

- `server.json` previously advertised installation via `npx -y car-deals-mcp`,
  an npm package name this project does not publish. Anyone who registered that
  name could have had their code executed on users' machines. That block has
  been removed; install from source. If you later publish to npm, claim the name
  first and restore the entry with a pinned version.
- `mcp.json` previously declared an HTTP port. The server speaks stdio only and
  never listens on a socket; the declaration has been replaced with
  `"transport": "stdio"` so a host does not expose a port on its behalf.
- `puppeteer-extra-plugin-stealth` exists to evade bot detection. Keep that in
  mind against the target sites' terms of service, and note that stealth plugins
  are a frequent malware-distribution target — pin and review upgrades.
- Dependencies carried 16 known advisories (1 critical, 12 high), including a
  cross-client data leak in `@modelcontextprotocol/sdk` and an uninitialized
  memory disclosure in `ws` — the socket Puppeteer speaks CDP over, which is
  exactly the channel carrying hostile page data. Both are on paths this server
  uses. `npm audit` is now clean; `npm run audit` re-checks at the `high`
  threshold. The SDK floor is pinned to `^1.30.0` so a fresh install cannot
  resolve back to a vulnerable build.

## Environment variables

| Variable | Default | Effect |
| --- | --- | --- |
| `CAR_DEALS_ALLOW_NO_SANDBOX` | unset | `1` launches Chromium without its sandbox. Containers only. |
| `CAR_DEALS_MAX_CONCURRENT_BROWSERS` | `2` | Maximum simultaneous Chromium instances. |
| `CAR_DEALS_LOAD_ALL_RESOURCES` | unset | `1` stops blocking image/media/font requests. Only if a site needs them to render. |
| `CAR_DEALS_DEBUG` | unset | `1` logs per-search progress, including search terms, to stderr. |
| `PUPPETEER_EXECUTABLE_PATH` | unset | Path to a Chrome/Chromium binary (read by Puppeteer). |

## Running the checks

```bash
npm test     # security boundary tests; no network, no browser
npm run smoke -- Toyota Camry  # optional: one real Cars.com search
```

## Reporting a vulnerability

Open a security advisory on the GitHub repository rather than a public issue.
