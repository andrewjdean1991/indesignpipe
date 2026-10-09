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

    function containsImage(node) {
        if (node.type == "image") return true;
        if (node.type == "group") {
            for (var i = 0; i < node.children.length; i++) if (containsImage(node.children[i])) return true;
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

    // Layers are added back-to-front: each new AE layer lands on top.
    function addNode(comp, node, ctx, parentOpacity, parentVisible) {
        var opacity = (node.opacity == null ? 100 : node.opacity) * parentOpacity / 100;
        var visible = parentVisible && node.visible !== false;
        if (node.type == "image") return addImageLayer(comp, node, ctx, opacity, visible);
        if (node.type == "group" && containsImage(node)) {
            // Shape layers can't hold footage, so split this group into separate layers.
            for (var i = 0; i < node.children.length; i++) addNode(comp, node.children[i], ctx, opacity, visible);
            return null;
        }
        return addShapeLayer(comp, node, opacity, visible);
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
     * @param {Number} imageScale
     * @param {Function} [status]  called with progress messages
     */
    NS.exportFromInDesign = function (enginePath, inddPath, imageScale, status) {
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
                  "IDtoAE.exportDocument(" + quote(inddPath) + ", { imageScale: " + Number(imageScale) + " });";
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
     * @param {Object} [opts] { fps, duration, onProgress(done, total, label) }
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
                baseFolder: mf.parent.fsName, imagesFolder: imagesFolder, footage: {},
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
            if (opts.onProgress) opts.onProgress(m.pages.length, m.pages.length, "Done");
            if (!imagesFolder.numItems) imagesFolder.remove();
            return { folder: root, comps: comps, warnings: (m.warnings || []).concat(ctx.warnings) };
        } finally {
            app.endUndoGroup();
        }
    };

})(IDtoAE);
