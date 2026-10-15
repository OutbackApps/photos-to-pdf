---
title: Photos to PDF help
---

# Photos to PDF

Photos to PDF turns a job's photos into PDFs and saves them to the job diary. You choose which photos go in, put them in order, and name the PDFs; it does the rest.

It works on the **ServiceM8 web app** (the online dashboard) and in the **ServiceM8 iPhone and iPad app**.

**Contents:** [Getting started](#getting-started) · [Making PDFs](#making-pdfs) · [Simple and Detailed](#simple-and-detailed) · [Choosing and ordering photos](#choosing-and-ordering-photos) · [Naming the PDFs](#naming-the-pdfs) · [Adding photos from your device](#adding-photos-from-your-device) · [Duplicates](#duplicates) · [Saving](#saving) · [Questions and problems](#questions-and-problems) · [Support](#support) · [Privacy policy](privacy)

## Getting started

1. In ServiceM8 on the web, open the **Add-on Store**, find **Photos to PDF** and click **Connect**.
2. ServiceM8 asks you to allow Photos to PDF to read your jobs and their attachments, and to add attachments to jobs. Accept, and it's ready: there's no separate account or password.
3. Optionally, set how the PDFs are named for your whole business: see [Naming the PDFs](#naming-the-pdfs).

Photos to PDF is billed monthly on your ServiceM8 bill. To stop using it, deactivate it in ServiceM8's Add-ons settings.

## Making PDFs

Open a job, then:

- **On the web:** click **Photos to PDF** in the job card's add-ons.
- **In the app:** tap **Photos to PDF** in the job's actions.

A window opens with all the job diary's photos, oldest first, already split into PDFs of up to 50 photos each. If that's what you want, just tap **Save**. Otherwise, leave out the photos you don't want, move the rest into the order you want, and name the PDFs, then save.

Each PDF page is one photo, filling the page and the right way up. Photos are compressed a little to keep the PDFs a sensible size, while keeping enough detail to zoom in on.

## Simple and Detailed

Two views, switched at the top left. The one you used last is remembered on that device.

- **Simple** (to start with) shows all the photos in one list, in page order, then **Left out**. They're saved as PDFs of up to the number per PDF, in that order.
- **Detailed** shows each PDF on its own: **PDF 1**, **PDF 2** and so on, then **New PDF** and **Left out**. Use it to choose exactly which photos go in which PDF.
  - **Photos per PDF** (at the bottom) is up to 50, and remembered on that device. A PDF with more than that is shown in red, as a warning, but it's still saved as it is.
  - **Split into PDFs of…** puts the photos back into evenly sized PDFs, keeping their order.

Switching back to Simple keeps the photos' order, split into even PDFs again.

## Choosing and ordering photos

**Selecting:**

- Click (or tap) a photo to select it. **Ctrl**-click (**Cmd** on a Mac) adds or removes one, **Shift**-click selects every photo from the last one clicked, and dragging a box from a space between photos selects the photos it touches.
- **Ctrl+A** selects every photo. **Esc**, **Clear**, or a click between photos clears the selection.

**Moving:** drag a selected photo and all the selected photos go with it, in their order. Let go on a new spot, another PDF, **New PDF** or **Left out**. On a phone or tablet, press and hold a photo before dragging it. Holding near the top or bottom of the window scrolls.

**Leaving photos out:**

- Select photos and click **Leave out** (or press **Delete**). **Put back** returns them, at the end.
- **Double-click** (or double-tap) a photo to leave just that one out, or put it back.
- **Leave all out** / **Put all back** are at the top. To pick a few photos from a lot, leave them all out, then put back the ones you want, in the order you want them.

Left out photos aren't deleted from the job; they just don't go in the PDFs.

**Enlarge on hover** (top right, with a mouse): tick it, then point at a photo to see it bigger.

## Naming the PDFs

PDFs are named from a **template**: text with job fields in braces, filled in from each job. The default is:

`Job #{job.generated_job_id} Photos[ - PO {job.purchase_order_number}]`

which names a job's PDF "Job #1042 Photos - PO 7781", or "Job #1042 Photos" for a job without a PO number. When there are several PDFs, " (1 of 3)", " (2 of 3)" and so on are added.

**Job fields** are written like `{job.generated_job_id}` (the job number) or `{job.job_address}`, as in ServiceM8's email templates. Any field of the job can be used.

**Optional text:** put **[ ]** around text and a field to leave both out when the field is empty. In the default, `[ - PO {job.purchase_order_number}]` only appears for jobs with a PO number.

**Your business's default:** set it in ServiceM8 under **Settings → Preferences → Add-ons → PDF name**. It's used for every job unless it's changed when saving.

**Changing the name when saving:**

- **Simple:** the box beside **Photos** shows the name in grey. Type in it to name this save's PDFs differently. **Reset** (or clearing the box) goes back to the default.
- **Detailed:** each PDF has its own box. Type in it to give that PDF its own name (nothing's added to it). **Reset** goes back to the default.

What the PDFs will be called is shown beside the box. Help while typing:

- Click in the box to see the job's fields with their values for this job. Choose one to add it, or type **{** and start typing a field's name.
- Fields the job has are green; ones it doesn't are red, and stay as typed.
- If a **[ ]** section is left out on this job, the name beside the box says why.
- The **?** at the end of the box has examples, with what each gives on this job. **Use** puts one in the box.

## Adding photos from your device

**+ Add photos** (top right) opens your photo library, camera or files. On a computer, you can also drop image files onto the window. Added photos go at the end of the PDFs, and each is also added to the job diary, under your name. Each shows its progress ("Adding to diary…", "Added to diary" or "Not added to diary"); saving tries any that failed again.

## Duplicates

A photo that's exactly the same file as one before it in the job is tagged **Duplicate**, for example if the same photo was uploaded twice. Nothing else happens: the photo stays where it is and is saved unless you leave it out. Only exact copies are tagged; a copy that's been resized or edited isn't.

## Saving

**Save** makes each PDF in turn and adds it to the job diary, under your name. Then the window lists the PDFs that were saved.

**Reopen the job to see them in the job diary:** ServiceM8 doesn't refresh an open job card by itself.

If ServiceM8 won't take a PDF because it's too big, that PDF is saved in parts instead ("… part 1.pdf", "… part 2.pdf"), with the photos in order. If saving stops part way, saving again carries on without saving any PDF twice.

## Questions and problems

**The PDFs aren't in the job diary.** Close and reopen the job: ServiceM8 doesn't refresh an open job card's diary by itself.

**A photo says "Couldn't load".** It couldn't be read on this device; the other photos are still saved. Try again, or on another device. Photos that can't be read are listed after saving.

**iPhone photos (HEIC).** These work in Safari and the ServiceM8 app. Some other browsers (such as Chrome or Edge on Windows) can't read them: they show the photo's name instead of a picture, and are listed as couldn't be read when saving. For jobs with HEIC photos, use Safari or the app.

**Which photos are included?** All the photos in the job diary (JPEG, PNG, HEIC, WebP and other image types). Other attachments, such as PDFs, aren't.

**Does it change or delete anything?** No. It only adds the PDFs (and any photos you add from your device) to the job diary.

## Support

Email **[support@outbackapps.com](mailto:support@outbackapps.com)**. Please include the job number and what you saw.

Photos to PDF is developed and supported by Outback Apps, not by ServiceM8. [Privacy policy](privacy)
