'use strict';

const { launchBrowser, closeBrowser, newHardenedPage, loadAndExtract } = require('./browser.js');
const { sanitizeErrorMessage } = require('./sanitize.js');
const { CarListing, SOURCES, buildPath, toListings } = require('./listing.js');

/**
 * Scrapers for the supported listing sites.
 *
 * Two rules hold throughout this file:
 *   1. Nothing a caller supplied is spliced into a URL unencoded.
 *   2. Nothing a page returned leaves this file unsanitized -- every raw
 *      extraction result goes through `toListings`.
 */

/**
 * Run one scraper against a hardened browser, guaranteeing cleanup.
 */
async function withBrowser(sourceLabel, fn) {
    let browser;
    try {
        browser = await launchBrowser();
        const page = await newHardenedPage(browser);
        return await fn(page);
    } catch (err) {
        // Puppeteer messages can carry local paths; reduce before re-throwing.
        throw new Error(`${sourceLabel} scraping failed: ${sanitizeErrorMessage(err, 'unknown error')}`);
    } finally {
        if (browser) await closeBrowser(browser);
    }
}

/**
 * Scrape Cars.com for car listings
 */
async function scrapeCarscom(params, maxResults = 20) {
    return withBrowser(SOURCES.CARS_COM.label, async page => {
        const url = new URL('shopping/results/', SOURCES.CARS_COM.base);
        const q = url.searchParams;
        q.set('stock_type', 'used');
        if (params.make) q.set('makes[]', params.make.toLowerCase());
        if (params.model) q.set('models[]', `${params.make.toLowerCase()}-${params.model.toLowerCase()}`);
        if (params.zip) q.set('zip', params.zip);
        if (params.yearMin) q.set('year_min', String(params.yearMin));
        if (params.yearMax) q.set('year_max', String(params.yearMax));
        if (params.priceMax) q.set('list_price_max', String(params.priceMax));
        if (params.mileageMax) q.set('mileage_max', String(params.mileageMax));

        // CarFax history filters
        if (params.oneOwner) q.set('one_owner', 'true');
        if (params.noAccidents) q.set('no_accidents', 'true');
        if (params.personalUse) q.set('personal_use', 'true');

        const rawListings = await loadAndExtract(page, url.href, () => {
            const MAX_CARDS = 60;
            const MAX_TEXT = 4000;
            const results = [];
            const cards = Array.from(document.querySelectorAll('.vehicle-card')).slice(0, MAX_CARDS);

            cards.forEach(card => {
                const text = (card.innerText || '').slice(0, MAX_TEXT);
                const lines = text.split('\n').filter(l => l.trim()).slice(0, 40);

                let title = null;
                let price = null;
                let mileage = null;
                let dealRating = null;
                let dealerName = null;
                let location = null;

                for (const line of lines) {
                    const trimmed = line.trim();

                    // Title: Year Make Model (e.g., "2020 Toyota Camry XSE")
                    if (/^(19|20)\d{2}\s+\w+/.test(trimmed) && !title) {
                        title = trimmed;
                        continue;
                    }

                    // Price: "$XX,XXX" (may have "price drop" suffix)
                    const priceMatch = trimmed.match(/^\$[\d,]+/);
                    if (priceMatch && !price) {
                        price = priceMatch[0];
                        continue;
                    }

                    // Mileage: "XX,XXX mi."
                    if (/^[\d,]+\s*mi\.?$/i.test(trimmed) && !mileage) {
                        mileage = trimmed;
                        continue;
                    }

                    // Deal rating: "Good Deal", "Great Deal", etc.
                    if (/^(great|good|fair|high|no price)/i.test(trimmed) && !dealRating) {
                        dealRating = trimmed.split('|')[0].trim();
                        continue;
                    }

                    // Location: "City, ST (XX mi.)"
                    if (/^[A-Z][a-z]+.*,\s*[A-Z]{2}\s*\(/i.test(trimmed) && !location) {
                        location = trimmed;
                        continue;
                    }
                }

                // Get dealer name - usually after reviews count
                const dealerMatch = card.querySelector('.dealer-name');
                if (dealerMatch) {
                    dealerName = (dealerMatch.innerText || '').trim();
                } else {
                    // Fallback: look for line before reviews
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i].includes('reviews') && i > 0) {
                            dealerName = lines[i - 1].trim();
                            break;
                        }
                    }
                }

                // Get URL from the card link
                const linkEl = card.querySelector('a.vehicle-card-link');
                const href = linkEl ? linkEl.getAttribute('href') : null;

                // Check for CarFax badges
                const fullText = text.toLowerCase();
                const isOneOwner = fullText.includes('1-owner') || fullText.includes('one owner');
                const noAccidents = fullText.includes('no accident') || fullText.includes('clean');
                const personalUse = fullText.includes('personal use');

                if (title) {
                    results.push({ title, price, mileage, dealRating, dealerName, location, href, isOneOwner, noAccidents, personalUse });
                }
            });

            return results;
        }, SOURCES.CARS_COM.label);

        return toListings(rawListings, maxResults, SOURCES.CARS_COM);
    });
}

