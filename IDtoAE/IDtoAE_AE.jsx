/*
 * IDtoAE — After Effects side.
 *
 * Reads the manifest.json written by IDtoAE_InDesign.jsx and builds one comp per
 * InDesign page. Vector items become native shape layers (one layer per
 * top-level InDesign item, groups kept as nested shape groups); placed images
 * become footage layers.
 */

var IDtoAE = IDtoAE || {};

(function (NS) {

    NS.VERSION = "1.2.0";
    NS.WORDS_MARK = "IDtoAE: letters grouped by word";
    NS.AUTHOR = "Andrew Dean";
    NS.WEBSITE = "https://andrewjdean.com";
    NS.HELP_URL = "https://github.com/andrewjdean1991/indesignpipe#readme";

    /**
     * Path of the InDesign engine script. The single-file build embeds its source
     * (IDtoAE.ENGINE_SOURCE) and writes it to the user's Application Support
     * folder; the source checkout keeps it next to the panel.
     */
    NS.enginePath = function (scriptFolder) {
        if (NS.ENGINE_SOURCE) {
            var dir = Folder(Folder.userData.fsName + "/IDtoAE");
            if (!dir.exists) dir.create();
            var f = File(dir.fsName + "/IDtoAE_InDesign_" + NS.VERSION + ".jsx");
            f.encoding = "UTF-8";
            if (!f.open("w")) throw new Error("Could not write " + f.fsName);
            f.write(NS.ENGINE_SOURCE);
            f.close();
            return f.fsName;
        }
        return scriptFolder + "/IDtoAE/IDtoAE_InDesign.jsx";
    };

    NS.openURL = function (url) {
        if ($.os.indexOf("Windows") >= 0) system.callSystem('cmd /c start "" "' + url + '"');
        else system.callSystem('open "' + url + '"');
    };

    // ---------------------------------------------------------------- helpers

    function readText(f) {
        f.encoding = "UTF-8";
        if (!f.open("r")) throw new Error("Could not read " + f.fsName);
        var t = f.read();
        f.close();
        return t;
    }

    function parseJSON(text) {
        // AE's built-in JSON.parse takes ~2 minutes on a 2 MB manifest, while eval
        // takes under a second. Regex-validating the whole file is also too slow,
        // so only accept files the InDesign side wrote: a JSON object with no
        // function syntax in it.
        if (!/^\s*\{"version":/.test(text) || /\bfunction\b|=>|\(\s*\)/.test(text)) {
            throw new Error("This is not a manifest.json written by IDtoAE.");
        }
        return eval("(" + text + ")");
    }

    function pad(n, w) { n = String(n); while (n.length < w) n = "0" + n; return n; }

    var BLEND = null;
    function blendMode(name) {
        if (!BLEND) {
            BLEND = {
                NORMAL: BlendingMode.NORMAL, MULTIPLY: BlendingMode.MULTIPLY, SCREEN: BlendingMode.SCREEN,
                OVERLAY: BlendingMode.OVERLAY, SOFT_LIGHT: BlendingMode.SOFT_LIGHT,
                HARD_LIGHT: BlendingMode.HARD_LIGHT, COLOR_DODGE: BlendingMode.COLOR_DODGE,
                COLOR_BURN: BlendingMode.COLOR_BURN, DARKEN: BlendingMode.DARKEN,
                LIGHTEN: BlendingMode.LIGHTEN, DIFFERENCE: BlendingMode.DIFFERENCE,
                EXCLUSION: BlendingMode.EXCLUSION, HUE: BlendingMode.HUE,
                SATURATION: BlendingMode.SATURATION, COLOR: BlendingMode.COLOR,
                LUMINOSITY: BlendingMode.LUMINOSITY
            };
        }
        return BLEND[name] || BlendingMode.NORMAL;
    }

    var CAP = { butt: 1, round: 2, square: 3 };
    var JOIN = { miter: 1, round: 2, bevel: 3 };

    // Images and text need layers of their own; a shape layer can't hold them.
    function needsOwnLayers(node) {
        if (node.type == "image" || node.type == "text") return true;
        if (node.type == "group") {
            for (var i = 0; i < node.children.length; i++) if (needsOwnLayers(node.children[i])) return true;
        }
        return false;
    }

    function hasWords(node) {
        if (node.words) return true;
        if (node.type == "group") {
            for (var i = 0; i < node.children.length; i++) if (hasWords(node.children[i])) return true;
        }
        return false;
    }

    function growBounds(node, b) {
        if (node.type == "group") {
            for (var i = 0; i < node.children.length; i++) growBounds(node.children[i], b);
        } else if (node.type == "shape") {
            for (var p = 0; p < node.paths.length; p++) {
                var pts = node.paths[p].pts;
                for (var k = 0; k < pts.length; k++) {
                    var x = pts[k][0], y = pts[k][1];
                    if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y;
                    if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
                }
            }
        }
        return b;
    }

    function makeShape(path, cx, cy) {
        var v = [], ins = [], outs = [];
        for (var k = 0; k < path.pts.length; k++) {
            var q = path.pts[k]; // [ax, ay, inX, inY, outX, outY] in page coordinates
            v.push([q[0] - cx, q[1] - cy]);
            ins.push([q[2] - q[0], q[3] - q[1]]);
            outs.push([q[4] - q[0], q[5] - q[1]]);
        }
        var s = new Shape();
        s.vertices = v;
        s.inTangents = ins;
        s.outTangents = outs;
        s.closed = path.closed;
        return s;
    }

    // ------------------------------------------------------------ shape layers

    // Adds `node` as a shape group inside `contents`. When `asLayerRoot` is set,
    // the node's opacity/visibility are left for the layer to carry.
    function addToContents(contents, node, cx, cy, asLayerRoot) {
        var g = contents.addProperty("ADBE Vector Group");
        g.name = node.name;
        var sub = g.property("ADBE Vectors Group");

        if (node.type == "group") {
            // AE contents draw top-of-list in front; manifest children are back-to-front.
            for (var i = node.children.length - 1; i >= 0; i--) {
                addToContents(sub, node.children[i], cx, cy, false);
            }
        } else {
            for (var p = 0; p < node.paths.length; p++) {
                var path = sub.addProperty("ADBE Vector Shape - Group");
                path.property("ADBE Vector Shape").setValue(makeShape(node.paths[p], cx, cy));
            }
            if (node.stroke) {
                var st = sub.addProperty("ADBE Vector Graphic - Stroke");
                st.property("ADBE Vector Stroke Color").setValue(node.stroke.color.concat([1]));
                st.property("ADBE Vector Stroke Width").setValue(node.stroke.width);
                st.property("ADBE Vector Stroke Line Cap").setValue(CAP[node.stroke.cap] || 1);
                st.property("ADBE Vector Stroke Line Join").setValue(JOIN[node.stroke.join] || 1);
                st.property("ADBE Vector Stroke Miter Limit").setValue(node.stroke.miter);
            }
            if (node.fill) {
                var fill = sub.addProperty("ADBE Vector Graphic - Fill");
                fill.property("ADBE Vector Fill Color").setValue(node.fill.concat([1]));
                fill.property("ADBE Vector Fill Rule").setValue(1); // non-zero winding, as InDesign
            }
        }

        if (!asLayerRoot) {
            // Adding children can invalidate `g`, so fetch it again.
            var gg = contents.property(contents.numProperties);
            if (node.opacity != null && node.opacity != 100) {
                gg.property("ADBE Vector Transform Group").property("ADBE Vector Group Opacity").setValue(node.opacity);
            }
            if (node.visible === false) gg.enabled = false;
        }
    }

    function finishLayer(layer, node, opacity, visible) {
        if (opacity != 100) layer.opacity.setValue(opacity);
        if (node.blend && node.blend != "NORMAL") layer.blendingMode = blendMode(node.blend);
        if (!visible) layer.enabled = false;
        if (node.idLayer) layer.comment = "InDesign layer: " + node.idLayer;
    }

    function addShapeLayer(comp, node, opacity, visible) {
        var b = growBounds(node, [Infinity, Infinity, -Infinity, -Infinity]);
        if (!isFinite(b[0])) return null;
        var cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;

        var layer = comp.layers.addShape();
        layer.name = node.name;
        var root = layer.property("ADBE Root Vectors Group");
        if (node.type == "group") {
            for (var i = node.children.length - 1; i >= 0; i--) {
                addToContents(root, node.children[i], cx, cy, false);
            }
        } else {
            addToContents(root, node, cx, cy, true);
        }
        // Pivot at the item's centre so scale/rotation behave as expected.
        layer.transform.anchorPoint.setValue([0, 0]);
        layer.transform.position.setValue([cx, cy]);
        finishLayer(layer, node, opacity, visible);
        // Lets Break apart use the real words instead of guessing from spacing.
        if (hasWords(node)) layer.comment = (layer.comment ? layer.comment + "\n" : "") + NS.WORDS_MARK;
        return layer;
    }

    function addImageLayer(comp, node, ctx, opacity, visible) {
        var footage = ctx.footage[node.file];
        if (!footage) {
            var f = File(ctx.baseFolder + "/" + node.file);
            if (!f.exists) { ctx.warn("Missing image " + node.file); return null; }
            footage = app.project.importFile(new ImportOptions(f));
            footage.parentFolder = ctx.imagesFolder;
            if (node.source) footage.comment = "InDesign link: " + node.source;
            ctx.footage[node.file] = footage;
        }
        var layer = comp.layers.add(footage);
        layer.name = node.name || footage.name;
        var bx = node.bounds[0], by = node.bounds[1], bw = node.bounds[2], bh = node.bounds[3];
        layer.transform.position.setValue([bx + bw / 2, by + bh / 2]);
        layer.transform.scale.setValue([bw / footage.width * 100, bh / footage.height * 100]);
        finishLayer(layer, node, opacity, visible);
        return layer;
    }

    // ------------------------------------------------------------ text layers

    var KERN = null;
    function fontInstalled(ps, ctx) {
        if (ctx.fontCache.hasOwnProperty(ps)) return ctx.fontCache[ps];
        var ok = true;
        try { ok = app.fonts.getFontsByPostScriptName(ps).length > 0; } catch (e) {}
        ctx.fontCache[ps] = ok;
        return ok;
    }

    function styleRange(r, run) {
        r.font = run.font;
        r.fontSize = run.size;
        r.applyFill = !!run.fill;
        if (run.fill) r.fillColor = run.fill;
        if (run.stroke && run.stroke.color) {
            r.applyStroke = true;
            r.strokeColor = run.stroke.color;
            r.strokeWidth = run.stroke.width;
        } else r.applyStroke = false;
        r.tracking = run.tracking;
        // allCaps/smallCaps are read-only; caps are set through fontCapsOption.
        try {
            r.fontCapsOption = run.caps == "all" ? FontCapsOption.FONT_ALL_CAPS
                             : (run.caps == "small" ? FontCapsOption.FONT_SMALL_CAPS : FontCapsOption.FONT_NORMAL_CAPS);
        } catch (e) {}
        r.horizontalScale = run.hscale / 100;
        r.verticalScale = run.vscale / 100;
        r.baselineShift = run.baselineShift;
        try { r.autoKernType = KERN[run.kerning]; } catch (e) {}
        try { r.ligature = run.ligatures !== false; } catch (e) {}
    }

    // One point-text layer per InDesign text frame: same text, line breaks,
    // style runs and baselines.
    function addTextLayer(comp, node, ctx, opacity, visible) {
        if (!KERN) KERN = { metrics: AutoKernType.METRIC_KERN, optical: AutoKernType.OPTICAL_KERN, none: AutoKernType.NO_AUTO_KERN };
        var layer = comp.layers.addText(node.text);
        layer.name = node.name;
        var src = layer.property("ADBE Text Properties").property("ADBE Text Document");
        var td = src.value;
        td.resetCharStyle();
        td.resetParagraphStyle();
        td.justification = node.justification == "center" ? ParagraphJustification.CENTER_JUSTIFY
                         : (node.justification == "right" ? ParagraphJustification.RIGHT_JUSTIFY : ParagraphJustification.LEFT_JUSTIFY);
        if (node.runs.length) styleRange(td, node.runs[0]);
        td.autoLeading = false;
        src.setValue(td);

        td = src.value;
        for (var i = 0; i < node.runs.length; i++) {
            var run = node.runs[i];
            styleRange(td.characterRange(run.start, run.start + run.length), run);
            if (!fontInstalled(run.font, ctx)) {
                ctx.warn("Font '" + (run.fontName || run.font) + "' isn't installed: '" + node.name + "' uses a substitute");
            }
        }
        // Leading from the real distance between baselines (in the frame's own scale).
        var vs = node.scale[1] / 100 || 1;
        for (var l = 0; l < node.lines.length; l++) {
            var ln = node.lines[l];
            if (ln.end <= ln.start) continue;
            var gap = l > 0 ? node.lines[l].baseline - node.lines[l - 1].baseline
                            : (node.lines.length > 1 ? node.lines[1].baseline - node.lines[0].baseline : node.runs[0].size * 1.2 * vs);
            td.characterRange(ln.start, ln.end).leading = gap / vs;
        }
        src.setValue(td);

        layer.transform.anchorPoint.setValue([0, 0]);
        layer.transform.position.setValue(node.position);
        if (node.scale[0] != 100 || node.scale[1] != 100) layer.transform.scale.setValue(node.scale);
        finishLayer(layer, node, opacity, visible);
        return layer;
    }

    // Layers are added back-to-front: each new AE layer lands on top.
    function addNode(comp, node, ctx, parentOpacity, parentVisible) {
        var opacity = (node.opacity == null ? 100 : node.opacity) * parentOpacity / 100;
        var visible = parentVisible && node.visible !== false;
        if (node.type == "image") return addImageLayer(comp, node, ctx, opacity, visible);
        if (node.type == "text") return addTextLayer(comp, node, ctx, opacity, visible);
        if (node.type == "group" && needsOwnLayers(node)) {
            // Shape layers can't hold footage or text, so split this group into separate layers.
            for (var i = 0; i < node.children.length; i++) addNode(comp, node.children[i], ctx, opacity, visible);
            return null;
        }
        return addShapeLayer(comp, node, opacity, visible);
    }

    // ----------------------------------------------------------- swatch comp

    function addText(comp, str, font, size, color, x, y) {
        var layer = comp.layers.addText(str);
        var src = layer.property("ADBE Text Properties").property("ADBE Text Document");
        var td = src.value;
        td.resetCharStyle();
        td.font = font;
        td.fontSize = size;
        td.applyFill = true;
        td.fillColor = color;
        td.applyStroke = false;
        td.justification = ParagraphJustification.LEFT_JUSTIFY;
        src.setValue(td);
        layer.transform.position.setValue([x, y]); // text layers sit on their baseline
        return layer;
    }

    function luminance(rgb) {
        function lin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
        return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    }

    /**
     * One square per swatch with its name, sRGB hex and values, and its
     * original InDesign definition. Laid out in Swatches-panel order.
     */
    NS.buildSwatchComp = function (swatches, name, parentFolder, fps, duration) {
        // Chips in 4 columns, Swatches-panel order running down each column:
        // square on the left, name / sRGB / InDesign values on the right.
        var W = 1920, margin = 100, titleH = 80, colGap = 48, rowGap = 26, cols = 4;
        var rows = Math.ceil(swatches.length / cols);
        var colW = (W - 2 * margin - (cols - 1) * colGap) / cols;
        var sq = Math.min(130, Math.floor((1080 - 2 * margin - titleH - (rows - 1) * rowGap) / rows));
        if (sq < 84) sq = 84; // the comp grows taller instead of shrinking the chips
        var H = Math.max(1080, 2 * margin + titleH + rows * sq + (rows - 1) * rowGap);
        H += H % 2;

        var comp = app.project.items.addComp(name, W, H, 1.0, duration, fps);
        if (parentFolder) comp.parentFolder = parentFolder;
        comp.bgColor = [1, 1, 1];
        var paper = comp.layers.addSolid([1, 1, 1], "Background", W, H, 1.0);
        paper.locked = true;

        var ink = [0.1, 0.1, 0.1], grey = [0.42, 0.42, 0.42];
        addText(comp, name.replace(/ Swatches$/, "") + " \u2014 swatches (sRGB)", "Helvetica-Bold", 30, ink, margin, margin + 30);

        for (var i = 0; i < swatches.length; i++) {
            var sw = swatches[i];
            var x = margin + Math.floor(i / rows) * (colW + colGap);
            var y = margin + titleH + (i % rows) * (sq + rowGap);

            var chip = comp.layers.addShape();
            chip.name = sw.name;
            var g = chip.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
            g.name = sw.name;
            var sub = g.property("ADBE Vectors Group");
            sub.addProperty("ADBE Vector Shape - Rect").property("ADBE Vector Rect Size").setValue([sq, sq]);
            // A hairline keeps very light swatches visible on the white page.
            if (luminance(sw.rgb) > 0.85) {
                var st = sub.addProperty("ADBE Vector Graphic - Stroke");
                st.property("ADBE Vector Stroke Color").setValue([0.82, 0.82, 0.82, 1]);
                st.property("ADBE Vector Stroke Width").setValue(1);
            }
            sub.addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(sw.rgb.concat([1]));
            chip.transform.anchorPoint.setValue([0, 0]);
            chip.transform.position.setValue([x + sq / 2, y + sq / 2]);
            chip.comment = sw.hex + " / " + sw.source;

            var rgb255 = [Math.round(sw.rgb[0] * 255), Math.round(sw.rgb[1] * 255), Math.round(sw.rgb[2] * 255)];
            var tx = x + sq + 20;
            var t1 = addText(comp, sw.name, "Helvetica-Bold", 22, ink, tx, y + 24);
            var t2 = addText(comp, sw.hex + "    RGB " + rgb255.join(" "), "Helvetica", 16, grey, tx, y + 52);
            var t3 = addText(comp, sw.source, "Helvetica", 16, grey, tx, y + 76);
            t1.name = sw.name + " - name"; t2.name = sw.name + " - sRGB"; t3.name = sw.name + " - InDesign";
            t1.parent = t2.parent = t3.parent = chip;
        }
        return comp;
    };

    function uniq(list) {
        var seen = {}, out = [];
        for (var i = 0; i < list.length; i++) if (!seen[list[i]]) { seen[list[i]] = 1; out.push(list[i]); }
        return out;
    }

    function uniqueFolderName(base) {
        var names = {};
        for (var i = 1; i <= app.project.numItems; i++) names[app.project.item(i).name] = true;
        if (!names[base]) return base;
        for (var n = 2; ; n++) if (!names[base + " " + n]) return base + " " + n;
    }

    function quote(s) {
        return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    }

    var EXPORT_TIMEOUT = 60 * 60; // seconds

    /**
     * Ask InDesign (over BridgeTalk) to export an .indd. Returns the manifest path.
     * @param {String} enginePath  path to IDtoAE_InDesign.jsx
     * @param {String} inddPath
     * @param {Object} opts  { imageScale, swatchesOnly, liveText }
     * @param {Function} [status]  called with progress messages
     */
    NS.exportFromInDesign = function (enginePath, inddPath, opts, status) {
        status = status || function () {};
        var engine = File(enginePath);
        if (!engine.exists) throw new Error("Missing " + enginePath + "\nReinstall the IDtoAE folder next to IDtoAE.jsx.");
        var spec = BridgeTalk.getSpecifier("indesign");
        if (!spec) throw new Error("InDesign is not installed (BridgeTalk could not find it).");
        if (!BridgeTalk.isRunning(spec)) {
            status("Launching InDesign...");
            BridgeTalk.launch(spec);
            var waited = 0;
            while (!BridgeTalk.isRunning(spec) && waited < 180) { $.sleep(1000); waited++; }
            $.sleep(3000);
        }

        var bt = new BridgeTalk();
        bt.target = spec;
        // InDesign loads the engine from disk: sending its source in the message
        // body mangles regex escapes in transit.
        bt.body = "var IDtoAE_NO_AUTORUN = true;\n$.evalFile(File(" + quote(engine.fsName) + "));\n" +
                  "IDtoAE.exportDocument(" + quote(inddPath) + ", { imageScale: " + Number(opts.imageScale || 2) +
                  ", swatchesOnly: " + (opts.swatchesOnly ? "true" : "false") +
                  ", liveText: " + (opts.liveText ? "true" : "false") + " });";
        var result = null;
        bt.onResult = function (msg) { result = String(msg.body); };
        bt.onError = function (msg) { result = "ERROR|" + msg.body; };

        status("InDesign is exporting... (a large file can take a few minutes)");
        // send(timeout) gives up after ~30s regardless of the value, so wait here instead.
        bt.send();
        var start = new Date().getTime();
        while (result === null && (new Date().getTime() - start) < EXPORT_TIMEOUT * 1000) {
            BridgeTalk.pump();
            $.sleep(250);
        }
        if (result === null) throw new Error("InDesign did not answer in time.");
        var parts = result.split("|");
        if (parts[0] != "OK") throw new Error("InDesign export failed:\n" + parts.slice(1).join("|"));
        return parts[1];
    };

    /**
     * Build comps from an exported manifest.
     * @param {String} manifestPath
     * @param {Object} [opts] { fps, duration, swatches (default true), onProgress(done, total, label) }
     * @returns {Object} { folder, comps, warnings }
     */
    NS.buildFromManifest = function (manifestPath, opts) {
        opts = opts || {};
        var fps = opts.fps || 25, duration = opts.duration || 5;
        var mf = File(manifestPath);
        if (!mf.exists) throw new Error("Manifest not found: " + manifestPath);
        var m = parseJSON(readText(mf));
        if (!m.pages) throw new Error("Not an IDtoAE manifest: " + manifestPath);

        if (!app.project) app.newProject();
        app.beginUndoGroup("IDtoAE: build comps");
        try {
            var root = app.project.items.addFolder(uniqueFolderName(m.document + " (InDesign)"));
            var compsFolder = app.project.items.addFolder("Pages");
            compsFolder.parentFolder = root;
            var imagesFolder = app.project.items.addFolder("Images");
            imagesFolder.parentFolder = root;

            var ctx = {
                baseFolder: mf.parent.fsName, imagesFolder: imagesFolder, footage: {}, fontCache: {},
                warnings: [], warn: function (s) { this.warnings.push(s); }
            };
            var comps = [];
            for (var p = 0; p < m.pages.length; p++) {
                var page = m.pages[p];
                if (opts.pages && !opts.pages[p + 1]) continue;
                if (opts.onProgress) opts.onProgress(p, m.pages.length, "Page " + page.name);
                var name = "Page " + pad(page.name, 3);
                var w = Math.max(4, Math.round(page.width)), h = Math.max(4, Math.round(page.height));
                var comp = app.project.items.addComp(name, w, h, 1.0, duration, fps);
                comp.parentFolder = compsFolder;
                comp.bgColor = [1, 1, 1];
                for (var i = 0; i < page.layers.length; i++) addNode(comp, page.layers[i], ctx, 100, true);
                comps.push(comp);
            }
            if (m.swatches && m.swatches.length && opts.swatches !== false) {
                comps.unshift(NS.buildSwatchComp(m.swatches, m.document + " Swatches", root, fps, duration));
            }
            if (opts.onProgress) opts.onProgress(m.pages.length, m.pages.length, "Done");
            if (!imagesFolder.numItems) imagesFolder.remove();
            if (!compsFolder.numItems) compsFolder.remove();
            return { folder: root, comps: comps, warnings: (m.warnings || []).concat(uniq(ctx.warnings)) };
        } finally {
            app.endUndoGroup();
        }
    };

})(IDtoAE);
