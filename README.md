# Photos to PDF

A ServiceM8 add-on hosted by ServiceM8. There's no server to run: deploy it with ServiceM8's Addon Kit and ServiceM8 runs it.

It adds a **Photos to PDF** button to the job card, on the web and in the app. Tap it and all of the job diary's photos are laid out in PDFs of a set number of photos each (50 unless you change it, and no more than 50). Leave out the ones you don't want, move the rest about, and save: the PDFs go back to the job diary as the staff member who made them.

Each page is just the photo, filling the page. The page is shaped to fit the photo, and there is no text or anything else. Photos are compressed a little to keep the PDFs a sensible size: up to 2400 pixels on the long side (about 280 dpi across an A4 page, so details can still be zoomed into) at JPEG quality 0.8, typically 0.5 to 1 MB a photo instead of a phone's 3 to 5 MB. JPEGs already that small go in exactly as they are.

Once they're saved, the popup says which PDFs were saved and to reopen the job to see them (ServiceM8 doesn't refresh an open job card's diary by itself), with anything that didn't work, such as photos that couldn't be read. **Done** closes it.

**The PDFs:** the photos are shown in sections, **PDF 1**, **PDF 2** and so on, each photo with its page number, then **New PDF** and **Left out**. They're named "Job 123 Photos (1 of 3).pdf" and so on (just "Job 123 Photos.pdf" if there's one), with the job's PO number when it has one: "Job 123 Photos - PO WA4567 (1 of 3).pdf".
- Tap or click a photo to leave it out: it moves to **Left out**. Tap it there to put it back, at the end.
- **Leave all out** / **Put all back** at the top. To pick a few photos from a lot, leave them all out, then tap the ones you want back, in the order you want them.
- Drag a photo (press and hold first on a phone) to a new spot in its PDF, into another PDF, into **New PDF** to start another one, or into **Left out**. The others move out of the way. Holding near the top or bottom edge scrolls.

**Too big for ServiceM8:** ServiceM8 turns away files over a size it doesn't publish. When it turns a PDF away, that PDF is saved in parts instead ("Job 123 Photos (1 of 3) part 1.pdf", "… part 2.pdf"), with the photos as they were and in order, and the finished view says so. The size it turned away is remembered on that device, so big PDFs are split before saving next time. A single photo too big for ServiceM8 on its own is made smaller again, just enough to fit.

**Photos per PDF:** the number next to the save button, remembered on that device. A PDF with more photos than that is shown in red as over the limit, but that's only a warning: it's saved as it is. Changing the number doesn't move any photos. **Split into PDFs of 50** (shown when the PDFs aren't already split that way) puts the photos into PDFs of that many, keeping their order. Leaving a photo out leaves a gap; nothing else moves.

**Adding photos from the device:** **+ Add photos** at the top opens the photo library, camera or file chooser. On a computer you can also drop image files onto the page. Added photos go on the end of the PDFs. Each one is also added to the job diary as you, and its tile shows the progress ("Adding to diary…", "Added to diary" or "Not added to diary"). The originals go to the diary at full size. If the popup has to send them through ServiceM8's add-on function, large ones are first saved as a full-resolution JPEG of up to about 3.5 MB. Saving finishes these uploads first (retrying any that failed), so they reach the job diary before the PDFs. If any still fail, the popup stays open to list them; they are in the PDFs regardless.

## Files

| File | What it is |
| --- | --- |
| `addon.jsonc` | The add-on's config for [Addon Kit](https://www.npmjs.com/package/@servicem8/addon-kit): its slug, its manifest (the **Photos to PDF** job card button on the web and in the app, and the permissions it needs) and the function's entry point. |
| `index.js` | The function: the events the popup and job card call, and the ServiceM8 API calls. No runtime dependencies; ServiceM8 runs it on Node.js 24. |
| `page.js` | The popup: its styles, and the code that runs in the browser (sent to the page by `index.js`). |
| `icon.png` | The job card button's icon, linked from `addon.jsonc`. |
| `package.json`, `bun.lock` | Addon Kit (a dev dependency) and the scripts below. |
| `test/` | Tests (no ServiceM8 account needed): `handler.test.js` for the function, `browser.test.js` for the popup in a real browser. |

