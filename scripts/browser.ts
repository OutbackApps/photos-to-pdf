/*
 * The browser the tests run in: Chrome for Testing, at the version in package.json's "testBrowser",
 * downloaded once into .cache/browsers (not in the repo). The same build on every computer and in CI,
 * so the tests behave the same everywhere. `bun install` runs this (postinstall); so does
 * `bun run browser`. The tests use it from executablePath(), unless BROWSER_PATH says otherwise.
 */

import fs from 'node:fs';
import path from 'node:path';
import { type Browser, computeExecutablePath, install } from '@puppeteer/browsers';
import pkg from '../package.json';

const options = { browser: pkg.testBrowser.browser as Browser, buildId: pkg.testBrowser.buildId, cacheDir: path.join(import.meta.dir, '..', '.cache', 'browsers') };
export const label = `${pkg.testBrowser.browser} ${pkg.testBrowser.buildId}`;

/** Where the tests' browser is, downloaded or not. */
export const executablePath = (): string => computeExecutablePath(options);

async function main(): Promise<void> {
    if (fs.existsSync(executablePath())) return console.log(`Test browser: ${label} (already downloaded).`);
    console.log(`Downloading the test browser, ${label} (once, about 170 MB)…`);
    await install(options);
    console.log(`Test browser: ${label}, in .cache/browsers.`);
}

if (import.meta.main) {
    try {
        await main();
    } catch (err) {
        console.error(`Couldn't download the test browser (${label}): ${err instanceof Error ? err.message : String(err)}`);
        // bun install still finishes (e.g. offline); `bun run browser` tries again, and the tests say what's missing.
        if (process.env.npm_lifecycle_event !== 'postinstall') process.exitCode = 1;
    }
}
