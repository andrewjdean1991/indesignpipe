/*
 * IDtoAE — InDesign side.
 *
 * Opens a COPY of an .indd file (the original is never modified), outlines any
 * live text, and writes a manifest.json describing every page item as vector
 * path data (anchor points + bezier handles, fill, stroke, opacity). Placed
 * images are exported as cropped transparent PNGs since they are raster anyway.
 *
 * Normally called from the After Effects panel over BridgeTalk, but it can also
 * be run on its own from InDesign's Scripts panel (it asks for a file).
 *
 * Output:  <indd folder>/<indd name>_AE/manifest.json
 *          <indd folder>/<indd name>_AE/images/*.png
 */

var IDtoAE = IDtoAE || {};

(function (NS) {

    var SRGB = "sRGB IEC61966-2.1";
    var IMAGE_SCALE_DEFAULT = 2; // PNGs are exported at 2x so they hold up when scaled in AE

    // ---------------------------------------------------------------- helpers

    function r3(v) { return Math.round(v * 1000) / 1000; }

    function jsonStr(s) {
        s = String(s);
        var out = '"';
        for (var i = 0; i < s.length; i++) {
            var c = s.charAt(i), code = s.charCodeAt(i);
            if (c == '"') out += '\\"';
            else if (c == '\\') out += '\\\\';
            else if (code < 0x20 || code > 0x7e) {
                var h = code.toString(16);
                while (h.length < 4) h = "0" + h;
                out += "\\u" + h;
            } else out += c;
        }
        return out + '"';
    }

    function toJSON(v) {
        if (v === null || v === undefined) return "null";
        var t = typeof v;
        if (t == "number") return isFinite(v) ? String(v) : "null";
        if (t == "boolean") return v ? "true" : "false";
        if (t == "string") return jsonStr(v);
        if (v instanceof Array) {
            var a = [];
            for (var i = 0; i < v.length; i++) a.push(toJSON(v[i]));
            return "[" + a.join(",") + "]";
        }
        var parts = [];
        for (var k in v) if (v.hasOwnProperty(k)) parts.push(jsonStr(k) + ":" + toJSON(v[k]));
        return "{" + parts.join(",") + "}";
    }

    function pad(n, w) { n = String(n); while (n.length < w) n = "0" + n; return n; }

    function safeName(s) { return String(s).replace(/[^A-Za-z0-9_\-]+/g, "_"); }

    // ----------------------------------------------------------------- colour

    function hsbToRGB(h, s, v) {
        h = ((h % 360) + 360) % 360 / 60;
        var i = Math.floor(h), f = h - i;
        var p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
        switch (i) {
            case 0: return [v, t, p];
            case 1: return [q, v, p];
            case 2: return [p, v, t];
            case 3: return [p, q, v];
            case 4: return [t, p, v];
            default: return [v, p, q];
        }
    }

    // CIE Lab (D50, as InDesign) -> sRGB
    function labToRGB(L, a, b) {
        var fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
        function finv(t) { return t > 6 / 29 ? t * t * t : 3 * (6 / 29) * (6 / 29) * (t - 4 / 29); }
        var X = 0.9642 * finv(fx), Y = finv(fy), Z = 0.8249 * finv(fz);
        // Bradford-adapted D50 XYZ -> linear sRGB
        var r = 3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z;
        var g = -0.9787684 * X + 1.9161415 * Y + 0.0334540 * Z;
        var bl = 0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z;
        function gam(c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
        return [gam(r), gam(g), gam(bl)];
    }

    function colorToRGB(swatch, tint, ctx, where) {
        if (!swatch || !swatch.isValid) return null;
        var kind = swatch.constructor.name;
        if (swatch.name == "None") return null;
        var t = (tint === undefined || tint < 0) ? 100 : tint;

        if (kind == "Tint") {
            var base = swatch.baseColor;
            return colorToRGB(base, swatch.tintValue * t / 100, ctx, where);
        }
        if (kind == "Gradient") {
            ctx.warn(where + ": gradient fill replaced by its first colour stop");
            return colorToRGB(swatch.gradientStops[0].stopColor, t, ctx, where);
        }
        if (kind == "MixedInk") {
            ctx.warn(where + ": mixed ink colour approximated as grey");
            return [0.5, 0.5, 0.5];
        }
        if (kind != "Color") {
            ctx.warn(where + ": unsupported colour type " + kind);
            return [0, 0, 0];
        }

        var key = swatch.id + "_" + t;
        if (ctx.colorCache[key]) return ctx.colorCache[key];

        var rgb, tinted = false;
        var vals = swatch.colorValue, space = swatch.space;
        if (space == ColorSpace.RGB) {
            rgb = [vals[0] / 255, vals[1] / 255, vals[2] / 255];
        } else if (space == ColorSpace.HSB) {
            rgb = hsbToRGB(vals[0], vals[1] / 100, vals[2] / 100);
        } else if (space == ColorSpace.CMYK) {
            // app.colorTransform takes and returns 0-1 values and uses the
            // document's colour management (same result as InDesign's RGB export).
            // A tint scales the inks, as InDesign does.
            var k = t / 100;
            var cmyk = [vals[0] / 100 * k, vals[1] / 100 * k, vals[2] / 100 * k, vals[3] / 100 * k];
            tinted = true;
            try {
                if (cmyk[0] == 0 && cmyk[1] == 0 && cmyk[2] == 0 && cmyk[3] == 1) {
                    // InDesign shows and exports 100% K as rich black (0,0,0).
                    rgb = [0, 0, 0];
                } else {
                    rgb = app.colorTransform(cmyk, ColorSpace.CMYK, ColorSpace.RGB);
                }
            } catch (e) {
                rgb = [(1 - cmyk[0]) * (1 - cmyk[3]), (1 - cmyk[1]) * (1 - cmyk[3]), (1 - cmyk[2]) * (1 - cmyk[3])];
                ctx.warn(where + ": colour '" + swatch.name + "' converted without colour management");
            }
        } else if (space == ColorSpace.LAB) {
            rgb = labToRGB(vals[0], vals[1], vals[2]);
        } else {
            rgb = [0, 0, 0];
            ctx.warn(where + ": could not convert colour '" + swatch.name + "'");
        }
        if (t != 100 && !tinted) {
            for (var i = 0; i < 3; i++) rgb[i] = 1 - (t / 100) * (1 - rgb[i]);
        }
        for (var j = 0; j < 3; j++) rgb[j] = r3(Math.max(0, Math.min(1, rgb[j])));
        ctx.colorCache[key] = rgb;
        return rgb;
    }

    // ------------------------------------------------------------- page items

    var BLEND_NAMES = {};
    function blendName(mode) {
        if (!BLEND_NAMES.init) {
            var list = ["NORMAL", "MULTIPLY", "SCREEN", "OVERLAY", "SOFT_LIGHT", "HARD_LIGHT",
                        "COLOR_DODGE", "COLOR_BURN", "DARKEN", "LIGHTEN", "DIFFERENCE",
                        "EXCLUSION", "HUE", "SATURATION", "COLOR", "LUMINOSITY"];
            for (var i = 0; i < list.length; i++) BLEND_NAMES[BlendMode[list[i]]] = list[i];
            BLEND_NAMES.init = true;
        }
        return BLEND_NAMES[mode] || "NORMAL";
    }

    function commonProps(item, node, ctx, where) {
        node.visible = item.visible;
        node.opacity = 100;
        node.blend = "NORMAL";
        try {
            var ts = item.transparencySettings;
            node.opacity = r3(ts.blendingSettings.opacity);
            node.blend = blendName(ts.blendingSettings.blendMode);
            var fx = [];
            if (ts.dropShadowSettings.mode != ShadowMode.NONE) fx.push("drop shadow");
            if (ts.innerShadowSettings.applied) fx.push("inner shadow");
            if (ts.outerGlowSettings.applied) fx.push("outer glow");
            if (ts.innerGlowSettings.applied) fx.push("inner glow");
            if (ts.bevelAndEmbossSettings.applied) fx.push("bevel/emboss");
            if (ts.satinSettings.applied) fx.push("satin");
            if (ts.featherSettings.mode != FeatherMode.NONE) fx.push("feather");
            if (ts.directionalFeatherSettings.applied) fx.push("directional feather");
            if (ts.gradientFeatherSettings.applied) fx.push("gradient feather");
            if (fx.length) ctx.warn(where + ": effects not converted (" + fx.join(", ") + ")");
        } catch (e) {}
    }

    function hasGraphic(item) {
        try { return item.allGraphics.length > 0; } catch (e) { return false; }
    }

    function labelFor(item, kind) {
        if (item.name) return item.name;
        if (item.label) return item.label;
        var sw = null;
        try {
            if (kind == "Group") {
                var leaves = item.allPageItems;
                for (var i = 0; i < leaves.length; i++) {
                    var f = leaves[i].fillColor;
                    if (f && f.isValid && f.name && f.name != "None") { sw = f.name; break; }
                }
            } else {
                var fc = item.fillColor;
                if (fc && fc.isValid && fc.name && fc.name != "None") sw = fc.name;
            }
        } catch (e) {}
        return (sw ? sw + " " : "") + kind.toLowerCase();
    }

    function pathsOf(item) {
        var out = [];
        var ps = item.paths;
        for (var i = 0; i < ps.length; i++) {
            var p = ps[i];
            var ep = p.entirePath;
            var pts = [];
            for (var k = 0; k < ep.length; k++) {
                var e = ep[k];
                if (typeof e[0] == "number") {
                    pts.push([r3(e[0]), r3(e[1]), r3(e[0]), r3(e[1]), r3(e[0]), r3(e[1])]);
                } else {
                    // [leftDirection, anchor, rightDirection]
                    pts.push([r3(e[1][0]), r3(e[1][1]), r3(e[0][0]), r3(e[0][1]), r3(e[2][0]), r3(e[2][1])]);
                }
            }
            out.push({ closed: p.pathType == PathType.CLOSED_PATH, pts: pts });
        }
        return out;
    }

    var CAPS = {}, JOINS = {};
    function strokeOf(item, ctx, where) {
        var w = item.strokeWeight;
        if (!w || w <= 0) return null;
        var col = colorToRGB(item.strokeColor, item.strokeTint, ctx, where);
        if (!col) return null;
        if (!CAPS.init) {
            CAPS[EndCap.BUTT_END_CAP] = "butt"; CAPS[EndCap.ROUND_END_CAP] = "round";
            CAPS[EndCap.PROJECTING_END_CAP] = "square";
            JOINS[EndJoin.MITER_END_JOIN] = "miter"; JOINS[EndJoin.ROUND_END_JOIN] = "round";
            JOINS[EndJoin.BEVEL_END_JOIN] = "bevel";
            CAPS.init = true;
        }
        var align = "center";
        try {
            if (item.strokeAlignment == StrokeAlignment.INSIDE_ALIGNMENT) align = "inside";
            else if (item.strokeAlignment == StrokeAlignment.OUTSIDE_ALIGNMENT) align = "outside";
        } catch (e) {}
        if (align != "center") ctx.warn(where + ": " + align + "-aligned stroke drawn centred in AE");
        try { if (item.strokeType.name != "Solid") ctx.warn(where + ": stroke style '" + item.strokeType.name + "' drawn as solid"); } catch (e) {}
        return {
            color: col, width: r3(w),
            cap: CAPS[item.endCap] || "butt", join: JOINS[item.endJoin] || "miter",
            miter: r3(item.miterLimit || 4), align: align
        };
    }

    function exportImage(item, ctx, where) {
        var vb = item.visibleBounds; // [top, left, bottom, right]
        var src = "", key = null;
        try {
            var g = item.allGraphics[0];
            src = g.itemLink.name;
            // Identical frames (same image, crop and position) are exported once.
            key = src + "|" + vb.join(",") + "|" + g.geometricBounds.join(",") + "|" + item.rotationAngle;
        } catch (e) {}
        var node = { type: "image", source: src, bounds: [r3(vb[1]), r3(vb[0]), r3(vb[3] - vb[1]), r3(vb[2] - vb[0])] };
        if (key && ctx.imageCache[key]) { node.file = ctx.imageCache[key]; return node; }

        ctx.imageCount++;
        var fname = "p" + pad(ctx.pageNum, 3) + "_" + pad(ctx.imageCount, 3) + ".png";
        var f = File(ctx.imagesFolder.fsName + "/" + fname);
        item.exportFile(ExportFormat.PNG_FORMAT, f, false);
        node.file = "images/" + fname;
        if (key) ctx.imageCache[key] = node.file;
        return node;
    }

    // ------------------------------------------------------------------ text

    var GLYPH_LABEL = "IDtoAE_glyphs:";

    // Whether a text frame can become an After Effects text layer as-is.
    function liveTextProblem(tf) {
        try { if (tf.absoluteRotationAngle != 0 || tf.absoluteShearAngle != 0) return "it is rotated or skewed"; } catch (e) {}
        try { if (tf.textFramePreferences.textColumnCount > 1) return "it has several columns"; } catch (e) {}
        try { if (tf.parentStory.storyPreferences.storyOrientation == StoryHorizontalOrVertical.VERTICAL) return "it is vertical text"; } catch (e) {}
        try { if (tf.tables.length) return "it contains a table"; } catch (e) {}
        try { if (tf.allPageItems.length) return "it contains inline graphics"; } catch (e) {}
        try { if (!tf.lines.length) return "it has no visible text"; } catch (e) {}
        return null;
    }

    function textOf(v) {
        // Special characters come back as enumeration values, not strings.
        if (typeof v == "string") return v;
        if (v == SpecialCharacters.EM_DASH) return "\u2014";
        if (v == SpecialCharacters.EN_DASH) return "\u2013";
        if (v == SpecialCharacters.BULLET_CHARACTER) return "\u2022";
        if (v == SpecialCharacters.SINGLE_LEFT_QUOTE) return "\u2018";
        if (v == SpecialCharacters.SINGLE_RIGHT_QUOTE) return "\u2019";
        if (v == SpecialCharacters.DOUBLE_LEFT_QUOTE) return "\u201C";
        if (v == SpecialCharacters.DOUBLE_RIGHT_QUOTE) return "\u201D";
        if (v == SpecialCharacters.ELLIPSIS_CHARACTER) return "\u2026";
        if (v == SpecialCharacters.COPYRIGHT_SYMBOL) return "\u00A9";
        if (v == SpecialCharacters.REGISTERED_TRADEMARK) return "\u00AE";
        if (v == SpecialCharacters.TRADEMARK_SYMBOL) return "\u2122";
        return " ";
    }

    var JUST = null;
    function justName(j) {
        if (!JUST) {
            JUST = {};
            JUST[Justification.LEFT_ALIGN] = "left"; JUST[Justification.CENTER_ALIGN] = "center";
            JUST[Justification.RIGHT_ALIGN] = "right"; JUST[Justification.LEFT_JUSTIFIED] = "left*";
            JUST[Justification.CENTER_JUSTIFIED] = "center*"; JUST[Justification.RIGHT_JUSTIFIED] = "right*";
            JUST[Justification.FULLY_JUSTIFIED] = "left*";
        }
        return JUST[j] || "left";
    }

    function kernName(k) {
        k = String(k || "");
        if (/optical/i.test(k)) return "optical";
        if (/^none$|^\s*$/i.test(k)) return "none";
        return "metrics";
    }

    // A live text frame as one AE point-text layer: text with explicit line
    // breaks, style runs, and the baseline of every line.
    function textNode(tf, ctx, where) {
        var lines = tf.lines.everyItem().getElements();
        var hs = tf.absoluteHorizontalScale / 100, vs = tf.absoluteVerticalScale / 100;
        var text = "", runs = [], lineInfo = [];
        var just = justName(lines[0].justification);
        if (just.indexOf("*") >= 0) { just = just.replace("*", ""); ctx.warn(where + ": justified text set " + just + "-aligned"); }

        for (var i = 0; i < lines.length; i++) {
            var ln = lines[i];
            if (i) text += "\r";
            var start = text.length;
            var tsrs = ln.textStyleRanges.everyItem().getElements();
            for (var r = 0; r < tsrs.length; r++) {
                var t = tsrs[r];
                var str = textOf(t.contents).replace(/[\r\n\u2028\u0003\u0018\u0019\u001A\u001B]+$/, "");
                if (!str.length) continue;
                var font = "", fontName = "";
                try { font = t.appliedFont.postscriptName; fontName = t.appliedFont.name.replace(/\t/g, " "); }
                catch (e) { font = fontName = String(t.appliedFont); }
                var caps = "normal";
                if (t.capitalization == Capitalization.ALL_CAPS) caps = "all";
                else if (t.capitalization == Capitalization.SMALL_CAPS || t.capitalization == Capitalization.CAP_TO_SMALL_CAP) caps = "small";
                var stroke = null;
                try {
                    if (t.strokeWeight > 0 && t.strokeColor.name != "None") {
                        stroke = { color: colorToRGB(t.strokeColor, t.strokeTint, ctx, where), width: r3(t.strokeWeight) };
                    }
                } catch (e) {}
                try { if (t.underline || t.strikeThru) ctx.warn(where + ": underline/strikethrough isn't available in AE text"); } catch (e) {}
                runs.push({
                    start: text.length, length: str.length,
                    font: font, fontName: fontName, size: r3(t.pointSize),
                    fill: colorToRGB(t.fillColor, t.fillTint, ctx, where), stroke: stroke,
                    tracking: r3(t.tracking), caps: caps,
                    hscale: r3(t.horizontalScale), vscale: r3(t.verticalScale),
                    baselineShift: r3(t.baselineShift), kerning: kernName(t.kerningMethod),
                    ligatures: !!t.ligatures
                });
                text += str;
            }
            var x0 = ln.horizontalOffset, x1 = ln.endHorizontalOffset;
            var anchor = just == "center" ? (x0 + x1) / 2 : (just == "right" ? x1 : x0);
            lineInfo.push({ start: start, end: text.length, baseline: r3(ln.baseline), x: r3(anchor) });
        }
        for (var k = 1; k < lineInfo.length; k++) {
            if (Math.abs(lineInfo[k].x - lineInfo[0].x) > 1) {
                ctx.warn(where + ": lines are indented differently; check line positions");
                break;
            }
        }
        var name = text.replace(/\s+/g, " ").substr(0, 40);
        return {
            type: "text", name: name, text: text, runs: runs, lines: lineInfo,
            justification: just, scale: [r3(hs * 100), r3(vs * 100)],
            position: [lineInfo[0].x, lineInfo[0].baseline]
        };
    }

    // Letter boxes recorded before a frame is outlined, so the outline can be
    // split into one shape per letter afterwards.
    function glyphMap(tf) {
        var out = [], word = 0, inWord = false;
        var lines = tf.lines.everyItem().getElements();
        for (var l = 0; l < lines.length; l++) {
            var chars = lines[l].characters;
            if (!chars.length) continue;
            var c = chars.everyItem();
            var con = c.contents, x0 = c.horizontalOffset, x1 = c.endHorizontalOffset;
            var base = c.baseline, asc = c.ascent, desc = c.descent;
            if (!(con instanceof Array)) { con = [con]; x0 = [x0]; x1 = [x1]; base = [base]; asc = [asc]; desc = [desc]; }
            inWord = false;
            for (var i = 0; i < con.length; i++) {
                var ch = textOf(con[i]);
                if (/^\s*$/.test(ch)) { inWord = false; continue; }
                if (!inWord) { word++; inWord = true; }
                out.push({ ch: ch, w: word, l: l, x0: r3(Math.min(x0[i], x1[i])), x1: r3(Math.max(x0[i], x1[i])),
                           top: r3(base[i] - asc[i]), bottom: r3(base[i] + desc[i]) });
            }
        }
        return out;
    }

    // Splits an outlined text polygon into word groups of letter shapes.
    function splitGlyphs(item, base, glyphs, ctx) {
        var paths = base.paths, byGlyph = [], boxes = [], g, i;
        for (g = 0; g < glyphs.length; g++) byGlyph.push([]);
        for (i = 0; i < paths.length; i++) {
            var pts = paths[i].pts, bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
            for (var k = 0; k < pts.length; k++) {
                bx0 = Math.min(bx0, pts[k][0]); bx1 = Math.max(bx1, pts[k][0]);
                by0 = Math.min(by0, pts[k][1]); by1 = Math.max(by1, pts[k][1]);
            }
            var cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2, best = -1, bestD = Infinity;
            for (g = 0; g < glyphs.length; g++) {
                var G = glyphs[g];
                var dx = cx < G.x0 ? G.x0 - cx : (cx > G.x1 ? cx - G.x1 : 0);
                var dy = cy < G.top ? G.top - cy : (cy > G.bottom ? cy - G.bottom : 0);
                var d = dx + dy * 4; // lines matter more than columns
                if (d < bestD) { bestD = d; best = g; }
            }
            if (best < 0) return null;
            byGlyph[best].push(paths[i]);
            var B = boxes[best];
            if (!B) boxes[best] = [bx0, bx1];
            else { B[0] = Math.min(B[0], bx0); B[1] = Math.max(B[1], bx1); }
        }

        // A ligature (Th, fi...) is one outline spread over several letters, so
        // some letters get no outline: give their name to the neighbour whose
        // outline covers them.
        var names = [];
        for (g = 0; g < glyphs.length; g++) names.push(glyphs[g].ch);
        for (g = 0; g < glyphs.length; g++) {
            if (byGlyph[g].length) continue;
            var mid = (glyphs[g].x0 + glyphs[g].x1) / 2;
            for (var n = g + 1; n < glyphs.length && glyphs[n].w == glyphs[g].w; n++) {
                if (byGlyph[n].length) {
                    if (boxes[n][0] <= mid) names[n] = glyphs[g].ch + names[n];
                    break;
                }
            }
            if (n >= glyphs.length || glyphs[n].w != glyphs[g].w || boxes[n][0] > mid) {
                for (var q = g - 1; q >= 0 && glyphs[q].w == glyphs[g].w; q--) {
                    if (byGlyph[q].length) { if (boxes[q][1] >= mid) names[q] += glyphs[g].ch; break; }
                }
            }
        }

        // `words` tells AE (and Break apart) that the children are real words.
        var root = { type: "group", name: base.name, children: [], words: true }, words = {};
        for (g = 0; g < glyphs.length; g++) {
            var key = "w" + glyphs[g].w;
            if (!words[key]) {
                words[key] = { type: "group", name: "", children: [] };
                root.children.push(words[key]);
            }
            words[key].name += glyphs[g].ch;
            if (byGlyph[g].length) {
                words[key].children.push({ type: "shape", name: names[g], paths: byGlyph[g], fill: base.fill, stroke: base.stroke });
            }
        }
        return root;
    }

    function convertItem(item, ctx) {
        item = item.getElements()[0];
        var kind = item.constructor.name;
        var where = "page " + ctx.pageName + " / " + kind + (item.name ? " '" + item.name + "'" : "");
        var node;

        if (kind == "TextFrame") {
            // Only frames kept live reach here (the rest were outlined).
            node = textNode(item, ctx, where);
            var bgFill = colorToRGB(item.fillColor, item.fillTint, ctx, where), bgStroke = strokeOf(item, ctx, where);
            if (bgFill || bgStroke) {
                var bg = { type: "shape", name: node.name + " frame", paths: pathsOf(item), fill: bgFill, stroke: bgStroke, visible: true, opacity: 100, blend: "NORMAL" };
                node = { type: "group", name: node.name, children: [bg, node] };
            }
        } else if (kind == "Group") {
            node = { type: "group", name: labelFor(item, kind), children: [] };
            var kids = item.pageItems.everyItem().getElements();
            // collection order is front-to-back; manifest children are back-to-front
            for (var i = kids.length - 1; i >= 0; i--) {
                var c = convertItem(kids[i], ctx);
                if (c) node.children.push(c);
            }
        } else if (hasGraphic(item) || !item.hasOwnProperty("paths")) {
            if (!item.hasOwnProperty("paths") || !hasGraphic(item)) {
                ctx.warn(where + ": exported as an image (no vector equivalent)");
            }
            var ti = new Date().getTime();
            node = exportImage(item, ctx, where);
            ctx.imageMs += new Date().getTime() - ti;
            node.name = (node.source || labelFor(item, kind));
        } else {
            node = {
                type: "shape", name: labelFor(item, kind),
                paths: pathsOf(item),
                fill: colorToRGB(item.fillColor, item.fillTint, ctx, where),
                stroke: strokeOf(item, ctx, where)
            };
            try {
                if (kind == "Rectangle" && item.topLeftCornerOption != CornerOptions.NONE) {
                    ctx.warn(where + ": corner effects not converted (square corners used)");
                }
            } catch (e) {}
            if (!node.fill && !node.stroke) return null; // invisible frame, nothing to draw
            var lbl = "";
            try { lbl = item.label; } catch (e) {}
            if (lbl && lbl.indexOf(GLYPH_LABEL) == 0) {
                var split = splitGlyphs(item, node, eval("(" + lbl.substr(GLYPH_LABEL.length) + ")"), ctx);
                if (split) node = split;
            }
        }
        commonProps(item, node, ctx, where);
        try { node.idLayer = item.itemLayer.name; } catch (e) {}
        return node;
    }

    // -------------------------------------------------------------- document

    // InDesign's built-in swatches; everything else in the Swatches panel is exported.
    var STOCK_SWATCHES = { "None": 1, "Registration": 1, "Paper": 1, "Black": 1 };

    function hex2(v) { var h = Math.round(v * 255).toString(16).toUpperCase(); return h.length < 2 ? "0" + h : h; }

    function describeColor(c) {
        var v = c.colorValue, r = [];
        for (var i = 0; i < v.length; i++) r.push(Math.round(v[i]));
        if (c.space == ColorSpace.CMYK) return "C" + r[0] + " M" + r[1] + " Y" + r[2] + " K" + r[3];
        if (c.space == ColorSpace.HSB) return "HSB " + r.join(" ");
        if (c.space == ColorSpace.LAB) return "Lab " + r.join(" ");
        return "RGB " + r.join(" ");
    }

    // Swatches in Swatches-panel order, converted to sRGB.
    function collectSwatches(doc, ctx) {
        var out = [];
        var all = doc.swatches.everyItem().getElements();
        for (var i = 0; i < all.length; i++) {
            var sw = all[i], kind = sw.constructor.name;
            if (STOCK_SWATCHES[sw.name]) continue;
            var where = "Swatch '" + sw.name + "'";
            var rgb = null, source = "";
            if (kind == "Color") {
                rgb = colorToRGB(sw, 100, ctx, where);
                source = describeColor(sw);
            } else if (kind == "Tint") {
                rgb = colorToRGB(sw, 100, ctx, where);
                source = Math.round(sw.tintValue) + "% of " + sw.baseColor.name;
            } else {
                ctx.warn(where + ": " + kind.toLowerCase() + " swatches aren't included in the swatch comp");
                continue;
            }
            if (!rgb) continue;
            out.push({ name: sw.name, rgb: rgb, hex: "#" + hex2(rgb[0]) + hex2(rgb[1]) + hex2(rgb[2]), source: source });
        }
        return out;
    }

    function relinkMissing(doc, inddFolder, ctx) {
        var links = doc.links;
        for (var i = 0; i < links.length; i++) {
            var l = links[i];
            if (l.status != LinkStatus.LINK_MISSING) continue;
            var cands = [inddFolder + "/Links/" + l.name, inddFolder + "/" + l.name];
            var done = false;
            for (var c = 0; c < cands.length && !done; c++) {
                var f = File(cands[c]);
                if (f.exists) {
                    try { l.relink(f); done = true; } catch (e) {}
                }
            }
            if (!done) ctx.warn("Missing link '" + l.name + "': exported from InDesign's low-res preview");
        }
        for (var j = 0; j < doc.links.length; j++) {
            try { if (doc.links[j].status == LinkStatus.LINK_OUT_OF_DATE) doc.links[j].update(); } catch (e) {}
        }
    }

    // Outlines text frames (all of them, or with liveText only those AE can't
    // reproduce). Returns { outlined, live }.
    function outlineText(doc, ctx, liveText) {
        var n = 0, live = 0;
        var items = doc.allPageItems;
        for (var i = items.length - 1; i >= 0; i--) {
            var it = items[i];
            if (it.constructor.name != "TextFrame") continue;
            var txt = "";
            try { txt = it.contents.replace(/\s+/g, " ").substr(0, 40); } catch (e) {}
            try { it.locked = false; } catch (e) {}
            if (!txt || txt == " ") { try { it.remove(); } catch (e) {} continue; }
            if (liveText) {
                var why = liveTextProblem(it);
                if (!why) { live++; continue; }
                ctx.warn("Text '" + txt + "' converted to shapes because " + why);
            }
            var glyphs = null;
            try { glyphs = toJSON(glyphMap(it)); } catch (e) {}
            try {
                var res = it.createOutlines(true);
                for (var r = 0; r < res.length; r++) {
                    try { res[r].name = txt; } catch (e) {}
                    if (!glyphs) continue;
                    var polys = res[r].constructor.name == "Group" ? res[r].allPageItems : [res[r]];
                    for (var q = 0; q < polys.length; q++) { try { polys[q].label = GLYPH_LABEL + glyphs; polys[q].name = txt; } catch (e) {} }
                }
                n++;
            } catch (e) {
                ctx.warn("Could not outline text '" + txt + "': " + e);
            }
        }
        return { outlined: n, live: live };
    }

    function sortedPageItems(page) {
        // InDesign collections list items front-to-back. Sort by layer (top layer
        // first) and keep collection order within a layer; master items sit
        // behind page items on the same layer.
        var list = [], i;
        var pi = page.pageItems.everyItem().getElements();
        for (i = 0; i < pi.length; i++) list.push({ item: pi[i], layer: pi[i].itemLayer.index, master: 0, ord: i });
        var mi = [];
        try { mi = page.masterPageItems; } catch (e) {}
        for (i = 0; i < mi.length; i++) list.push({ item: mi[i], layer: mi[i].itemLayer.index, master: 1, ord: i });
        list.sort(function (a, b) {
            if (a.layer != b.layer) return a.layer - b.layer;
            if (a.master != b.master) return a.master - b.master;
            return a.ord - b.ord;
        });
        var out = [];
        for (i = list.length - 1; i >= 0; i--) out.push(list[i].item); // back-to-front
        return out;
    }

    function writeManifest(mf, manifest, pageCount, ctx) {
        mf.encoding = "UTF-8";
        mf.lineFeed = "Unix";
        if (!mf.open("w")) throw new Error("Could not write " + mf.fsName);
        mf.write(toJSON(manifest));
        mf.close();
        return "OK|" + mf.fsName + "|" + pageCount + "|" + ctx.warnings.length;
    }

    /**
     * Export an InDesign document for After Effects.
     * @param {String} inddPath  path to the .indd
     * @param {Object} [opts]    { outFolder, imageScale, swatchesOnly, liveText }
     * @returns {String} "OK|<manifest path>|<pages>|<warnings>" or "ERROR|<message>"
     */
    NS.exportDocument = function (inddPath, opts) {
        opts = opts || {};
        var src = File(inddPath);
        if (!src.exists) return "ERROR|File not found: " + inddPath;
        var inddFolder = src.parent.fsName;
        var baseName = decodeURI(src.name).replace(/\.indd$/i, "");
        var outFolder = Folder(opts.outFolder || (inddFolder + "/" + baseName + "_AE"));
        var imagesFolder = Folder(outFolder.fsName + "/images");
        var scale = opts.imageScale || IMAGE_SCALE_DEFAULT;

        var oldUI = app.scriptPreferences.userInteractionLevel;
        var oldRedraw = app.scriptPreferences.enableRedraw;
        var oldCMYK = null, oldRGB = null;
        app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
        app.scriptPreferences.enableRedraw = false;

        // Work on a temporary copy so the original (or an open copy of it) is never touched.
        var tmp = File(Folder.temp.fsName + "/IDtoAE_" + new Date().getTime() + ".indd");
        var doc = null;
        var ctx = {
            warnings: [], colorCache: {}, imageCache: {}, imagesFolder: imagesFolder, imageCount: 0, timings: {}, t0: new Date().getTime(), imageMs: 0,
            mark: function (k) { this.timings[k] = new Date().getTime() - this.t0; },
            warn: function (m) { this.warnings.push(m); }
        };

        try {
            if (!src.copy(tmp.fsName)) return "ERROR|Could not copy the InDesign file to a temp folder";
            doc = app.open(tmp, false);
            ctx.mark("opened");

            if (!outFolder.exists) outFolder.create();
            if (opts.swatchesOnly) {
                // nothing else to prepare
            } else if (imagesFolder.exists) {
                var old = imagesFolder.getFiles("*.png");
                for (var o = 0; o < old.length; o++) old[o].remove();
            } else imagesFolder.create();

            with (doc.viewPreferences) {
                horizontalMeasurementUnits = MeasurementUnits.POINTS;
                verticalMeasurementUnits = MeasurementUnits.POINTS;
                rulerOrigin = RulerOrigin.PAGE_ORIGIN;
            }
            doc.zeroPoint = [0, 0];

            // Remember layer visibility, then show/unlock everything so it can be exported.
            var hiddenLayers = {};
            for (var L = 0; L < doc.layers.length; L++) {
                var lay = doc.layers[L];
                if (!lay.visible) hiddenLayers[lay.name] = true;
                lay.visible = true;
                lay.locked = false;
            }

            // app.colorTransform uses the application's working spaces, not the
            // document's: convert from the document's CMYK profile to sRGB.
            oldCMYK = app.colorSettings.workingSpaceCMYK;
            oldRGB = app.colorSettings.workingSpaceRGB;
            try {
                if (doc.cmykProfile != oldCMYK) app.colorSettings.workingSpaceCMYK = doc.cmykProfile;
                if (oldRGB != SRGB) app.colorSettings.workingSpaceRGB = SRGB;
            } catch (e) {
                ctx.warn("Could not set up the colour conversion (" + doc.cmykProfile + " to sRGB); colours may shift slightly");
            }
            if (doc.rgbProfile != SRGB) {
                ctx.warn("The document's RGB profile is " + doc.rgbProfile + ", not sRGB: RGB swatches are passed through unconverted");
            }

            var swatches = collectSwatches(doc, ctx);
            if (opts.swatchesOnly) {
                return writeManifest(File(outFolder.fsName + "/swatches.json"), {
                    version: 1, source: src.fsName, document: baseName, exported: new Date().toString(),
                    pages: [], swatches: swatches, warnings: ctx.warnings
                }, 0, ctx);
            }

            relinkMissing(doc, inddFolder, ctx);
            ctx.mark("relinked");
            var textResult = outlineText(doc, ctx, !!opts.liveText);
            ctx.mark("outlined");

            with (app.pngExportPreferences) {
                exportResolution = 72 * scale;
                transparentBackground = true;
                antiAlias = true;
                pngQuality = PNGQualityEnum.MAXIMUM;
                pngColorSpace = PNGColorSpaceEnum.RGB;
                useDocumentBleeds = false;
                simulateOverprint = false;
            }

            var pages = [];
            for (var p = 0; p < doc.pages.length; p++) {
                var page = doc.pages[p];
                var b = page.bounds; // [top, left, bottom, right] relative to page origin
                ctx.pageNum = p + 1;
                ctx.pageName = page.name;
                ctx.imageCount = 0;
                var items = sortedPageItems(page);
                var layers = [];
                for (var i = 0; i < items.length; i++) {
                    var node = convertItem(items[i], ctx);
                    if (!node) continue;
                    if (node.idLayer && hiddenLayers[node.idLayer]) node.visible = false;
                    layers.push(node);
                }
                pages.push({
                    name: page.name, index: p + 1,
                    width: r3(b[3] - b[1]), height: r3(b[2] - b[0]),
                    layers: layers
                });
            }

            ctx.mark("pages");
            ctx.timings.images = ctx.imageMs;
            var manifest = {
                version: 1,
                source: src.fsName,
                document: baseName,
                exported: new Date().toString(),
                imageScale: scale,
                outlinedTextFrames: textResult.outlined,
                liveTextFrames: textResult.live,
                timingsMs: ctx.timings,
                pages: pages,
                swatches: swatches,
                warnings: ctx.warnings
            };
            return writeManifest(File(outFolder.fsName + "/manifest.json"), manifest, pages.length, ctx);
        } catch (e) {
            return "ERROR|" + e + (e.line ? " (line " + e.line + ")" : "");
        } finally {
            try { if (doc && doc.isValid) doc.close(SaveOptions.NO); } catch (e2) {}
            try { tmp.remove(); } catch (e3) {}
            app.scriptPreferences.userInteractionLevel = oldUI;
            app.scriptPreferences.enableRedraw = oldRedraw;
            try {
                if (oldCMYK && app.colorSettings.workingSpaceCMYK != oldCMYK) app.colorSettings.workingSpaceCMYK = oldCMYK;
                if (oldRGB && app.colorSettings.workingSpaceRGB != oldRGB) app.colorSettings.workingSpaceRGB = oldRGB;
            } catch (e4) {}
        }
    };

})(IDtoAE);

// Standalone use: run from InDesign's Scripts panel. Callers that only want the
// function (the AE panel, tests) set IDtoAE_NO_AUTORUN = true first.
if (typeof IDtoAE_NO_AUTORUN == "undefined") {
    (function () {
        var f = File.openDialog("Choose an InDesign file to export for After Effects", "*.indd");
        if (!f) return;
        var r = IDtoAE.exportDocument(f.fsName).split("|");
        if (r[0] == "OK") alert("Exported " + r[2] + " pages.\n" + r[3] + " warnings.\n\n" + r[1]);
        else alert("Export failed:\n" + r[1]);
    })();
}
