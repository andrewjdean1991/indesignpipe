/*
 * IDtoAE — InDesign to After Effects
 * by Andrew Dean · https://andrewjdean.com
 *
 * Dockable panel: pick an .indd file and get one comp per page, with every
 * shape and outlined letter as native shape layers.
 *
 * This is the source entry point. The file to install is the single-file
 * build, dist/IDtoAE.jsx (see README.md); `node build.js` regenerates it.
 */

#include "IDtoAE/IDtoAE_AE.jsx"
#include "IDtoAE/IDtoAE_BreakApart.jsx"

(function (thisObj) {

    var SCRIPT_FOLDER = File($.fileName).parent.fsName;
    var SETTINGS = "IDtoAE";
    var LIME = [0.784, 1, 0.18]; // andrewjdean.com accent, #C8FF2E

    function getSetting(key, def) {
        try { if (app.settings.haveSetting(SETTINGS, key)) return app.settings.getSetting(SETTINGS, key); } catch (e) {}
        return def;
    }
    function setSetting(key, val) { try { app.settings.saveSetting(SETTINGS, key, String(val)); } catch (e) {} }

    function buildUI(thisObj) {
        var w = (thisObj instanceof Panel) ? thisObj
              : new Window("palette", "IDtoAE", undefined, { resizeable: true });
        w.orientation = "column";
        w.alignChildren = ["fill", "top"];
        w.spacing = 8;
        w.margins = 10;

        // Header: AD badge, name and version.
        var head = w.add("group");
        head.orientation = "row";
        head.alignChildren = ["left", "center"];
        head.spacing = 10;
        var badge = head.add("group");
        badge.preferredSize = [34, 34];
        badge.onDraw = function () {
            var g = this.graphics, sz = this.size;
            g.newPath();
            g.rectPath(0, 0, sz.width, sz.height);
            g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, [0.067, 0.067, 0.067, 1]));
            var f = ScriptUI.newFont("Arial", "BOLD", 15);
            var pen = g.newPen(g.PenType.SOLID_COLOR, LIME.concat([1]), 1);
            var m = g.measureString("AD", f);
            g.drawString("AD", pen, (sz.width - m[0]) / 2, (sz.height - m[1]) / 2, f);
        };
        var titles = head.add("group");
        titles.orientation = "column";
        titles.alignChildren = ["left", "top"];
        titles.spacing = 0;
        var title = titles.add("statictext", undefined, "IDtoAE");
        try { title.graphics.font = ScriptUI.newFont("Arial", "BOLD", 16); } catch (e) {}
        titles.add("statictext", undefined, "InDesign to After Effects  \u00B7  v" + IDtoAE.VERSION);
        var helpBtn = head.add("button", undefined, "Help");
        helpBtn.alignment = ["right", "center"];
        helpBtn.preferredSize = [56, 24];
        helpBtn.helpTip = "Open the IDtoAE guide on GitHub";
        helpBtn.onClick = function () {
            try { IDtoAE.openURL(IDtoAE.HELP_URL); } catch (e) { alert("The guide is at " + IDtoAE.HELP_URL, "IDtoAE"); }
        };

        var fileGrp = w.add("panel", undefined, "InDesign file");
        fileGrp.orientation = "row";
        fileGrp.alignChildren = ["fill", "center"];
        var pathTxt = fileGrp.add("edittext", undefined, getSetting("lastFile", ""));
        pathTxt.preferredSize.width = 220;
        var browseBtn = fileGrp.add("button", undefined, "Choose...");
        browseBtn.alignment = ["right", "center"];

        var optGrp = w.add("panel", undefined, "Comp settings");
        optGrp.orientation = "column";
        optGrp.alignChildren = ["left", "center"];
        function numRow(label, val) {
            var g = optGrp.add("group");
            var l = g.add("statictext", undefined, label);
            l.preferredSize.width = 110;
            var t = g.add("edittext", undefined, val);
            t.characters = 6;
            return t;
        }
        var fpsTxt = numRow("Frame rate (fps)", getSetting("fps", "25"));
        var durTxt = numRow("Duration (sec)", getSetting("duration", "5"));
        var scaleTxt = numRow("Image resolution (x)", getSetting("imageScale", "2"));
        var swatchChk = optGrp.add("checkbox", undefined, "Swatch comp (sRGB)");
        swatchChk.value = getSetting("swatches", "true") == "true";

        var goBtn = w.add("button", undefined, "Build comps");
        var swatchBtn = w.add("button", undefined, "Swatch comp only");
        swatchBtn.helpTip = "Quickly builds just the swatch comp from the InDesign file's Swatches panel.";
        var rebuildBtn = w.add("button", undefined, "Rebuild from previous export...");
        var splitGrp = w.add("panel", undefined, "Break apart");
        splitGrp.orientation = "column";
        splitGrp.alignChildren = ["fill", "top"];
        var orderChk = splitGrp.add("checkbox", undefined, "Reading order (left to right, top to bottom)");
        orderChk.value = getSetting("readingOrder", "true") == "true";
        var colorChk = splitGrp.add("checkbox", undefined, "Label colour per word");
        colorChk.value = getSetting("colorWords", "true") == "true";
        var splitBtn = splitGrp.add("button", undefined, "Break apart selected layers");
        splitBtn.helpTip = "Every shape in the selected layers becomes its own layer, with its anchor point at its centre.";

        var status = w.add("statictext", undefined, "Choose an .indd file, then Build comps.", { multiline: true });
        status.preferredSize.height = 44;

        // Footer: credit with a link to the website.
        var foot = w.add("group");
        foot.orientation = "row";
        foot.alignChildren = ["left", "center"];
        foot.spacing = 4;
        foot.add("statictext", undefined, "Made by " + IDtoAE.AUTHOR + "  \u00B7");
        var link = foot.add("statictext", undefined, "andrewjdean.com");
        link.helpTip = "Open " + IDtoAE.WEBSITE;
        try { link.graphics.foregroundColor = link.graphics.newPen(link.graphics.PenType.SOLID_COLOR, LIME.concat([1]), 1); } catch (e) {}
        link.addEventListener("mousedown", function () {
            try { IDtoAE.openURL(IDtoAE.WEBSITE); } catch (e) { alert("Visit " + IDtoAE.WEBSITE, "IDtoAE"); }
        });

        function setStatus(s) { status.text = s; try { w.update(); } catch (e) {} }

        browseBtn.onClick = function () {
            var start = pathTxt.text ? File(pathTxt.text) : null;
            var f = (start && start.exists ? start : File("~")).openDlg("Choose an InDesign file",
                function (f) { return f instanceof Folder || /\.indd$/i.test(f.name); });
            if (f) pathTxt.text = f.fsName;
        };

        function readOpts() {
            var fps = parseFloat(fpsTxt.text), dur = parseFloat(durTxt.text), sc = parseFloat(scaleTxt.text);
            if (!(fps > 0) || !(dur > 0) || !(sc > 0)) throw new Error("Frame rate, duration and image resolution must be positive numbers.");
            setSetting("fps", fps); setSetting("duration", dur); setSetting("imageScale", sc);
            setSetting("swatches", swatchChk.value);
            return { fps: fps, duration: dur, imageScale: sc, swatches: swatchChk.value };
        }

        function build(manifestPath, opts) {
            var t0 = new Date().getTime();
            var res = IDtoAE.buildFromManifest(manifestPath, {
                fps: opts.fps, duration: opts.duration, swatches: opts.swatches,
                onProgress: function (done, total, label) { setStatus("Building " + label + " (" + (done + 1) + " of " + total + ")..."); }
            });
            var secs = Math.round((new Date().getTime() - t0) / 1000);
            setStatus("Done: " + res.comps.length + " comp" + (res.comps.length == 1 ? "" : "s") + " in " + secs + "s.");
            if (res.warnings.length) {
                var shown = res.warnings.slice(0, 25).join("\n");
                if (res.warnings.length > 25) shown += "\n... and " + (res.warnings.length - 25) + " more (see manifest.json)";
                alert("Built " + res.comps.length + " comps. Some things need a manual check:\n\n" + shown, "IDtoAE");
            }
            if (res.comps.length) res.comps[0].openInViewer();
        }

        goBtn.onClick = function () {
            try {
                var f = File(pathTxt.text);
                if (!pathTxt.text || !f.exists) throw new Error("Choose an InDesign (.indd) file first.");
                setSetting("lastFile", f.fsName);
                var opts = readOpts();
                var manifest = IDtoAE.exportFromInDesign(IDtoAE.enginePath(SCRIPT_FOLDER), f.fsName, opts.imageScale, setStatus);
                build(manifest, opts);
            } catch (e) {
                setStatus("Stopped.");
                alert(String(e.message || e), "IDtoAE");
            }
        };

        swatchBtn.onClick = function () {
            try {
                var f = File(pathTxt.text);
                if (!pathTxt.text || !f.exists) throw new Error("Choose an InDesign (.indd) file first.");
                setSetting("lastFile", f.fsName);
                var opts = readOpts();
                opts.swatches = true;
                var manifest = IDtoAE.exportFromInDesign(IDtoAE.enginePath(SCRIPT_FOLDER), f.fsName, opts.imageScale, setStatus, true);
                build(manifest, opts);
            } catch (e) {
                setStatus("Stopped.");
                alert(String(e.message || e), "IDtoAE");
            }
        };

        rebuildBtn.onClick = function () {
            try {
                var opts = readOpts();
                var m = File.openDialog("Choose a manifest.json (or swatches.json) from an earlier export", function (f) {
                    return f instanceof Folder || f.name == "manifest.json" || f.name == "swatches.json";
                });
                if (m) build(m.fsName, opts);
            } catch (e) {
                setStatus("Stopped.");
                alert(String(e.message || e), "IDtoAE");
            }
        };

        splitBtn.onClick = function () {
            try {
                setSetting("readingOrder", orderChk.value);
                setSetting("colorWords", colorChk.value);
                var res = IDtoAE.breakApartSelected({ readingOrder: orderChk.value, colorWords: colorChk.value });
                setStatus("Split into " + res.layers + " layers" + (colorChk.value ? " (" + res.words + " words)" : "") + "." +
                          (res.unchanged ? " " + res.unchanged + " single-shape layer(s) left as they were." : ""));
                if (res.skipped.length) alert("Some layers were left as they are:\n\n" + res.skipped.join("\n"), "IDtoAE");
            } catch (e) {
                setStatus("Stopped.");
                alert(String(e.message || e), "IDtoAE");
            }
        };

        w.onResizing = w.onResize = function () { this.layout.resize(); };
        if (w instanceof Window) { w.center(); w.show(); } else { w.layout.layout(true); }
        return w;
    }

    // Tests load the panel without showing it.
    if (typeof IDtoAE_NO_UI == "undefined") buildUI(thisObj);

})(this);
