'use strict';

/*
 * The browser the tests run in: Chrome for Testing, at the version in package.json's "testBrowser",
 * downloaded once into .cache/browsers (not in the repo). The same build on every computer and in CI,
 * so the tests behave the same everywhere. `bun install` runs this (postinstall); so does
 * `bun run browser`. The tests use it from executablePath(), unless BROWSER_PATH says otherwise.
 */

const fs = require('node:fs');
const path = require('node:path');
const { install, computeExecutablePath } = require('@puppeteer/browsers');
const { testBrowser } = require('../package.json');

const options = { browser: testBrowser.browser, buildId: testBrowser.buildId, cacheDir: path.join(__dirname, '..', '.cache', 'browsers') };
const label = `${testBrowser.browser} ${testBrowser.buildId}`;

/** Where the tests' browser is, downloaded or not. */
const executablePath = () => computeExecutablePath(options);

module.exports = { executablePath, label };

async function main() {
    if (fs.existsSync(executablePath())) return console.log(`Test browser: ${label} (already downloaded).`);
    console.log(`Downloading the test browser, ${label} (once, about 170 MB)…`);
    await install(options);
    console.log(`Test browser: ${label}, in .cache/browsers.`);
}

if (require.main === module) {
    main().catch((err) => {
        console.error(`Couldn't download the test browser (${label}): ${err.message}`);
        // bun install still finishes (e.g. offline); `bun run browser` tries again, and the tests say what's missing.
        if (process.env.npm_lifecycle_event !== 'postinstall') process.exitCode = 1;
    });
}
