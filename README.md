# Photos to PDF

A ServiceM8 add-on hosted by ServiceM8. There's no server to run: deploy it with ServiceM8's Addon Kit and ServiceM8 runs it.

It adds a **Photos to PDF** button to the job card, on the web and in the app. Tap it and all of the job diary's photos are laid out in PDFs of a set number of photos each (25 unless you change it). Leave out the ones you don't want, move the rest about, and save: the PDFs go back to the job diary as the staff member who made them.

Each page is just the photo, filling the page. The page is shaped to fit the photo, and there is no text or anything else. Photos aren't shrunk: JPEGs go in exactly as they are, and other photos (HEIC, PNG, AVIF…) as full-size, high-quality JPEGs, since PDFs can't hold those formats.

Once they're saved, the popup says which PDFs were saved and to reopen the job to see them (ServiceM8 doesn't refresh an open job card's diary by itself), with anything that didn't work, such as photos that couldn't be read. **Done** closes it.

**The PDFs:** the photos are shown in sections, **PDF 1**, **PDF 2** and so on, each photo with its page number, then **New PDF** and **Left out**. They're named "Job 123 photos (1 of 3).pdf" and so on (just "Job 123 photos.pdf" if there's one), with the job's work order number (its purchase order number) when it has one: "Job 123 WO 4567 photos (1 of 3).pdf".
- Tap or click a photo to leave it out: it moves to **Left out**. Tap it there to put it back, at the end.
- **Leave all out** / **Put all back** at the top. To pick a few photos from a lot, leave them all out, then tap the ones you want back, in the order you want them.
- Drag a photo (press and hold first on a phone) to a new spot in its PDF, into another PDF, into **New PDF** to start another one, or into **Left out**. The others move out of the way. Holding near the top or bottom edge scrolls.

**Photos per PDF:** the number next to the save button, remembered on that device. A PDF with more photos than that is shown in red as over the limit, but that's only a warning: it's saved as it is. Changing the number doesn't move any photos. **Split into PDFs of 25** (shown when the PDFs aren't already split that way) puts the photos into PDFs of that many, keeping their order. Until photos are dragged about, leaving one out or putting one back keeps the PDFs split evenly.

**Adding photos from the device:** **+ Add photos** at the top opens the photo library, camera or file chooser. On a computer you can also drop image files onto the page. Added photos go on the end of the PDFs. Each one is also added to the job diary as you, and its tile shows the progress ("Adding to diary…", "Added to diary" or "Not added to diary"). The originals go to the diary at full size. If the popup has to send them through ServiceM8's add-on function, large ones are first saved as a full-resolution JPEG of up to about 3.5 MB. Saving finishes these uploads first (retrying any that failed), so they reach the job diary before the PDFs. If any still fail, the popup stays open to list them; they are in the PDFs regardless.

## Files

| File | What it is |
| --- | --- |
| `addon.jsonc` | The add-on's config for [Addon Kit](https://www.npmjs.com/package/@servicem8/addon-kit): its slug, its manifest (the **Photos to PDF** job card button on the web and in the app, and the permissions it needs) and the function's entry point. |
| `index.js` | The function code, in one file with no runtime dependencies. ServiceM8 runs it on Node.js 24. |
| `icon.png` | The job card button's icon, linked from `addon.jsonc`. |
| `package.json`, `bun.lock` | Addon Kit (a dev dependency) and the scripts below. |
| `test/` | Tests for the function's server side (no ServiceM8 account needed). |

## Development

Needs [Bun](https://bun.sh) 1.3 or later.

```sh
bun install
bun test        # run the tests
bun run check   # validate addon.jsonc and bundle the function, without deploying
```

The tests mock the ServiceM8 API. They run with Bun, but the function itself runs on Node.js in ServiceM8, so `index.js` only uses what both have. They also check that the popup's browser code parses, since it's sent to the page with `toString()` and a syntax error would otherwise only show up in the popup. GitHub Actions runs the tests and `bun run check` on every push.

## Deploy to ServiceM8

The add-on is deployed with ServiceM8's [Addon Kit](https://developer.servicem8.com/docs/addon-kit).

1. Log in with the scopes the function uses (they're in `addon.jsonc`):
   ```sh
   bun run login    # the scopes are in this script; update it if addon.jsonc's change
   bun run whoami
   ```
2. Deploy. This bundles `index.js`, creates or updates the add-on with the slug `photos-to-pdf`, and activates it on your account straight away:
   ```sh
   bun run deploy
   ```
3. Open a job and tap **Photos to PDF**: in the job card's add-ons on the web, and in the job's actions in the app.

When you change the add-on, bump `version` in `addon.jsonc` and run `bun run deploy` again. Don't change `slug`: a different slug deploys a separate, new add-on.

For live logs, run `bun run tail` (or `bunx addon-kit tail --filter '"ERROR"'` for errors only). It only shows new logs, so start it before using the add-on.

To deploy from CI, store an API key as the `SM8_API_KEY` secret and run `bun install --frozen-lockfile` then `bunx addon-kit deploy`.

## How it works

- The function lists the job's photos and returns the popup page.
- The browser loads the photos, shrinks them and builds the PDF. Doing this in the browser means iPhone HEIC photos work in Safari and in the ServiceM8 app.
- The browser saves the PDF straight to the job with ServiceM8's short-lived (15 minute) API token. It fetches a new token when needed.
- If the browser isn't allowed to call the ServiceM8 API directly, photos and PDFs go through the function instead. Functions can only pass about 6 MB at a time, so photos come through in 3 MB pieces. A PDF has to go in one go, though, so in that case each PDF is kept under about 3.5 MB by shrinking its photos (the finished view says so).

## Things to check on the first real run

- **Who the PDF shows as in the diary.** It asks to save as the staff member. If ServiceM8 refuses that, it saves as the add-on.
- **Whether the browser talks to the API directly.** In the add-on's logs, `photos_to_pdf_photo` / `photos_to_pdf_save` entries mean it's going through the function. Photos work at any size that way, but a PDF saved through the function is capped at about 3.5 MB, so its photos are shrunk.
- **Icons.** The Add-on Store icon is uploaded to the store listing in ServiceM8, so `addon.jsonc` has no top-level `iconURL`. The job card button's `iconURL` (in both actions) is `icon.png` from this repo, served by jsDelivr, so the repo must stay public. jsDelivr caches it, so a changed icon can take up to a day to show. ServiceM8's own upload links expire after a day, so they can't be used here.
