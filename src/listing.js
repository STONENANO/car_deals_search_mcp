'use strict';

const { sanitizeText, sanitizeUrl } = require('./sanitize.js');

/**
 * The listing model and the trust boundary around it.
 *
 * Raw objects returned from `page.evaluate` are fully page-controlled. They
 * become `CarListing`s only by passing through this module, which sanitizes
 * every text field and validates every link against the source's own origin.
 */

const SOURCES = Object.freeze({
    CARS_COM: { label: 'Cars.com', base: 'https://www.cars.com/', host: 'cars.com' },
    AUTOTRADER: { label: 'Autotrader', base: 'https://www.autotrader.com/', host: 'autotrader.com' },
    KBB: { label: 'KBB', base: 'https://www.kbb.com/', host: 'kbb.com' },
});

// Upper bound on the cards read from a single page, independent of the
// caller's maxResults, so a page with tens of thousands of nodes cannot pin
// the extraction or balloon the response.
const MAX_CARDS_PER_PAGE = 60;

/**
 * A single listing. Text fields are sanitized on construction, so a
 * `CarListing` never holds raw page content.
 */
class CarListing {
    constructor(data) {
        this.title = sanitizeText(data.title, 120);
        this.price = sanitizeText(data.price, 24);
        this.mileage = sanitizeText(data.mileage, 24);
        this.dealerName = sanitizeText(data.dealerName, 80);
        this.location = sanitizeText(data.location, 80);
        this.dealRating = sanitizeText(data.dealRating, 40);
        // Already validated against an origin allowlist by `toListings`.
        this.url = typeof data.url === 'string' ? data.url : null;
        this.source = sanitizeText(data.source, 40);
        // CarFax badges
        this.isOneOwner = data.isOneOwner === true;
        this.noAccidents = data.noAccidents === true;
        this.personalUse = data.personalUse === true;
    }

    format() {
        let result = `${this.title || 'Unknown Vehicle'}`;
        if (this.price) result += `\n  Price: ${this.price}`;
        if (this.mileage) result += `\n  Mileage: ${this.mileage}`;
        if (this.dealRating) result += `\n  Deal Rating: ${this.dealRating}`;

        // CarFax badges
        const badges = [];
        if (this.isOneOwner) badges.push('1-Owner');
        if (this.noAccidents) badges.push('No Accidents');
        if (this.personalUse) badges.push('Personal Use');
        if (badges.length > 0) result += `\n  CarFax: ${badges.join(' | ')}`;

        if (this.dealerName) result += `\n  Dealer: ${this.dealerName}`;
        if (this.location) result += `\n  Location: ${this.location}`;
        if (this.source) result += `\n  Source: ${this.source}`;
        if (this.url) result += `\n  ${this.url}`;
        return result;
    }
}

/**
 * Join pre-validated segments into a URL path.
 *
 * This is belt-and-braces on top of the character allowlist in validate.js:
 * even if that allowlist is ever widened, separators cannot reach the path.
 * Dot segments get their own check because encodeURIComponent leaves `.` and
 * `..` untouched, so encoding alone would not stop traversal.
 */
function buildPath(...segments) {
    return segments
        .filter(segment => segment !== undefined && segment !== null && segment !== '')
        .map(segment => {
            const value = String(segment);
            if (value === '.' || value === '..') {
                throw new Error('Refusing to build a URL path containing a dot segment.');
            }
            return encodeURIComponent(value);
        })
        .join('/');
}

/**
 * Convert raw, page-controlled objects into sanitized CarListings.
 */
function toListings(rawListings, maxResults, source) {
    if (!Array.isArray(rawListings)) return [];

    const requested = Number.isInteger(maxResults) ? maxResults : 1;
    const limit = Math.min(Math.max(1, requested), MAX_CARDS_PER_PAGE);

    return rawListings.slice(0, limit).map(item => {
        const safeItem = item && typeof item === 'object' ? item : {};
        return new CarListing({
            title: safeItem.title,
            price: safeItem.price,
            mileage: safeItem.mileage,
            dealerName: safeItem.dealerName,
            location: safeItem.location,
            dealRating: safeItem.dealRating,
            url: sanitizeUrl(safeItem.href, source.base, source.host),
            source: source.label,
            isOneOwner: safeItem.isOneOwner,
            noAccidents: safeItem.noAccidents,
            personalUse: safeItem.personalUse,
        });
    });
}

module.exports = {
    CarListing,
    SOURCES,
    MAX_CARDS_PER_PAGE,
    buildPath,
    toListings,
};
