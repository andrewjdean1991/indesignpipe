/*
 * IDtoAE — Break apart (After Effects).
 *
 * Splits selected shape layers into one shape layer per shape, however deeply
 * the shapes are nested in groups. Each new layer gets its anchor point at the
 * centre of its own shape. Optionally orders the new layers in reading order
 * (left to right, top to bottom) and gives each detected word its own label
 * colour.
 */

var IDtoAE = IDtoAE || {};

(function (NS) {

    // AE label colours ordered so neighbouring words contrast:
    // red, blue, yellow, green, fuchsia, cyan, orange, purple, aqua, pink,
    // dark green, brown, lavender, peach, sea foam, sandstone
    var WORD_LABELS = [1, 8, 2, 9, 13, 14, 11, 10, 3, 4, 16, 12, 5, 6, 7, 15];

    function pad(n, w) { n = String(n); while (n.length < w) n = "0" + n; return n; }

    // ------------------------------------------------------------ 2D affine
    // [a, b, c, d, e, f]: x' = a*x + c*y + e,  y' = b*x + d*y + f

    function mul(m, n) {
        return [
            m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
            m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
            m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
        ];
    }
    var IDENTITY = [1, 0, 0, 1, 0, 0];

    function isAnimated(prop) {
        try { return prop.numKeys > 0 || (prop.canSetExpression && prop.expressionEnabled); } catch (e) { return false; }
    }

    // Matrix for a shape group's Transform: T(position) R(rotation) S(scale) T(-anchor)
    function groupMatrix(tg, problems, where) {
        var ap = tg.property("ADBE Vector Anchor"), pos = tg.property("ADBE Vector Position");
        var sc = tg.property("ADBE Vector Scale"), rot = tg.property("ADBE Vector Rotation");
        var skew = tg.property("ADBE Vector Skew");
        var props = [ap, pos, sc, rot, skew, tg.property("ADBE Vector Group Opacity")];
        for (var i = 0; i < props.length; i++) {
            if (props[i] && isAnimated(props[i])) problems.push(where + " has an animated group transform");
        }
        if (skew && skew.value != 0) problems.push(where + " has a skewed group (skew ignored)");
        var a = ap.value, p = pos.value, s = sc.value, r = rot.value * Math.PI / 180;
        var cos = Math.cos(r), sin = Math.sin(r), sx = s[0] / 100, sy = s[1] / 100;
        var lin = [cos * sx, sin * sx, -sin * sy, cos * sy, 0, 0];
        var m = mul(lin, [1, 0, 0, 1, -a[0], -a[1]]);
        m[4] += p[0]; m[5] += p[1];
        return m;
    }

    function transformShape(shape, m) {
        var v = shape.vertices, ins = shape.inTangents, outs = shape.outTangents;
        var nv = [], ni = [], no = [];
        for (var i = 0; i < v.length; i++) {
            nv.push([m[0] * v[i][0] + m[2] * v[i][1] + m[4], m[1] * v[i][0] + m[3] * v[i][1] + m[5]]);
            ni.push([m[0] * ins[i][0] + m[2] * ins[i][1], m[1] * ins[i][0] + m[3] * ins[i][1]]);
            no.push([m[0] * outs[i][0] + m[2] * outs[i][1], m[1] * outs[i][0] + m[3] * outs[i][1]]);
        }
        var s = new Shape();
        s.vertices = nv; s.inTangents = ni; s.outTangents = no; s.closed = shape.closed;
        return s;
    }

    // --------------------------------------------------------- read shapes

    function readFill(p) {
        return {
            color: p.property("ADBE Vector Fill Color").value,
            opacity: p.property("ADBE Vector Fill Opacity").value,
            rule: p.property("ADBE Vector Fill Rule").value
        };
    }

    function readStroke(p) {
        return {
            color: p.property("ADBE Vector Stroke Color").value,
            opacity: p.property("ADBE Vector Stroke Opacity").value,
            width: p.property("ADBE Vector Stroke Width").value,
            cap: p.property("ADBE Vector Stroke Line Cap").value,
            join: p.property("ADBE Vector Stroke Line Join").value,
            miter: p.property("ADBE Vector Stroke Miter Limit").value
        };
    }

    // Collects every group that directly holds paths as one "shape" (leaf).
    // Leaves come out front-to-back (AE draws the top of the contents list in front).
    function collect(contents, m, opacity, enabled, name, out, problems, parentKey, parentName) {
        var paths = [], fill = null, stroke = null;
        for (var i = 1; i <= contents.numProperties; i++) {
            var p = contents.property(i), mn = p.matchName;
            if (mn == "ADBE Vector Group") {
                var tg = p.property("ADBE Vector Transform Group");
                var m2 = mul(m, groupMatrix(tg, problems, "'" + p.name + "'"));
                var op = opacity * tg.property("ADBE Vector Group Opacity").value / 100;
                collect(p.property("ADBE Vectors Group"), m2, op, enabled && p.enabled, p.name, out, problems,
                        (parentKey || "") + "/" + i, name);
            } else if (mn == "ADBE Vector Shape - Group") {
                var sp = p.property("ADBE Vector Shape");
                if (isAnimated(sp)) problems.push("'" + p.name + "' has an animated path");
                if (p.enabled) paths.push(transformShape(sp.value, m));
            } else if (mn == "ADBE Vector Graphic - Fill") {
                if (!fill && p.enabled) fill = readFill(p);
            } else if (mn == "ADBE Vector Graphic - Stroke") {
                if (!stroke && p.enabled) stroke = readStroke(p);
            } else {
                problems.push("'" + p.name + "' (" + mn.replace("ADBE Vector ", "") + ") can't be split out");
            }
        }
        if (paths.length) {
            var b = [Infinity, Infinity, -Infinity, -Infinity];
            for (var k = 0; k < paths.length; k++) {
                var v = paths[k].vertices;
                for (var j = 0; j < v.length; j++) {
                    if (v[j][0] < b[0]) b[0] = v[j][0]; if (v[j][1] < b[1]) b[1] = v[j][1];
                    if (v[j][0] > b[2]) b[2] = v[j][0]; if (v[j][1] > b[3]) b[3] = v[j][1];
                }
            }
            out.push({ name: name, paths: paths, fill: fill, stroke: stroke, opacity: opacity,
                       enabled: enabled, bounds: b, z: out.length,
                       group: (parentKey || "").replace(/\/\d+$/, ""), groupName: parentName || "" });
        }
    }

    // ------------------------------------------------- reading order & words

    function median(a) {
        if (!a.length) return 0;
        var s = a.slice().sort(function (x, y) { return x - y; });
        return s[Math.floor(s.length / 2)];
    }

    // Groups leaves into lines (by vertical overlap) and words (by horizontal gaps).
    // Sets leaf.rank (reading order) and leaf.word (word number within this layer).
    function readingOrder(leaves, knownWords) {
        var byY = leaves.slice().sort(function (a, b) {
            return (a.bounds[1] + a.bounds[3]) - (b.bounds[1] + b.bounds[3]);
        });
        var lines = [];
        for (var i = 0; i < byY.length; i++) {
            var L = byY[i], h = L.bounds[3] - L.bounds[1], best = null, bestOv = 0;
            for (var j = 0; j < lines.length; j++) {
                var ln = lines[j], lh = ln.bottom - ln.top;
                var ov = Math.min(ln.bottom, L.bounds[3]) - Math.max(ln.top, L.bounds[1]);
                // Mostly overlapping vertically, or a small mark (comma, period)
                // touching the line; take the line it overlaps most.
                var fits = ov > 0.5 * Math.min(h, lh) || (h < 0.5 * lh && ov > 0);
                if (fits && ov > bestOv) { best = ln; bestOv = ov; }
            }
            if (best) {
                best.items.push(L);
                // Small marks don't widen the line band (a comma would drag it down).
                if (h >= 0.5 * (best.bottom - best.top)) {
                    best.top = Math.min(best.top, L.bounds[1]);
                    best.bottom = Math.max(best.bottom, L.bounds[3]);
                }
            } else lines.push({ top: L.bounds[1], bottom: L.bounds[3], items: [L] });
        }
        lines.sort(function (a, b) { return a.top - b.top; });

        var rank = 0, word = 0;
        for (var l = 0; l < lines.length; l++) {
            var items = lines[l].items.sort(function (a, b) { return a.bounds[0] - b.bounds[0]; });
            var heights = [];
            for (var k = 0; k < items.length; k++) heights.push(items[k].bounds[3] - items[k].bounds[1]);
            var mh = median(heights);
            var rightEdge = -Infinity;
            for (var q = 0; q < items.length; q++) {
                // Letter gaps measure 0-3% of the letter height (negative when
                // kerned); word spaces 10% or more.
                if (q == 0 || items[q].bounds[0] - rightEdge > 0.06 * mh) word++;
                rightEdge = Math.max(rightEdge, items[q].bounds[2]);
                items[q].rank = rank++;
                items[q].word = word;
            }
        }
        if (knownWords) {
            // Number the InDesign words in reading order (letters share their word group).
            var sorted = leaves.slice().sort(function (a, b) { return a.rank - b.rank; }), ids = {}, n = 0;
            for (var s = 0; s < sorted.length; s++) {
                var key = sorted[s].group;
                if (!ids.hasOwnProperty(key)) ids[key] = ++n;
                sorted[s].word = ids[key];
            }
        }
    }

    // Whether two shapes really sit on top of each other. Kerned letters' boxes
    // overlap a little (A under the arm of a W), so require the overlap to
    // cover at least half of the smaller shape's box.
    function overlaps(a, b) {
        var w = Math.min(a.bounds[2], b.bounds[2]) - Math.max(a.bounds[0], b.bounds[0]);
        var h = Math.min(a.bounds[3], b.bounds[3]) - Math.max(a.bounds[1], b.bounds[1]);
        if (w <= 0 || h <= 0) return false;
        var areaA = (a.bounds[2] - a.bounds[0]) * (a.bounds[3] - a.bounds[1]);
        var areaB = (b.bounds[2] - b.bounds[0]) * (b.bounds[3] - b.bounds[1]);
        return w * h > 0.5 * Math.min(areaA, areaB);
    }

    // Timeline order (top first) by reading rank, but overlapping shapes keep
    // their original front-to-back order so nothing gets hidden.
    function orderLeaves(leaves, useReading) {
        if (!useReading) return leaves.slice().sort(function (a, b) { return a.z - b.z; });
        var n = leaves.length, above = [], i, j;
        for (i = 0; i < n; i++) {
            above.push(0);
        }
        // above[j] = number of shapes that must sit above leaf j
        for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
            if (i != j && leaves[i].z < leaves[j].z && overlaps(leaves[i], leaves[j])) above[j]++;
        }
        var done = [], out = [];
        for (i = 0; i < n; i++) done.push(false);
        while (out.length < n) {
            var best = -1;
            for (i = 0; i < n; i++) {
                if (!done[i] && above[i] == 0 && (best < 0 || leaves[i].rank < leaves[best].rank)) best = i;
            }
            if (best < 0) { // shouldn't happen (z is a total order), but never loop forever
                for (i = 0; i < n; i++) if (!done[i] && (best < 0 || leaves[i].z < leaves[best].z)) best = i;
            }
            done[best] = true;
            out.push(leaves[best]);
            for (j = 0; j < n; j++) {
                if (!done[j] && leaves[best].z < leaves[j].z && overlaps(leaves[best], leaves[j])) above[j]--;
            }
        }
        return out;
    }

    // ----------------------------------------------------------- write layers

    // Paths, stroke and fill of one shape, added to `sub` (a group's contents).
    function writeShapeContents(sub, leaf) {
        for (var i = 0; i < leaf.paths.length; i++) {
            sub.addProperty("ADBE Vector Shape - Group").property("ADBE Vector Shape").setValue(leaf.paths[i]);
        }
        if (leaf.stroke) {
            var st = sub.addProperty("ADBE Vector Graphic - Stroke");
            st.property("ADBE Vector Stroke Color").setValue(leaf.stroke.color);
            st.property("ADBE Vector Stroke Opacity").setValue(leaf.stroke.opacity);
            st.property("ADBE Vector Stroke Width").setValue(leaf.stroke.width);
            st.property("ADBE Vector Stroke Line Cap").setValue(leaf.stroke.cap);
            st.property("ADBE Vector Stroke Line Join").setValue(leaf.stroke.join);
            st.property("ADBE Vector Stroke Miter Limit").setValue(leaf.stroke.miter);
        }
        if (leaf.fill) {
            var f = sub.addProperty("ADBE Vector Graphic - Fill");
            f.property("ADBE Vector Fill Color").setValue(leaf.fill.color);
            f.property("ADBE Vector Fill Opacity").setValue(leaf.fill.opacity);
            f.property("ADBE Vector Fill Rule").setValue(leaf.fill.rule);
        }
    }

    function addLeafLayer(comp, src, leaf, name) {
        var layer = comp.layers.addShape();
        layer.name = name;
        var root = layer.property("ADBE Root Vectors Group");
        var g = root.addProperty("ADBE Vector Group");
        g.name = leaf.name;
        writeShapeContents(g.property("ADBE Vectors Group"), leaf);
        if (leaf.opacity != 100) {
            root.property(1).property("ADBE Vector Transform Group")
                .property("ADBE Vector Group Opacity").setValue(leaf.opacity);
        }

        // Same placement as the source layer...
        var st2 = src.transform, nt = layer.transform;
        if (src.parent) layer.parent = src.parent;
        nt.anchorPoint.setValue(st2.anchorPoint.value);
        nt.position.setValue(st2.position.value);
        nt.scale.setValue(st2.scale.value);
        nt.rotation.setValue(st2.rotation.value);
        nt.opacity.setValue(st2.opacity.value);
        layer.blendingMode = src.blendingMode;
        layer.startTime = src.startTime;
        layer.inPoint = src.inPoint;
        layer.outPoint = src.outPoint;
        layer.comment = src.comment;
        layer.label = src.label;
        layer.enabled = src.enabled && leaf.enabled;

        // ...then move the anchor to the centre of this shape without moving it.
        var r = layer.sourceRectAtTime(0, false);
        var ax = r.left + r.width / 2, ay = r.top + r.height / 2;
        var a0 = st2.anchorPoint.value, p0 = st2.position.value, s = st2.scale.value;
        var rot = st2.rotation.value * Math.PI / 180, cos = Math.cos(rot), sin = Math.sin(rot);
        var dx = (ax - a0[0]) * s[0] / 100, dy = (ay - a0[1]) * s[1] / 100;
        nt.anchorPoint.setValue([ax, ay]);
        nt.position.setValue([p0[0] + cos * dx - sin * dy, p0[1] + sin * dx + cos * dy]);
        return layer;
    }

    function cannotSplit(layer) {
        if (!(layer instanceof ShapeLayer)) return "not a shape layer";
        if (layer.threeDLayer) return "3D layers aren't supported";
        var t = layer.transform;
        if (t.position.dimensionsSeparated) return "position has separate dimensions";
        var props = [t.anchorPoint, t.position, t.scale, t.rotation, t.opacity];
        for (var i = 0; i < props.length; i++) if (isAnimated(props[i])) return "its transform is animated";
        if (layer.property("ADBE Effect Parade").numProperties) return "it has effects";
        if (layer.property("ADBE Mask Parade").numProperties) return "it has masks";
        return null;
    }

    /**
     * Break apart the selected shape layers in the active comp.
     * @param {Object} opts { readingOrder: bool, colorWords: bool }
     * @returns {Object} { layers: number of new layers, words, unchanged: single-shape layers left as they were, skipped: [messages] }
     */
    NS.breakApartSelected = function (opts) {
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) throw new Error("Open a comp and select the layers to break apart.");
        if (!comp.selectedLayers.length) throw new Error("Select one or more shape layers to break apart.");
        return NS.breakApart(comp, comp.selectedLayers, opts);
    };

    /** Same as breakApartSelected for an explicit comp and list of layers. */
    NS.breakApart = function (comp, sel, opts) {
        opts = opts || {};
        var layers = [];
        for (var i = 0; i < sel.length; i++) layers.push(sel[i]);
        layers.sort(function (a, b) { return a.index - b.index; });

        var made = 0, wordCount = 0, unchanged = 0, skipped = [], created = [];
        app.beginUndoGroup("IDtoAE: break apart");
        try {
            for (var L = 0; L < layers.length; L++) {
                var src = layers[L];
                var why = cannotSplit(src);
                if (why) { skipped.push("'" + src.name + "': " + why); continue; }

                var leaves = [], problems = [];
                collect(src.property("ADBE Root Vectors Group"), IDENTITY, 100, true, src.name, leaves, problems);
                if (problems.length) { skipped.push("'" + src.name + "': " + problems[0]); continue; }
                if (!leaves.length) { skipped.push("'" + src.name + "': no shapes found"); continue; }
                if (leaves.length == 1) { unchanged++; continue; } // already a single shape

                var knownWords = String(src.comment).indexOf(NS.WORDS_MARK || "IDtoAE: letters grouped by word") >= 0;
                readingOrder(leaves, knownWords);
                var ordered = orderLeaves(leaves, opts.readingOrder !== false);
                var nWords = 0;
                for (var w = 0; w < leaves.length; w++) nWords = Math.max(nWords, leaves[w].word);

                // Created top-first, each placed just above the source layer.
                for (var k = 0; k < ordered.length; k++) {
                    var leaf = ordered[k];
                    var name = knownWords ? pad(k + 1, 2) + " " + leaf.groupName + " - " + leaf.name
                             : src.name + " " + (nWords > 1 ? "w" + leaf.word + "." : "") + pad(k + 1, 2);
                    var nl = addLeafLayer(comp, src, leaf, name);
                    if (opts.colorWords) nl.label = WORD_LABELS[(wordCount + leaf.word - 1) % WORD_LABELS.length];
                    nl.moveBefore(src);
                    created.push(nl);
                    made++;
                }
                wordCount += nWords;
                src.remove();
            }
            for (var c = 0; c < comp.selectedLayers.length; c++) comp.selectedLayers[c].selected = false;
            for (var n = 0; n < created.length; n++) created[n].selected = true;
        } finally {
            app.endUndoGroup();
        }
        return { layers: made, words: wordCount, unchanged: unchanged, skipped: skipped };
    };

    // ------------------------------------------------------------------ merge

    // Layer transform as a matrix: T(position) R(rotation) S(scale) T(-anchor)
    function layerMatrix(L) {
        var t = L.transform, a = t.anchorPoint.value, p = t.position.value, s = t.scale.value;
        var r = t.rotation.value * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
        var m = mul([cos * s[0] / 100, sin * s[0] / 100, -sin * s[1] / 100, cos * s[1] / 100, 0, 0], [1, 0, 0, 1, -a[0], -a[1]]);
        m[4] += p[0]; m[5] += p[1];
        return m;
    }

    function cannotMerge(L) {
        var why = cannotSplit(L);
        if (why) return why;
        if (L.parent) return "it is parented to another layer (unparent it first)";
        return null;
    }

    // Word of a layer: from Break apart names ("06 more - m"), otherwise its label colour.
    function wordOf(L) {
        var m = String(L.name).match(/^\d+ (.+) - (.+)$/);
        return m ? { key: "n:" + m[1], name: m[1], letter: m[2] } : { key: "l:" + L.label, name: "", letter: "" };
    }

    // "LV RED 2 group w2.05" / "03 This - s" -> "LV RED 2 group" / "This"
    function baseName(name) {
        return String(name).replace(/^\d+ /, "").replace(/ w\d+\.\d+$/, "").replace(/ \d\d$/, "").replace(/ - [^-]+$/, "");
    }

    function setGroupTransform(group, L, origin, opacity) {
        var t = L.transform, tg = group.property("ADBE Vector Transform Group");
        var a = t.anchorPoint.value, p = t.position.value, s = t.scale.value;
        tg.property("ADBE Vector Anchor").setValue([a[0], a[1]]);
        tg.property("ADBE Vector Position").setValue([p[0] - origin[0], p[1] - origin[1]]);
        tg.property("ADBE Vector Scale").setValue([s[0], s[1]]);
        tg.property("ADBE Vector Rotation").setValue(t.rotation.value);
        if (opacity != 100) tg.property("ADBE Vector Group Opacity").setValue(opacity);
    }

    /**
     * Merge shape layers into one shape layer: one group per layer, each layer's
     * transform moved onto its group so nothing moves.
     * @param {Object} opts { byWord: put the letters of each word in a word group }
     * @returns {Object} { layer, merged, words, skipped: [messages] }
     */
    NS.mergeLayers = function (comp, sel, opts) {
        opts = opts || {};
        var layers = [], skipped = [], i;
        for (i = 0; i < sel.length; i++) layers.push(sel[i]);
        layers.sort(function (a, b) { return a.index - b.index; }); // top (front) first

        var usable = [];
        for (i = 0; i < layers.length; i++) {
            var L = layers[i], why = cannotMerge(L);
            var leaves = [], problems = [];
            if (!why) {
                collect(L.property("ADBE Root Vectors Group"), IDENTITY, 100, true, L.name, leaves, problems);
                if (problems.length) why = problems[0];
                else if (!leaves.length) why = "no shapes found";
            }
            if (why) { skipped.push("'" + L.name + "': " + why); continue; }
            usable.push({ layer: L, leaves: leaves });
        }
        if (usable.length < 2) {
            throw new Error("Select at least two shape layers to merge." + (skipped.length ? "\n\n" + skipped.join("\n") : ""));
        }

        // The merged layer's origin sits at the centre of everything, in comp space.
        var b = [Infinity, Infinity, -Infinity, -Infinity];
        for (i = 0; i < usable.length; i++) {
            var m = layerMatrix(usable[i].layer), ub = [Infinity, Infinity, -Infinity, -Infinity];
            usable[i].bounds = ub;
            for (var k = 0; k < usable[i].leaves.length; k++) {
                var lb = usable[i].leaves[k].bounds, cs = [[lb[0], lb[1]], [lb[2], lb[1]], [lb[0], lb[3]], [lb[2], lb[3]]];
                for (var c = 0; c < 4; c++) {
                    var x = m[0] * cs[c][0] + m[2] * cs[c][1] + m[4], y = m[1] * cs[c][0] + m[3] * cs[c][1] + m[5];
                    if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y;
                    if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
                    if (x < ub[0]) ub[0] = x; if (y < ub[1]) ub[1] = y;
                    if (x > ub[2]) ub[2] = x; if (y > ub[3]) ub[3] = y;
                }
            }
        }
        var origin = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

        var words = 0, wordNames = [], result;
        app.beginUndoGroup("IDtoAE: merge layers");
        try {
            var merged = comp.layers.addShape();
            var root = merged.property("ADBE Root Vectors Group");
            var target = root, lastKey = null, inPt = Infinity, outPt = -Infinity, wordStarts = [];

            for (i = 0; i < usable.length; i++) {
                var src = usable[i].layer, lv = usable[i].leaves;
                inPt = Math.min(inPt, src.inPoint);
                outPt = Math.max(outPt, src.outPoint);

                if (opts.byWord) {
                    var w = wordOf(src);
                    if (w.key != lastKey) {
                        words++;
                        var wg = root.addProperty("ADBE Vector Group");
                        wg.name = w.name || "Word " + words;
                        wordNames.push(w.name);
                        wordStarts.push(i);
                        target = root.property(root.numProperties).property("ADBE Vectors Group");
                        lastKey = w.key;
                    }
                }

                var lg = target.addProperty("ADBE Vector Group");
                var wl = wordOf(src);
                lg.name = (opts.byWord && wl.letter) ? wl.letter : src.name;
                var opacity = src.transform.opacity.value;
                if (lv.length == 1) {
                    // A single shape goes straight into the layer's group (keeps letters one level deep).
                    writeShapeContents(target.property(target.numProperties).property("ADBE Vectors Group"), lv[0]);
                    opacity = opacity * lv[0].opacity / 100;
                } else {
                    var lc = target.property(target.numProperties).property("ADBE Vectors Group");
                    for (var j = 0; j < lv.length; j++) {
                        var g = lc.addProperty("ADBE Vector Group");
                        g.name = lv[j].name;
                        writeShapeContents(lc.property(lc.numProperties).property("ADBE Vectors Group"), lv[j]);
                        var gj = lc.property(lc.numProperties);
                        if (lv[j].opacity != 100) gj.property("ADBE Vector Transform Group").property("ADBE Vector Group Opacity").setValue(lv[j].opacity);
                        if (!lv[j].enabled) gj.enabled = false;
                    }
                }
                var lgRef = target.property(target.numProperties);
                setGroupTransform(lgRef, src, origin, opacity);
                if (!src.enabled || (lv.length == 1 && !lv[0].enabled)) lgRef.enabled = false;
                if (src.blendingMode != BlendingMode.NORMAL) skipped.push("'" + src.name + "': blend mode not kept");
            }

            // Each word group pivots around the centre of its word.
            for (var wi = 0; wi < wordStarts.length; wi++) {
                var end = wi + 1 < wordStarts.length ? wordStarts[wi + 1] : usable.length;
                var wb = [Infinity, Infinity, -Infinity, -Infinity];
                for (var u = wordStarts[wi]; u < end; u++) {
                    var ubx = usable[u].bounds;
                    wb = [Math.min(wb[0], ubx[0]), Math.min(wb[1], ubx[1]), Math.max(wb[2], ubx[2]), Math.max(wb[3], ubx[3])];
                }
                var wc = [(wb[0] + wb[2]) / 2 - origin[0], (wb[1] + wb[3]) / 2 - origin[1]];
                var wtg = root.property(wi + 1).property("ADBE Vector Transform Group");
                wtg.property("ADBE Vector Anchor").setValue(wc);
                wtg.property("ADBE Vector Position").setValue(wc);
            }

            var top = usable[0].layer;
            var named = true;
            for (i = 0; i < wordNames.length; i++) if (!wordNames[i]) named = false;
            merged.name = (opts.byWord && named && wordNames.length) ? wordNames.join(" ") : baseName(top.name) + " (merged)";
            merged.transform.anchorPoint.setValue([0, 0]);
            merged.transform.position.setValue(origin);
            merged.inPoint = inPt;
            merged.outPoint = outPt;
            merged.label = top.label;
            if (opts.byWord && NS.WORDS_MARK) merged.comment = NS.WORDS_MARK;
            merged.moveBefore(top);

            for (i = 0; i < usable.length; i++) {
                usable[i].layer.remove();
            }
            for (i = 0; i < comp.selectedLayers.length; i++) comp.selectedLayers[i].selected = false;
            merged.selected = true;
            result = { layer: merged, merged: usable.length, words: words, skipped: skipped };
        } finally {
            app.endUndoGroup();
        }
        return result;
    };

    NS.mergeSelected = function (opts) {
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) throw new Error("Open a comp and select the layers to merge.");
        return NS.mergeLayers(comp, comp.selectedLayers, opts);
    };

    // Exposed for tests.
    NS._breakApartInternals = { collect: collect, readingOrder: readingOrder, orderLeaves: orderLeaves, IDENTITY: IDENTITY };

})(IDtoAE);
