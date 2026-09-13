'use strict';

/**
 * Input validation for the search_car_deals tool.
 *
 * Every value reaching this module comes from an LLM or an untrusted MCP
 * client, so nothing is trusted: types, ranges, lengths and character sets are
 * all checked before any value is used to build a URL or drive a browser.
 */

/** Thrown for caller-supplied input that fails validation. Safe to show back. */
class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
    }
}

const SUPPORTED_SOURCES = Object.freeze(['cars.com', 'autotrader', 'kbb']);

const LIMITS = Object.freeze({
    NAME_MAX_LENGTH: 40,
    YEAR_MIN: 1900,
    YEAR_MAX_OFFSET: 2,
    PRICE_MAX: 10000000,
    MILEAGE_MAX: 2000000,
    MAX_RESULTS_DEFAULT: 10,
    MAX_RESULTS_CAP: 25,
});

// Make/model become URL path segments on Autotrader and KBB. Restricting them
// to this set keeps traversal (`..`), separators (`/`, `?`, `#`, `\`, `@`) and
// percent-escapes out of the path entirely, rather than relying on encoding
// alone to defuse them.
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 .+-]*$/;
const ZIP_PATTERN = /^\d{5}$/;

function requireString(value, field, { maxLength }) {
    if (typeof value !== 'string') {
        throw new ValidationError(`"${field}" must be a string.`);
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        throw new ValidationError(`"${field}" must not be empty.`);
    }
    if (trimmed.length > maxLength) {
        throw new ValidationError(`"${field}" must be at most ${maxLength} characters.`);
    }
    return trimmed;
}

function validateName(value, field) {
    const trimmed = requireString(value, field, { maxLength: LIMITS.NAME_MAX_LENGTH });
    if (!NAME_PATTERN.test(trimmed)) {
        throw new ValidationError(
            `"${field}" may only contain letters, digits, spaces and the characters . + -`
        );
    }
    return trimmed;
}

function validateZip(value) {
    const trimmed = requireString(value, 'zip', { maxLength: 5 });
    if (!ZIP_PATTERN.test(trimmed)) {
        throw new ValidationError('"zip" must be a 5-digit US ZIP code.');
    }
    return trimmed;
}

function validateInteger(value, field, { min, max }) {
    // Accept only real integers — no numeric strings, no NaN/Infinity, no
    // floats that would round into a different value downstream.
    if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new ValidationError(`"${field}" must be an integer.`);
    }
    if (value < min || value > max) {
        throw new ValidationError(`"${field}" must be between ${min} and ${max}.`);
    }
    return value;
}

function validateBoolean(value, field) {
    if (typeof value !== 'boolean') {
        throw new ValidationError(`"${field}" must be a boolean.`);
    }
    return value;
}

function validateSources(value) {
    if (!Array.isArray(value)) {
        throw new ValidationError('"sources" must be an array of strings.');
    }
    if (value.length === 0) {
        throw new ValidationError('"sources" must list at least one source.');
    }
    if (value.length > SUPPORTED_SOURCES.length) {
        throw new ValidationError(`"sources" must list at most ${SUPPORTED_SOURCES.length} entries.`);
    }
    const selected = [];
    for (const entry of value) {
        if (typeof entry !== 'string') {
            throw new ValidationError('"sources" must be an array of strings.');
        }
        const normalized = entry.trim().toLowerCase();
        if (!SUPPORTED_SOURCES.includes(normalized)) {
            throw new ValidationError(
                `Unknown source "${normalized}". Supported sources: ${SUPPORTED_SOURCES.join(', ')}.`
            );
        }
        if (!selected.includes(normalized)) selected.push(normalized);
    }
    return selected;
}

/**
 * Validate and normalize the arguments of a search_car_deals call.
 *
 * Returns `{ params, maxResults, sources }` with only known keys present, so
 * nothing a caller invented can travel further into the scrapers.
 */
function validateSearchArgs(args) {
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
        throw new ValidationError('Tool arguments must be an object.');
    }

    const params = {
        make: validateName(args.make, 'make'),
        model: validateName(args.model, 'model'),
        zip: args.zip === undefined ? '90210' : validateZip(args.zip),
    };

    const currentYear = new Date().getUTCFullYear();
    const yearMax = currentYear + LIMITS.YEAR_MAX_OFFSET;

    if (args.yearMin !== undefined) {
        params.yearMin = validateInteger(args.yearMin, 'yearMin', { min: LIMITS.YEAR_MIN, max: yearMax });
    }
    if (args.yearMax !== undefined) {
        params.yearMax = validateInteger(args.yearMax, 'yearMax', { min: LIMITS.YEAR_MIN, max: yearMax });
    }
    if (params.yearMin !== undefined && params.yearMax !== undefined && params.yearMin > params.yearMax) {
        throw new ValidationError('"yearMin" must not be greater than "yearMax".');
    }

    if (args.priceMax !== undefined) {
        params.priceMax = validateInteger(args.priceMax, 'priceMax', { min: 1, max: LIMITS.PRICE_MAX });
    }
    if (args.mileageMax !== undefined) {
        params.mileageMax = validateInteger(args.mileageMax, 'mileageMax', { min: 0, max: LIMITS.MILEAGE_MAX });
    }

    if (args.oneOwner !== undefined) params.oneOwner = validateBoolean(args.oneOwner, 'oneOwner');
    if (args.noAccidents !== undefined) params.noAccidents = validateBoolean(args.noAccidents, 'noAccidents');
    if (args.personalUse !== undefined) params.personalUse = validateBoolean(args.personalUse, 'personalUse');

    const maxResults = args.maxResults === undefined
        ? LIMITS.MAX_RESULTS_DEFAULT
        : validateInteger(args.maxResults, 'maxResults', { min: 1, max: LIMITS.MAX_RESULTS_CAP });

    const sources = args.sources === undefined ? ['cars.com'] : validateSources(args.sources);

    return { params, maxResults, sources };
}

module.exports = {
    ValidationError,
    SUPPORTED_SOURCES,
    LIMITS,
    validateSearchArgs,
};
