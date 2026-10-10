# Photos to PDF

A ServiceM8 add-on hosted by ServiceM8 (a "Simple Function" add-on). There's no server to run: upload these files to ServiceM8 and it runs them.

It adds a **Photos to PDF** button to the job card, on the web and in the app. Tap it, pick photos from the job diary, and they're saved back to the job diary as one PDF. The PDF is saved as the staff member who made it.

Each page is just the photo, filling the page. The page is shaped to fit the photo, and there is no text or anything else.

Once it's saved, the popup opens the PDF: just its pages, with **Make another**, **Download** and **Done** at the bottom. If any photos couldn't be read, a note above the buttons says which were left out.

**Download** saves the same PDF to the computer or phone. ServiceM8's popup on the web is sandboxed and may block downloads, so a note under the buttons says to open the PDF from the job diary instead if nothing happens. In the phone app, ServiceM8 always opens add-on buttons in a browser window, and the manifest can't change that; it's a normal browser there, so downloading usually works.

**Picking photos:**
- Tap or click a photo to select it, and again to unselect it.
- **Select all** / **Clear** at the top, or Ctrl+A (Cmd+A on a Mac) to select all.
- Shift-click a photo to select everything from the last one you clicked (or clear it, if that one was unselected).
- With a mouse, drag a box around photos to select them all, like in File Explorer. You can start anywhere, including the empty space around the photos. If you start on a selected photo, the box unselects instead. Hold near the top or bottom edge to scroll while dragging.
- On phones, swipe sideways across photos to select a run of them. Swiping up and down still scrolls.

**Page order:** each selected photo shows its page number. New selections go on the end. **Change order** (next to the save button) shows just the selected photos: press and hold (or click and hold) one, then drag it to a new spot, and the others move out of the way. Holding near the top or bottom edge scrolls. **Make another** goes back to the picker with the same photos in the same order.

**Adding photos from the device:** the **+ Add photos** tile at the end of the grid opens the photo library, camera or file chooser. On a computer you can also drop image files onto the page. Added photos go at the end of the grid, already selected. Each one is also added to the job diary as you, and its tile shows the progress ("Adding to diary…", "Added to diary" or "Not added to diary"). The originals go to the diary at full size. If the popup has to send them through ServiceM8's add-on function, large ones are first saved as a full-resolution JPEG of up to about 3.5 MB. Saving the PDF waits for these uploads and retries any that failed. If any still fail, the finished view lists them; they are in the PDF regardless. The PDF size limit covers all photos, including these.

**PDF size:** choose **Up to 10 MB** (the default), **Up to 5 MB** or **Up to 2 MB**. Photos are shrunk just enough to fit, so the more photos, the smaller each one gets. Pick a smaller size if a portal has a lower upload limit.

## Files

| File | What it is |
| --- | --- |
| `manifest.json` | The add-on manifest. It adds the **Photos to PDF** job card button on the web and in the app, and sets the permissions it needs. |
| `index.js` | The function code: Node.js 24 in one file, with no dependencies. |
| `package.json` | Only for running the tests locally; ServiceM8 doesn't use it. |
| `test/` | Tests for the function's server side (no ServiceM8 account needed). |

## Development

Needs Node.js 24 or later. There are no dependencies to install.

```sh
npm test
```

The tests mock the ServiceM8 API. They also check that the popup's browser code parses, since it's sent to the page with `toString()` and a syntax error would otherwise only show up in the popup. GitHub Actions runs them on every push.

## Upload to ServiceM8

1. In ServiceM8 Online, go to **Account → Developer → Store Items** and add a new add-on.
2. Set its type to **Simple Function**.
3. Upload `manifest.json`.
4. Click **Edit Function** and replace the code with the whole of `index.js`.
5. Activate the add-on on your account and accept its permissions: reading jobs, and reading and adding attachments.
6. Open a job and tap **Photos to PDF**: in the job card's add-ons on the web, and in the job's actions in the app.

When you change the add-on, bump `version` in `manifest.json` and re-upload whichever files changed.

You can also deploy from a terminal with ServiceM8's [Addon Kit](https://developer.servicem8.com/docs/addon-kit). Run `npx @servicem8/addon-kit@latest init` in this folder and it turns `manifest.json` into `addon.jsonc`. Then log in with the scopes from `manifest.json`, run `npx addon-kit deploy`, and use `npx addon-kit tail` for live logs.

## How it works

- The function lists the job's photos and returns the popup page.
- The browser loads the photos, shrinks them and builds the PDF. Doing this in the browser means iPhone HEIC photos work in Safari and in the ServiceM8 app.
- The browser saves the PDF straight to the job with ServiceM8's short-lived (15 minute) API token. It fetches a new token when needed.
- If the browser isn't allowed to call the ServiceM8 API directly, photos and the PDF go through the function instead. Functions can only pass about 6 MB at a time, so in that case the PDF is kept under about 3.5 MB.

## Things to check on the first real run

- **Who the PDF shows as in the diary.** It asks to save as the staff member. If ServiceM8 refuses that, it saves as the add-on.
- **Whether the browser talks to the API directly.** In the add-on's logs, `photos_to_pdf_photo` / `photos_to_pdf_save` entries mean it's going through the function. That works, but the PDF is then capped at about 3.5 MB.
- **Icon.** `iconURL` is still ServiceM8's sample icon. Swap in your own, publicly hosted at 256×256 or larger.
