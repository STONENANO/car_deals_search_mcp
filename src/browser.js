'use strict';

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

/**
 * Browser lifecycle and hardening.
 *
 * Every page this server loads is attacker-influenced content, so the browser
 * is treated as the boundary between the internet and the user's machine: the
 * Chromium sandbox stays on, the renderer keeps the same-origin policy,
 * downloads and popups are refused, and unnecessary parsers (images, fonts,
 * media) are never fed at all.
 */

const NAVIGATION_TIMEOUT_MS = 30000;
const PROTOCOL_TIMEOUT_MS = 60000;
const RENDER_SETTLE_MS = 5000;

// Origins this server is ever meant to visit.
const DENIED_PERMISSION_ORIGINS = Object.freeze([
    'https://www.cars.com',
    'https://www.autotrader.com',
    'https://www.kbb.com',
]);

// Resource types we never need for text extraction. Blocking them removes the
// image/font/video parsers -- a large share of historical renderer CVEs -- from
// the attack surface and makes each scrape cheaper. Set
// CAR_DEALS_LOAD_ALL_RESOURCES=1 if a site turns out to gate its rendering on
// them.
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);

function envFlag(name) {
    const value = process.env[name];
    return value === '1' || value === 'true';
}

/**
 * Bounded concurrency so a burst of tool calls cannot spawn an unbounded
 * number of Chromium processes and exhaust the host's memory.
 */
class Semaphore {
    constructor(limit) {
        this.limit = Math.max(1, limit);
        this.active = 0;
        this.queue = [];
    }

    async acquire() {
        if (this.active < this.limit) {
            this.active += 1;
            return;
        }
        await new Promise(resolve => this.queue.push(resolve));
        this.active += 1;
    }

    release() {
        this.active = Math.max(0, this.active - 1);
        const next = this.queue.shift();
        if (next) next();
    }
}

function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const browserSemaphore = new Semaphore(
    parsePositiveInt(process.env.CAR_DEALS_MAX_CONCURRENT_BROWSERS, 2)
);

/**
 * Reject a promise that outlives `ms`.
 *
 * page.goto has its own timeout, but page.evaluate does not: a page that pins
 * its main thread would otherwise hang a scrape — and the MCP client — forever.
 */
function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function launchArgs() {
    const args = [
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-sync',
        '--disable-default-apps',
        '--no-first-run',
        '--no-default-browser-check',
        '--mute-audio',
        // Refuse windows the page tries to open for itself.
        '--block-new-web-contents',
    ];

    // The Chromium sandbox is what keeps a renderer compromise from becoming
    // code execution as the user. It is only dropped when an operator opts in
    // explicitly, which some container images require.
    if (envFlag('CAR_DEALS_ALLOW_NO_SANDBOX')) {
        console.error(
            '[car-deals] WARNING: CAR_DEALS_ALLOW_NO_SANDBOX is set; launching Chromium ' +
            'without its sandbox. Only do this inside an isolated container.'
        );
        args.push('--no-sandbox', '--disable-setuid-sandbox');
    }

    return args;
}

/**
 * Launch a hardened headless browser. Callers must pass the returned browser to
 * `closeBrowser`, which also releases the concurrency slot.
 */
async function launchBrowser() {
    await browserSemaphore.acquire();
    try {
        const browser = await puppeteer.launch({
            headless: true,
            args: launchArgs(),
            protocolTimeout: PROTOCOL_TIMEOUT_MS,
        });
        browser.once('disconnected', () => {});
        return browser;
    } catch (err) {
        browserSemaphore.release();
        throw err;
    }
}

/**
 * Close a browser without ever throwing, and release its concurrency slot.
 * A failure here must not mask the error that caused the scrape to unwind.
 */
async function closeBrowser(browser) {
    try {
        if (browser && browser.process() !== null) {
            await browser.close();
        }
    } catch (err) {
        console.error(`[car-deals] Failed to close browser cleanly: ${err.message}`);
        try {
            const proc = browser && browser.process();
            if (proc) proc.kill('SIGKILL');
        } catch {
            // Nothing further we can do.
        }
    } finally {
        browserSemaphore.release();
    }
}

/**
 * Open a page with navigation limits, download/permission denial, and
 * request filtering applied before any untrusted URL is loaded.
 */
async function newHardenedPage(browser) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    page.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);

    // A page must not be able to write to disk or prompt for device access.
    try {
        const client = await page.createCDPSession();
        await client.send('Browser.setDownloadBehavior', { behavior: 'deny' });
    } catch (err) {
        console.error(`[car-deals] Could not disable downloads: ${err.message}`);
    }

    // Deny geolocation, notifications and friends for the origins we visit, so a
    // page cannot prompt (and block) mid-scrape.
    const context = browser.defaultBrowserContext();
    for (const origin of DENIED_PERMISSION_ORIGINS) {
        try {
            await context.overridePermissions(origin, []);
        } catch (err) {
            console.error(`[car-deals] Could not clear permissions for ${origin}: ${err.message}`);
        }
    }

    const blockHeavyResources = !envFlag('CAR_DEALS_LOAD_ALL_RESOURCES');
    await page.setRequestInterception(true);
    page.on('request', request => {
        try {
            const url = request.url();
            const isWebScheme = url.startsWith('https://') || url.startsWith('http://');
            const isBlockedType = blockHeavyResources && BLOCKED_RESOURCE_TYPES.has(request.resourceType());
            if (!isWebScheme || isBlockedType) {
                request.abort().catch(() => {});
                return;
            }
            request.continue().catch(() => {});
        } catch {
            request.abort().catch(() => {});
        }
    });

    // Dialogs from a hostile page would block the scrape indefinitely.
    page.on('dialog', dialog => {
        dialog.dismiss().catch(() => {});
    });

    return page;
}

/**
 * Navigate to `url`, let client-side rendering settle, and run `extractor`
 * inside the page under a hard timeout.
 */
async function loadAndExtract(page, url, extractor, label) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
    await new Promise(resolve => setTimeout(resolve, RENDER_SETTLE_MS));
    return withTimeout(page.evaluate(extractor), NAVIGATION_TIMEOUT_MS, `${label} extraction`);
}

module.exports = {
    Semaphore,
    launchBrowser,
    closeBrowser,
    newHardenedPage,
    loadAndExtract,
    withTimeout,
    NAVIGATION_TIMEOUT_MS,
};
