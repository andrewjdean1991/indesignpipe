/*
 * IDtoAE — InDesign to After Effects
 *
 * Dockable panel: pick an .indd file and get one comp per page, with every
 * shape and outlined letter as native shape layers.
 *
 * Install: copy this file AND the IDtoAE folder into
 *   ~/Library/Preferences/Adobe/After Effects/<version>/Scripts/ScriptUI Panels/
 * (or run install.sh), restart After Effects, then open Window > IDtoAE.jsx.
 */

#include "IDtoAE/IDtoAE_AE.jsx"

(function (thisObj) {

    var SCRIPT_FOLDER = File($.fileName).parent.fsName;
    var ENGINE_FILE = SCRIPT_FOLDER + "/IDtoAE/IDtoAE_InDesign.jsx";
    var SETTINGS = "IDtoAE";

    function getSetting(key, def) {
        try { if (app.settings.haveSetting(SETTINGS, key)) return app.settings.getSetting(SETTINGS, key); } catch (e) {}
        return def;
    }
    function setSetting(key, val) { try { app.settings.saveSetting(SETTINGS, key, String(val)); } catch (e) {} }

    function buildUI(thisObj) {
        var w = (thisObj instanceof Panel) ? thisObj
              : new Window("palette", "InDesign to After Effects", undefined, { resizeable: true });
        w.orientation = "column";
        w.alignChildren = ["fill", "top"];
        w.spacing = 8;
        w.margins = 10;

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

        var goBtn = w.add("button", undefined, "Build comps");
        var rebuildBtn = w.add("button", undefined, "Rebuild from previous export...");
        var status = w.add("statictext", undefined, "Choose an .indd file, then Build comps.", { multiline: true });
        status.preferredSize.height = 44;

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
            return { fps: fps, duration: dur, imageScale: sc };
        }

        function build(manifestPath, opts) {
            var t0 = new Date().getTime();
            var res = IDtoAE.buildFromManifest(manifestPath, {
                fps: opts.fps, duration: opts.duration,
                onProgress: function (done, total, label) { setStatus("Building " + label + " (" + (done + 1) + " of " + total + ")..."); }
            });
            var secs = Math.round((new Date().getTime() - t0) / 1000);
            setStatus("Done: " + res.comps.length + " comps in " + secs + "s.");
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
                var manifest = IDtoAE.exportFromInDesign(ENGINE_FILE, f.fsName, opts.imageScale, setStatus);
                build(manifest, opts);
            } catch (e) {
                setStatus("Stopped.");
                alert(String(e.message || e), "IDtoAE");
            }
        };

        rebuildBtn.onClick = function () {
            try {
                var opts = readOpts();
                var m = File.openDialog("Choose a manifest.json from an earlier export", function (f) {
                    return f instanceof Folder || f.name == "manifest.json";
                });
                if (m) build(m.fsName, opts);
            } catch (e) {
                setStatus("Stopped.");
                alert(String(e.message || e), "IDtoAE");
            }
        };

        w.onResizing = w.onResize = function () { this.layout.resize(); };
        if (w instanceof Window) { w.center(); w.show(); } else { w.layout.layout(true); }
        return w;
    }

    buildUI(thisObj);

})(this);
