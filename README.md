# Car Deals Search MCP

> **Search used car listings from Cars.com, Autotrader, and KBB with AI assistants**

An MCP (Model Context Protocol) server that aggregates and searches car listings from multiple sources. Scrapes listings in parallel, extracts price, mileage, dealer info, and applies optional CARFAX-style filters (1-owner, no accidents, personal use).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** (v16 or higher)
- **Chrome/Chromium** browser installed (required by Puppeteer)
  - If Chrome is not in the default location, set `PUPPETEER_EXECUTABLE_PATH` environment variable to point to your Chrome/Chromium binary

### Installation

```bash
# Clone the repository
git clone https://github.com/SiddarthaKoppaka/car_deals_search_mcp.git
cd car_deals_search_mcp

# Install dependencies (includes Puppeteer)
npm install
```

### Using with MCP Clients

Configure your MCP client (Claude Desktop, VS Code, GitHub Copilot, etc.) to use this server:

**For Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "car-deals": {
      "command": "node",
      "args": ["/absolute/path/to/car_deals_search_mcp/src/server.js"]
    }
  }
}
```

**For other MCP clients**, refer to their documentation and use:
- **Command**: `node`
- **Args**: `["<absolute-path-to-repo>/src/server.js"]`

### Testing Standalone

```bash
# Security boundary tests (no network, no browser required)
npm test

# Optional: one real Cars.com search, end to end
npm run smoke -- Toyota Camry
```

---

## ✨ Features

- **Multi-source aggregation**: Search Cars.com, Autotrader, and KBB simultaneously
- **Smart filtering**: CARFAX-style filters (1-Owner, No Accidents, Personal Use)
- **Deal ratings**: Heuristic-based deal quality assessment
- **Parallel scraping**: Fast concurrent queries across sources
- **Stealth mode**: Puppeteer with anti-bot detection techniques

---

## 📊 Supported Sources

| Source     | Price | Mileage | Deal Rating | Dealer Info | CARFAX Filters |
|------------|:-----:|:-------:|:-----------:|:-----------:|:--------------:|
| Cars.com   | ✅    | ✅      | ✅          | ✅          | ✅             |
| Autotrader | ✅    | ✅      | ⚠️ Limited   | ✅          | ⚠️ Limited     |
| KBB        | ✅    | ✅      | ✅          | ⚠️ Limited   | ⚠️ Limited     |

---

## 🔧 MCP Tool: `search_car_deals`

### Parameters

| Parameter    | Type     | Required | Description |
|--------------|----------|----------|-------------|
| `make`       | string   | ✅       | Car manufacturer, e.g. "Toyota". Letters, digits, spaces and `. + -` only; max 40 chars |
| `model`      | string   | ✅       | Car model, e.g. "Camry". Same character rules as `make` |
| `zip`        | string   | ❌       | 5-digit US ZIP code (default: "90210") |
| `yearMin`    | integer  | ❌       | Minimum model year |
| `yearMax`    | integer  | ❌       | Maximum model year |
| `priceMax`   | integer  | ❌       | Maximum price in USD |
| `mileageMax` | integer  | ❌       | Maximum mileage |
| `maxResults` | integer  | ❌       | Max results per source (default: 10, max: 25) |
| `sources`    | array    | ❌       | Sources to query: `["cars.com","autotrader","kbb"]` (default: `["cars.com"]`) |
| `oneOwner`   | boolean  | ❌       | Filter for CARFAX 1-owner vehicles only |
| `noAccidents`| boolean  | ❌       | Filter for no accidents reported |
| `personalUse`| boolean  | ❌       | Filter for personal use only (not rental/fleet) |

### Example Response

```
🚗 2021 Toyota Camry XSE
   💰 Price: $23,491
   📏 Mileage: 52,649 mi
   ⭐ Deal Rating: Good Deal
   🏆 CARFAX: 1-Owner | No Accidents | Personal Use
   🏪 Dealer: Valencia BMW
   🌐 Source: Cars.com
   🔗 https://www.cars.com/vehicledetail/...
```

---

## 🛠️ Technical Details

- **Scraping**: Puppeteer (headless Chromium, sandbox enabled) with stealth plugin
- **Concurrency**: Parallel scraper workers, bounded so a burst of calls cannot exhaust the host
- **Protocol**: Implements MCP (Model Context Protocol) for AI assistant integration
- **Data extraction**: Source-specific parsers normalize listings into a common schema
- **Trust boundaries**: Arguments are validated before use and scraped content is sanitized and
  marked as untrusted before it reaches the model — see [SECURITY.md](SECURITY.md)

### Chrome/Chromium Requirement

This project uses Puppeteer, which requires Chrome or Chromium to be installed:

- **macOS**: Chrome is typically at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- **Linux**: Usually auto-detected by Puppeteer or at `/usr/bin/chromium-browser`
- **Windows**: Typically at `C:\Program Files\Google\Chrome\Application\chrome.exe`

If Puppeteer cannot find your browser, set the environment variable:

```bash
export PUPPETEER_EXECUTABLE_PATH="/path/to/chrome"
```

---

## 🔒 Security

Listing text comes from third-party websites and is treated as hostile input:
it is sanitized, markdown-escaped and wrapped in an untrusted-data envelope
before it reaches the assistant, and scraped links are validated against the
source site's own origin. Tool arguments are validated before they are used to
build a URL. Chromium runs with its sandbox on.

Read [SECURITY.md](SECURITY.md) for the threat model, the full list of controls,
and the environment variables that tune them.

> Listings still say whatever their sellers wrote. Treat claims inside a listing
> as claims, not as facts or instructions.

---

## 🧪 Development & Testing

```bash
# Security boundary tests — no network or browser needed
npm test

# One real Cars.com search, end to end
npm run smoke -- Toyota Camry

# Layout of the source tree
#   src/server.js    MCP wiring, request handling, response formatting
#   src/validate.js  argument validation (untrusted input from the model)
#   src/scraper.js   per-site scrapers and URL construction
#   src/browser.js   browser hardening, timeouts, concurrency limits
#   src/listing.js   listing model and the sanitizing boundary
#   src/sanitize.js  text, URL and error sanitizers
```

---

## 🤝 Contributing

Contributions are welcome! Please follow this workflow:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Add tests for new functionality
4. Commit your changes (`git commit -m 'Add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

Please include test coverage for scraping/parsing changes to avoid regressions when source sites update.

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details

---

## 🔗 Links

- **Repository**: https://github.com/SiddarthaKoppaka/car_deals_search_mcp
- **Issues**: https://github.com/SiddarthaKoppaka/car_deals_search_mcp/issues
- **MCP Protocol**: https://modelcontextprotocol.io
