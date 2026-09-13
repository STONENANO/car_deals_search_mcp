#!/usr/bin/env node
'use strict';

/**
 * Manual smoke check: runs one real Cars.com search end to end.
 *
 * This is deliberately not part of `npm test` — it depends on a third-party
 * site's live markup and bot defenses, so it fails for reasons that have
 * nothing to do with this code. `npm test` covers the security boundaries and
 * needs neither a network nor a browser.
 */

const { validateSearchArgs } = require('../src/validate.js');
const { scrapeCarscom } = require('../src/scraper.js');

async function main() {
    const { params, maxResults } = validateSearchArgs({
        make: process.argv[2] || 'Toyota',
        model: process.argv[3] || 'Camry',
        maxResults: 3,
    });

    console.log(`Searching for ${params.make} ${params.model} near ${params.zip}...\n`);
    const listings = await scrapeCarscom(params, maxResults);

    if (listings.length === 0) {
        console.log('No listings returned. The site layout or its bot defenses may have changed.');
        return;
    }
    for (const listing of listings) {
        console.log(listing.format());
        console.log('---');
    }
}

main().catch(err => {
    console.error(err.message);
    process.exit(1);
});
