# IDtoAE: InDesign to After Effects

`AE Bro` · **by [Andrew Dean](https://andrewjdean.com)**, senior video editor and motion designer

An After Effects panel that turns an InDesign document into one comp per page,
with every shape and every letter as a native, animatable **shape layer**.

- **Live text stays editable**: InDesign text frames become After Effects text layers with the same fonts, sizes, colours, tracking and line breaks. Alternatively, convert text to shapes, with one shape per letter, grouped and named by word
- One layer per top-level InDesign item; InDesign groups become nested shape groups
- Colours are converted to **sRGB** through the document's own CMYK profile, so they match InDesign's sRGB output
- A **swatch comp** of the document's named swatches, in sRGB
- **Pages** field: build only the pages you need, for example the 4 a client just updated
- **Export SVG**: one SVG per page for Illustrator or Blender, with every letter and shape as its own named path
- **Break apart** splits pages into one layer per letter, in reading order, with a label colour per word, and **Merge** puts them back into one layer with a group per letter or word
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

1. Click **Choose...** and pick the `.indd` file. Leave **Pages** on `All`, or list the pages
   you want, for example `1-4, 9` (page numbers are positions in the document).
2. Set the frame rate, comp duration and image resolution, and choose what happens to
   live text (see below).
3. Click **Build comps**. InDesign exports in the background (about 1–2 minutes for a
   100-page document) and After Effects builds the comps (a few seconds).

The comps go into a project folder named `<document> (InDesign)` with `Pages`
and `Images` subfolders. Each layer's comment records which InDesign layer it came from.

The export is saved next to the InDesign file as `<document>_AE/`
(`manifest.json` plus `images/`). Keep this folder, because the AE project references the
PNGs in it. **Rebuild...** builds comps from an existing
`manifest.json` without opening InDesign again.

You can also run `IDtoAE/IDtoAE_InDesign.jsx` from this repository on its own, from
InDesign's Scripts panel, to produce the export folder.

## Building only some pages

Put the pages in the **Pages** field, for example `3-6` or `1, 4, 10-12`, and click
**Build comps**. Only those pages are exported from InDesign, which is quicker, and their comps go
into a new folder named after them, for example `FORMAT_MANIFESTO_LAYOUTS (InDesign) p3-6`.
Comps you've already animated are never touched. Swap the new comps in where you need them.

The export folder stays complete: the updated pages replace their old versions in
`manifest.json` and `images/`, and the other pages are kept, so **Rebuild...** still has the whole document. Rebuild also follows the Pages field.

## Export SVG (Illustrator, Blender)

**Export SVG...** saves one SVG per page (following the Pages field) into
`<document>_SVG/` next to the InDesign file, for example `FORMAT_MANIFESTO_LAYOUTS_page-004.svg`.

- Text is always outlined (Blender ignores live text). Letters are separate paths grouped by
  word, and letters with holes are compound paths.
- Every item is named: Illustrator shows the names in the Layers panel, and Blender names its
  curve objects after them (`more_e`, `LV_PINK_rectangle`, and so on).
- Colours are sRGB hex. Blender converts them to its linear colour space on import.
- Placed images are linked PNGs in `images/`, so keep that folder next to the SVGs. Illustrator
  shows them; Blender's SVG import skips images.
- Pages are 1 px per point, the same size as the comps.

In **Blender**: File > Import > Scalable Vector Graphics (.svg). Each shape becomes a curve
object; select them and use Object > Convert > Mesh or add Extrude for 3D.

## Text: keep editable or convert to shapes

**Keep editable** (default): each live InDesign text frame becomes one AE text layer,
with the same text, line breaks, fonts, sizes, colours, tracking, leading, caps,
horizontal and vertical scale, baseline shift, kerning mode and ligatures, placed on
InDesign's own baselines. Mixed styles within a frame are kept. Each animator needs the
fonts installed; the panel lists any that are missing, and After Effects substitutes them.

Some frames can't be reproduced as an AE text layer, so they're converted to shapes
automatically, with a note: rotated or skewed frames, multi-column frames, vertical text,
and frames with tables or inline graphics. Justified text is set flush, and
underline/strikethrough are dropped.

**Convert to shapes**: text is outlined, and each frame becomes word groups of letter
shapes named after the letters (`This` > `Th`, `i`, `s`; ligatures such as "Th" stay one
shape). **Break apart** then uses these real words for its order and label colours.

Text that was already outlined in InDesign has no word information, so Break apart detects
words from the letter spacing instead.

## Swatch comp

**Build comps** also makes a `<document> Swatches` comp (untick **Swatch comp (sRGB)**
to skip it), and **Swatches only** builds just that comp in a couple of seconds.
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
**Break apart** (in the **Layers** section). Every shape inside them becomes its own shape layer,
however deeply it was nested in groups, and each new layer's anchor point sits
at the centre of its shape. Letters with holes (O, A, 9...) stay as one shape.
Layers that hold a single shape are left as they are. It's a single undo step.

- **Reading order**: layers are ordered left to right and top to bottom, with the first
  letter at the top of the timeline, ready for Sequence Layers or offset animation.
  Shapes that really overlap keep their original front-to-back order.
- **Label colour per word**: each word gets its own label colour. Text converted to shapes
  by the panel uses InDesign's real words, with layers named like `06 more - m`. Text that
  was already outlined in InDesign gets its words from the letter spacing (a word space is
  much wider than the gap between letters), with layers named like `... w2.05`.

Layers with animated transforms, effects, masks or 3D are skipped and listed.

## Merge (back into one layer)

Select shape layers in a comp and click **Merge** (in the **Layers** section). They become one shape
layer, with one group per original layer in the same front-to-back order. Each layer's anchor
point, position, scale, rotation and opacity move onto its group, so nothing moves on screen,
and every letter still pivots around its own centre. It's a single undo step.

- **Merge: one group per word** (on by default) puts each word's letters in a word group that
  pivots around the word's centre, so you can animate per word or per letter on a single layer.
  Words come from the Break apart names (`06 more - m`), or else from runs of the same label colour.
  With known words, the merged layer is named after the text (`This is more text`).
- A merged layer can be broken apart again, and keeps its words.
- Layers that can't merge without moving are left out and listed: animated transforms,
  parented layers, effects, masks, 3D and non-shape layers. Layer blend modes aren't kept.

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
