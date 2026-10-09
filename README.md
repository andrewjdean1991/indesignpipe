# IDtoAE: InDesign to After Effects

`motion vibes` · **by [Andrew Dean](https://andrewjdean.com)**, senior video editor and motion designer

An After Effects panel that turns an InDesign document into one comp per page,
with every shape and every letter as a native, animatable **shape layer**.

- Live text is outlined automatically, so type arrives as shapes, with each letter's outlines as separate paths
- One layer per top-level InDesign item; InDesign groups become nested shape groups
- Colours are converted to **sRGB** through the document's own CMYK profile, so they match InDesign's sRGB output
- A **swatch comp** of the document's named swatches, in sRGB
- **Break apart** splits pages into one layer per letter, in reading order, with a label colour per word
- Placed images (JPG, WebP, PDF pages, and so on) come in as cropped transparent PNGs at 2x resolution
- Items on hidden InDesign layers come in switched off
- The original `.indd` is never modified, because the export runs on a temporary copy

## Requirements

- After Effects and InDesign **2024 or newer**, installed on the same computer
- In After Effects: **Settings > Scripting & Expressions > Allow Scripts to Write Files and Access Network** turned on

## Install on a Mac

The whole panel is one file: `IDtoAE.jsx`. Pick one of the two ways below.

### Option A: download the latest release (no Terminal)

1. On this repository's GitHub page, click **Releases** in the right-hand column and open
   the newest release.
2. Under **Assets**, download `IDtoAE-v….zip`, then double-click it in Downloads to unzip it.
3. Quit After Effects.
4. In Finder choose **Go > Go to Folder…**, paste this and press Return:
   ```
   ~/Library/Preferences/Adobe/After Effects/
   ```
5. Open the folder with the **highest version number** (for example `26.3`), then
   **Scripts > ScriptUI Panels**. If `Scripts` or `ScriptUI Panels` doesn't exist, create it
   with exactly that name.
6. Drag `IDtoAE.jsx` into **ScriptUI Panels**.
7. Open After Effects and turn on **Settings > Scripting & Expressions > Allow Scripts to
   Write Files and Access Network**.
8. Choose **Window > IDtoAE.jsx** and dock the panel wherever you like.

**To update:** download the new release and replace `IDtoAE.jsx` in the same folder.

### Option B: with Terminal and Git (easy updates)

Open **Terminal** (Applications > Utilities) and run these one at a time:

```bash
cd ~/Documents
```

```bash
git clone https://github.com/andrewjdean1991/indesignpipe.git
```

```bash
cd indesignpipe && ./install.sh
```

If macOS offers to install the command line developer tools when you run `git`, accept,
then run the `git clone` line again. If the repository is private, GitHub asks you to sign
in. You need to have been invited as a collaborator.

`install.sh` copies the panel into your newest After Effects version. Restart After Effects,
then open **Window > IDtoAE.jsx**.

**To update:**

```bash
cd ~/Documents/indesignpipe && git pull && ./install.sh
```

### First run

The first time you click **Build comps**, macOS asks whether After Effects may control
InDesign. Click **OK**, because the panel asks InDesign to do the export in the background.

## Install on Windows (untested)

Download the release zip as in Option A, then put `IDtoAE.jsx` in
`%APPDATA%\Adobe\After Effects\<version>\Scripts\ScriptUI Panels` (paste that into the
File Explorer address bar). From a clone of the repository, you can instead right-click
`install-windows.ps1` and choose **Run with PowerShell**.

## Use

1. Click **Choose...** and pick the `.indd` file.
2. Set the frame rate, comp duration and image resolution.
3. Click **Build comps**. InDesign exports in the background (about 1–2 minutes for a
   100-page document) and After Effects builds the comps (a few seconds).

The comps go into a project folder named `<document> (InDesign)` with `Pages`
and `Images` subfolders. Each layer's comment records which InDesign layer it came from.

The export is saved next to the InDesign file as `<document>_AE/`
(`manifest.json` plus `images/`). Keep this folder, because the AE project references the
PNGs in it. **Rebuild from previous export...** builds comps from an existing
`manifest.json` without opening InDesign again.

You can also run `IDtoAE/IDtoAE_InDesign.jsx` from this repository on its own, from
InDesign's Scripts panel, to produce the export folder.

## Swatch comp

**Build comps** also makes a `<document> Swatches` comp (untick **Swatch comp (sRGB)**
to skip it), and **Swatch comp only** builds just that comp in a couple of seconds.
It has one chip per swatch from InDesign's Swatches panel, in panel order, with:

- the swatch name
- its sRGB hex and RGB values
- its original InDesign definition (CMYK, HSB or RGB)

CMYK swatches are converted from the document's CMYK profile (e.g. Coated FOGRA39) to
sRGB IEC61966-2.1, and HSB swatches are converted directly. InDesign's built-in
None/Registration/Paper/Black are left out. Gradient swatches are listed as not included.
The text layers are parented to their chip, so you can move a chip and its labels together.

## Break apart (second stage)

Use this on the pages that need it. Select shape layers in a comp and click
**Break apart selected layers**. Every shape inside them becomes its own shape layer,
however deeply it was nested in groups, and each new layer's anchor point sits
at the centre of its shape. Letters with holes (O, A, 9...) stay as one shape.
Layers that hold a single shape are left as they are. It's a single undo step.

- **Reading order**: layers are ordered left to right and top to bottom, with the first
  letter at the top of the timeline, ready for Sequence Layers or offset animation.
  Shapes that really overlap keep their original front-to-back order.
- **Label colour per word**: words are detected from the letter spacing (a word
  space is much wider than the gap between letters), and each word gets its own label
  colour. Layer names carry the word and position, for example `... w2.05`.

Layers with animated transforms, effects, masks or 3D are skipped and listed.

## What doesn't carry over

The build reports anything it couldn't convert exactly:

- Drop shadows, feathers and other InDesign effects are not recreated
- Gradients use their first colour stop
- Inside- and outside-aligned strokes are drawn centred, and dashed strokes as solid
- Rectangle corner effects (such as rounded corners) come in square

## For developers

The source is split into `IDtoAE.jsx` (panel UI) and `IDtoAE/` (AE builder, break apart,
and the InDesign engine). The installable single file is generated:

```bash
node build.js
```

This writes `dist/IDtoAE.jsx` (panel, AE code and the InDesign engine embedded as a string)
and `dist/IDtoAE-v<version>.zip` with an install guide. Bump `NS.VERSION` in
`IDtoAE/IDtoAE_AE.jsx` for a new release.

---

© 2026 Andrew Dean · [andrewjdean.com](https://andrewjdean.com) · [MIT License](LICENSE)