/**
 * Scrape Autotrader for car listings
 */
async function scrapeAutotrader(params, maxResults = 20) {
    return withBrowser(SOURCES.AUTOTRADER.label, async page => {
        const make = params.make ? params.make.toLowerCase() : '';
        const model = params.model ? params.model.toLowerCase() : '';
        const zip = params.zip || '90210';

        const url = new URL(
            buildPath('cars-for-sale', 'all-cars', make, model, `beverly-hills-ca-${zip}`),
            SOURCES.AUTOTRADER.base
        );
        if (params.yearMin) url.searchParams.set('startYear', String(params.yearMin));
        if (params.yearMax) url.searchParams.set('endYear', String(params.yearMax));
        if (params.priceMax) url.searchParams.set('maxPrice', String(params.priceMax));
        if (params.mileageMax) url.searchParams.set('maxMileage', String(params.mileageMax));

        const rawListings = await loadAndExtract(page, url.href, () => {
            const MAX_CARDS = 60;
            const results = [];

            // Autotrader uses various selectors for listings
            const cards = Array.from(
                document.querySelectorAll('[data-cmp="inventoryListing"], .inventory-listing')
            ).slice(0, MAX_CARDS);

            cards.forEach(card => {
                const titleEl = card.querySelector('h2, .text-bold');
                const priceEl = card.querySelector('[data-cmp="firstPrice"], .first-price');
                const mileageEl = card.querySelector('.text-subdued-lighter');
                const dealerEl = card.querySelector('.dealer-name, .text-subdued');
                const linkEl = card.querySelector('a[href*="/cars-for-sale/"]');

                const title = titleEl ? (titleEl.innerText || '').trim() : null;
                const price = priceEl ? (priceEl.innerText || '').trim() : null;

                // Get mileage from text
                let mileage = null;
                if (mileageEl) {
                    const text = (mileageEl.innerText || '').slice(0, 500);
                    const match = text.match(/([\d,]+)\s*miles?/i);
                    if (match) mileage = match[0];
                }

                if (title) {
                    results.push({
                        title,
                        price,
                        mileage,
                        dealerName: dealerEl ? (dealerEl.innerText || '').trim() : null,
                        href: linkEl ? linkEl.getAttribute('href') : null,
                    });
                }
            });

            return results;
        }, SOURCES.AUTOTRADER.label);

        return toListings(rawListings, maxResults, SOURCES.AUTOTRADER);
    });
}

/**
 * Scrape KBB for car listings
 */
