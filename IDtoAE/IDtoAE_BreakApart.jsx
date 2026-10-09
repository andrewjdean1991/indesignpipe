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
    function collect(contents, m, opacity, enabled, name, out, problems) {
        var paths = [], fill = null, stroke = null;
        for (var i = 1; i <= contents.numProperties; i++) {
            var p = contents.property(i), mn = p.matchName;
            if (mn == "ADBE Vector Group") {
                var tg = p.property("ADBE Vector Transform Group");
                var m2 = mul(m, groupMatrix(tg, problems, "'" + p.name + "'"));
                var op = opacity * tg.property("ADBE Vector Group Opacity").value / 100;
                collect(p.property("ADBE Vectors Group"), m2, op, enabled && p.enabled, p.name, out, problems);
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
                       enabled: enabled, bounds: b, z: out.length });
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
    function readingOrder(leaves) {
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

    function addLeafLayer(comp, src, leaf, name) {
        var layer = comp.layers.addShape();
        layer.name = name;
        var root = layer.property("ADBE Root Vectors Group");
        var g = root.addProperty("ADBE Vector Group");
        g.name = leaf.name;
        var sub = g.property("ADBE Vectors Group");
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

                readingOrder(leaves);
                var ordered = orderLeaves(leaves, opts.readingOrder !== false);
                var nWords = 0;
                for (var w = 0; w < leaves.length; w++) nWords = Math.max(nWords, leaves[w].word);

                // Created top-first, each placed just above the source layer.
                for (var k = 0; k < ordered.length; k++) {
                    var leaf = ordered[k];
                    var name = src.name + " " + (nWords > 1 ? "w" + leaf.word + "." : "") + pad(k + 1, 2);
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

    // Exposed for tests.
    NS._breakApartInternals = { collect: collect, readingOrder: readingOrder, orderLeaves: orderLeaves, IDENTITY: IDENTITY };

})(IDtoAE);