## Development

Needs [Bun](https://bun.sh) 1.3 or later.

```sh
bun install
bun test        # run the tests
bun run check   # validate addon.jsonc and bundle the function, without deploying
```

The tests pretend to be ServiceM8 (its API, its photo storage and its SDK), so they need no account. `handler.test.js` covers the function. `browser.test.js` opens the popup in a headless browser, with its calls to the function running `index.js` itself: it leaves photos out, drags them between PDFs, saves, and opens the saved PDFs with pdf.js to check every page (JPEGs byte for byte, the right way round). It needs Chrome, Edge or Chromium, found in the usual places or set with `BROWSER_PATH`; without one it's skipped, except in CI. They run with Bun, but the function itself runs on Node.js in ServiceM8, so `index.js` and `page.js` only use what both have. GitHub Actions runs the tests and `bun run check` on every push.

## Deploy to ServiceM8

The add-on is deployed with ServiceM8's [Addon Kit](https://developer.servicem8.com/docs/addon-kit).

1. Log in with the scopes the function uses (they're in `addon.jsonc`):
   ```sh
   bun run login    # the scopes are in this script; update it if addon.jsonc's change
   bun run whoami
   ```
2. Deploy. This bundles `index.js` (with `page.js`), creates or updates the add-on with the slug `photos-to-pdf`, and activates it on your account straight away:
   ```sh
   bun run deploy
   ```
3. Open a job and tap **Photos to PDF**: in the job card's add-ons on the web, and in the job's actions in the app.

When you change the add-on, bump `version` in `addon.jsonc` and run `bun run deploy` again. Don't change `slug`: a different slug deploys a separate, new add-on.

For live logs, run `bun run tail` (or `bunx addon-kit tail --filter '"ERROR"'` for errors only). It only shows new logs, so start it before using the add-on.

To deploy from CI, store an API key as the `SM8_API_KEY` secret and run `bun install --frozen-lockfile` then `bunx addon-kit deploy`.

## How it works

- The function lists the job's photos and returns the popup page.
- The browser loads the photos and builds the PDFs. Doing this in the browser means iPhone HEIC photos work in Safari and in the ServiceM8 app. Tiles show a small copy of each photo, so a job with a lot of photos doesn't run a phone out of memory; the PDFs get the originals.
- The browser saves the PDFs straight to the job with ServiceM8's short-lived (15 minute) API token. It fetches a new token when needed.
- Photos load five at a time. If the browser isn't allowed to fetch a photo from ServiceM8 with the token, the function gives it the photo's storage link, which it fetches without one. That's quick, if the storage lets the browser.
- If not, photos go through the function instead, and so do the PDFs if the browser can't save them itself. Functions can only pass about 6 MB at a time, so photos come through in 3 MB pieces (or whole, if the photo storage won't send a piece). A PDF has to go in one go, though, so in that case each PDF is kept under about 3.5 MB by shrinking its photos (the finished view says so).

## What we've seen in practice

- **Saving goes straight to ServiceM8.** The logs have no `photos_to_pdf_save` entries, so PDFs are saved from the browser, not through the function (where they would have to be under 3.5 MB).
- **Photos.** The browser isn't allowed to fetch photos from ServiceM8 with the token, so it asks the function for each photo's storage link (`photos_to_pdf_photo_url`) and fetches it from there. If the storage won't let it, photos come through the function instead: `Relayed photo` in the logs, one per photo. If a photo won't load at all, the logs say why: `Photo storage refused a piece` or `Photo download failed`, with the status.
- **Who the PDFs show as in the diary.** They're saved as the staff member. If ServiceM8 refuses that, they're saved as the add-on.
- **Icons.** The Add-on Store icon is uploaded to the store listing in ServiceM8, so `addon.jsonc` has no top-level `iconURL`. The job card button's `iconURL` (in both actions) is `icon.png` from this repo (192 × 192: ServiceM8 needs at least 171 × 171; kept small so it shows quickly), served by jsDelivr, so the repo must stay public. jsDelivr caches it, so a changed icon can take up to 12 hours to show. ServiceM8's own upload links expire after a day, so they can't be used here.
