# CLAUDE.md

Photos to PDF: a ServiceM8 add-on (Simple Function, hosted by ServiceM8, deployed with Addon Kit). A job card button opens a popup that makes PDFs of the job diary's photos and saves them back to the job. See README.md for how it works and what's been seen in practice.

## Commands
- `bun install` - packages, and the test browser (Chrome for Testing, pinned in package.json's `testBrowser`, downloaded once into `.cache/`).
- `bun test` - must pass before finishing a change. `test/handler.test.js` (the function, fake ServiceM8 API) and `test/browser.test.js` (the popup in the test browser, its calls running index.js, saved PDFs read back with pdf.js). Same results here as in CI; nothing's skipped.
- `bun run spell` - must pass too (the same `cspell.json` as the Code Spell Checker extension).
- `bun run check` - validates addon.jsonc and bundles the function, without deploying.
- `bun run deploy` - deploys to ServiceM8 and activates it at once: only when asked. Bump `version` in addon.jsonc when the add-on changes; never change `slug` (a new slug is a new add-on).
- `bun run tail` - live logs (start it before using the add-on).
- Commit and push only when asked. A push runs CI (tests, spelling, dry run); it doesn't deploy.
- Commits are by Outback Apps alone (this repo's git config: `user.name` "Outback Apps", `user.email` 340592536+OutbackApps@users.noreply.github.com). No `Co-Authored-By` or other attribution lines in commit messages or pull requests: GitHub lists anyone named there as a contributor.

## Layout
- `index.js` - the function: the events (button and those the popup invokes) and ServiceM8 API calls. Node.js 24 in ServiceM8, Bun in tests: only what both have, no runtime dependencies.
- `page.js` - the popup: `SHELL_CSS`, `shell()`, and `photosToPdfPage`, which runs in the browser. It's sent as text (`pageScript()`, via `toString`), so it can't `require` anything or use the rest of page.js, except the standalone top-level helpers (`jpegInfo`..., `fillTemplate`, `templateParts`, `fieldAt`): a new top-level helper must be added to `pageScript()`'s list (and exported if tests use it).
- `addon.jsonc` - manifest: actions, OAuth scopes (keep `bun run login`'s in step), the `pdf_name` preference (its default must match `DEFAULT_NAME` in index.js; a test checks).
- `docs/` - help and privacy policy for customers (GitHub Pages). Keep them true to what the add-on does. `store-listing.md` - the Add-on Store listing.
- `scripts/browser.js` - downloads the test browser.

## Rules
- ServiceM8 Add-on Store rules: no "M8", "Mate" or "SM8" in names; spell ServiceM8 correctly; no self-promotion in the popup; only the permissions needed; nothing stored outside ServiceM8 (if that changes, update docs/privacy.md).
- Styling: ServiceM8's sdk.css loads first; SHELL_CSS uses its colours as `--` tokens and overrides it only for the popup's own parts (tiles, name boxes, "?", the green button). Check every hover/focus state when adding buttons or inputs: sdk.css styles all of them.
- No tooltips (`title`) anywhere in the popup; a test checks. Say it on the page instead.
- The popup must work on a phone (the ServiceM8 app) and with touch as well as a mouse.
- UI changes: check them with screenshots from the test browser (desktop and phone width), not just the tests.
- Code quality (SonarQube for IDE): no nested ternaries or template literals inside template literals, keep functions under the complexity limit by splitting them, `replaceAll`, `node:` imports.
- Writing (UI text, docs, comments, README): Australian spelling. Real words the dictionaries don't know go in `cspell.json`; codes get `// cspell:ignore` where they're used.
- ServiceM8 API docs index: https://developer.servicem8.com/llms.txt (append `.md` to doc URLs for raw markdown).