async function scrapeKBB(params, maxResults = 20) {
    return withBrowser(SOURCES.KBB.label, async page => {
        const make = params.make ? params.make.toLowerCase() : '';
        const model = params.model ? params.model.toLowerCase() : '';
        const zip = params.zip || '90210';

        const url = new URL(buildPath('cars-for-sale', 'all', make, model), SOURCES.KBB.base);
        url.searchParams.set('zip', zip);
        if (params.yearMin) url.searchParams.set('startYear', String(params.yearMin));
        if (params.yearMax) url.searchParams.set('endYear', String(params.yearMax));
        if (params.priceMax) url.searchParams.set('maxPrice', String(params.priceMax));
        if (params.mileageMax) url.searchParams.set('maxMileage', String(params.mileageMax));

        const rawListings = await loadAndExtract(page, url.href, () => {
            const MAX_CARDS = 60;
            const MAX_TEXT = 4000;
            const results = [];

            const cards = Array.from(
                document.querySelectorAll('[data-cmp="inventoryListing"]')
            ).slice(0, MAX_CARDS);

            cards.forEach(card => {
                const text = (card.innerText || '').slice(0, MAX_TEXT);
                if (!text || text.length < 20) return;

                const lines = text.split('\n').filter(l => l.trim()).slice(0, 40);

                let title = null;
                let trim = null;
                let price = null;
                let mileage = null;
                let dealRating = null;

                for (const line of lines) {
                    const trimmed = line.trim();

                    // Title: Year Make Model
                    if (/^(19|20)\d{2}\s+\w+/.test(trimmed) && !title) {
                        title = trimmed;
                        continue;
                    }

                    // Trim (usually follows title, like "XSE" or "LE")
                    if (title && !trim && /^[A-Z]{1,4}$/.test(trimmed)) {
                        trim = trimmed;
                        continue;
                    }

                    // Price: "$XX,XXX" or just "XX,XXX" (KBB sometimes omits $)
                    const priceMatch = trimmed.match(/^\$?([\d,]+)$/);
                    if (priceMatch && !price && parseInt(priceMatch[1].replace(/,/g, ''), 10) > 1000) {
                        price = trimmed.startsWith('$') ? trimmed : `$${trimmed}`;
                        continue;
                    }

                    // Mileage: "XXK mi" or "XX,XXX mi"
                    if (/^\d+K?\s*mi$/i.test(trimmed) && !mileage) {
                        mileage = trimmed;
                        continue;
                    }

                    // Deal rating: "Good Price", "Great Price", "Fair Price"
                    if (/^(good|great|fair|high)\s*(price|deal)/i.test(trimmed) && !dealRating) {
                        dealRating = trimmed;
                        continue;
                    }
                }

                if (title) {
                    if (trim) title = `${title} ${trim}`;
                    results.push({ title, price, mileage, dealRating });
                }
            });

            return results;
        }, SOURCES.KBB.label);

        return toListings(rawListings, maxResults, SOURCES.KBB);
    });
}

/**
 * Search all sources and combine results
 */
async function searchAllSources(params, maxResultsPerSource = 10) {
    const results = {
        listings: [],
        errors: [],
    };

    // Run scrapers in parallel (bounded by the browser semaphore).
    const scrapers = [
        { name: SOURCES.CARS_COM.label, fn: () => scrapeCarscom(params, maxResultsPerSource) },
        { name: SOURCES.AUTOTRADER.label, fn: () => scrapeAutotrader(params, maxResultsPerSource) },
        { name: SOURCES.KBB.label, fn: () => scrapeKBB(params, maxResultsPerSource) },
    ];

    const outcomes = await Promise.all(scrapers.map(async scraper => {
        try {
            return { name: scraper.name, listings: await scraper.fn(), error: null };
        } catch (err) {
            return { name: scraper.name, listings: [], error: err.message };
        }
    }));

    for (const outcome of outcomes) {
        results.listings.push(...outcome.listings);
        if (outcome.error) {
            results.errors.push({ source: outcome.name, error: outcome.error });
        }
    }

    return results;
}

module.exports = {
    CarListing,
    SOURCES,
    buildPath,
    toListings,
    scrapeCarscom,
    scrapeAutotrader,
    scrapeKBB,
    searchAllSources,
};
