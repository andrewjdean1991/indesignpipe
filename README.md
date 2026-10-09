# IDtoAE: InDesign to After Effects

An After Effects panel that turns an InDesign document into one comp per page,
with every shape and every letter as a native, animatable **shape layer**.

- Live text is outlined automatically, so type arrives as shapes, with each letter's outlines as separate paths
- One layer per top-level InDesign item; InDesign groups become nested shape groups
- Colours are converted with the document's own colour profiles, so they match InDesign's RGB output
- Placed images (JPG, WebP, PDF pages, and so on) come in as cropped transparent PNGs at 2x resolution
- Items on hidden InDesign layers come in switched off
- The original `.indd` is never modified, because the export runs on a temporary copy

## Install

```bash
./install.sh
```

This copies `IDtoAE.jsx` and the `IDtoAE/` folder into your newest After Effects
user `Scripts/ScriptUI Panels` folder. Restart After Effects, then open
**Window > IDtoAE.jsx** and dock the panel wherever you like.

Requirements: After Effects and InDesign 2024 or newer on the same Mac.
**Settings > Scripting & Expressions > Allow Scripts to Write Files and Access Network** must be on in After Effects.

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

You can also run `IDtoAE/IDtoAE_InDesign.jsx` on its own from InDesign's Scripts panel
to produce the export folder.

## What doesn't carry over

The build reports anything it couldn't convert exactly:

- Drop shadows, feathers and other InDesign effects are not recreated
- Gradients use their first colour stop
- Inside- and outside-aligned strokes are drawn centred, and dashed strokes as solid
- Rectangle corner effects (such as rounded corners) come in square
