---
name: universal
description: Build something the user can see and keep — charts, 3D scenes, interactive HTML, drawings, images, documents. Use whenever an answer is easier to inspect than to read, or when the user asks for a report, dashboard, prototype, model, diagram or file.
license: MIT
allowed-tools: create_document generate_image write_file read_file load_skill author_skill run_harness
---

# Universal maker

The console is a display, not a chat log. Anything you understand well enough to
explain, you can also draw, make interactive, and hand over as a file. Do that.

## 1. Pick the medium before you write

| The question is about | Make |
| --- | --- |
| a trend, comparison, distribution, share, correlation | `chart` |
| shape, structure, space, a physical object, a molecule, a layout | `scene` (3D) |
| a mechanism the user will poke at, a calculator, a prototype, a mini app | `html` |
| a diagram that must stay crisp and editable | `svg` or `mermaid` |
| a picture, texture, illustration, mood | `generate_image` |
| prose, analysis, a deliverable someone will print or send | `create_document` + markdown |
| an exact dataset | `create_document` with `csv` or `json` |

Two mediums beat one when the stake is real: a chart *and* the table that
produced it; a 3D model *and* the spec; a report *and* the CSV behind the figure.

## 2. Charts

```chart
{"type":"line","title":"Median rent, Lisbon","subtitle":"EUR per month, 1-bed","x":"year","unit":"EUR","format":"raw","data":[{"year":"2019","rent":780},{"year":"2021","rent":910},{"year":"2023","rent":1180},{"year":"2025","rent":1420}]}
```

- Type follows intent: `line` for change over time, `bar` for comparison at a
  point in time, `area` for accumulated volume, `scatter` for correlation,
  `pie`/`donut` only for parts of one whole with ≤6 slices.
- One idea per chart. If you need two y-axes, make two charts.
- Label honestly: `unit`, `format` (`percent` when values are ratios ×100), and
  a `subtitle` that says what is counted and over what period.
- 4-12 data points for humans, 30 max. Aggregate before you plot.
- Never fabricate a series. If the data is illustrative, say so in the
  subtitle and in the text.
- The console gives the user hover, legend filtering, table view, and SVG / PNG
  / CSV / spec downloads. You do not need to repeat the numbers — but name the
  one number that matters in prose.

## 3. 3D scenes

```scene
{"title":"Benzene ring","autoRotate":10,"grid":false,"objects":[{"type":"torus","radius":1.1,"color":"#89d6ea","opacity":0.9},{"type":"sphere","position":[0,0,0],"radius":0.25,"color":"#efc07a"},{"type":"sphere","position":[1.1,0,0],"radius":0.22,"color":"#8fe3b6"},{"type":"sphere","position":[-1.1,0,0],"radius":0.22,"color":"#8fe3b6"}]}
```

- Types: `box`, `sphere`, `cylinder`, `cone`, `torus`, `plane`, `ring`.
- `position` and `size` are `[x, y, z]`; round shapes take `radius`. Keep the
  model near the origin and roughly 4-8 units across — the camera frames it.
- Colour carries meaning or it carries nothing. Use a small palette, and say in
  prose which colour is which when it is not obvious.
- 10-40 objects. For anything heavier, build it in code and export a mesh.
- `autoRotate` (degrees per second) at 6-16 reads well; `grid: false` for
  molecules, `grid` on for architecture and product mockups.
- Exports: GLB (Blender, Unity, three.js), OBJ, and the JSON spec.

## 4. Interactive HTML

A single self-contained page. Inline everything; no build step, no CDN that can
fail, no network fetch the user did not ask for.

```html
<style>body{font:15px/1.6 system-ui;padding:0}label{display:block;margin:14px 0 4px;color:#9a97a8}</style>
<h3>Compound interest</h3>
<label>Monthly deposit <input id="d" type="range" min="0" max="2000" value="300"></label>
<label>Years <input id="y" type="range" min="1" max="40" value="25"></label>
<output id="out" style="font:600 28px/1.2 ui-monospace,monospace;color:#efc07a"></output>
<script>
const fmt = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
function render() {
  const d = +document.querySelector('#d').value, y = +document.querySelector('#y').value, r = 0.07 / 12;
  let total = 0;
  for (let i = 0; i < y * 12; i++) total = (total + d) * (1 + r);
  document.querySelector('#out').textContent = fmt.format(total);
}
document.querySelectorAll('input').forEach((el) => el.addEventListener('input', render));
render();
</script>
```

- Controls that change one thing at a time. Defaults that already show something
  interesting. Results formatted (currency, units, thousands separators).
- Dark paper (`#14141c`), light text (`#eceaf4`), one accent (`#efc07a`). It is
  rendered inside the console, so match the console.
- Fit a phone: nothing wider than 420px, no hover-only affordances.
- The frame is sandboxed without same-origin access: no localStorage, no
  cookies, no parent DOM. Keep state in variables and URL fragments.
- Users can expand, reload, and download the page — it must work from `file://`.

## 5. Research into a deliverable

1. Load `deep-research`; collect sources with `web_search` / `fetch_url`, and
   record the URL next to every claim as you go. Numbers without a source are
   decoration.
2. Structure before writing: question → what is known → what is contested →
   what it implies → what to do next.
3. Build the evidence layer: one table of the core numbers, one chart of the
   trend that carries the argument.
4. `create_document`:
   - `docx` for anything a supervisor, client or journal will touch.
   - `html` for something to read or print to PDF in a browser.
   - `csv`/`json` when the value is the data, not the prose.
   - `md` when the user will keep editing it.
5. In your reply: the finding in two sentences, the figure, then the download
   link. Never paste the whole document back into chat.

## 6. Prose that earns the visual

- Lead with the answer. The chart supports a sentence that already exists.
- One idea per paragraph; cut throat-clearing ("It is important to note").
- Say the number, the unit, and the comparison: "€1,420 — up 20% on 2023",
  not "significantly higher".
- If you cannot state the conclusion in one sentence, you do not have it yet.

## 7. Code economy

Write the line that does the job. A loop beats three near-identical blocks; a
built-in beats a helper; deleting a branch beats documenting it. Before you add
code, check whether a tool, a skill or another CLI already does it — `harnesses`
lists the coding agents installed here, and `run_harness` will drive one.

## 8. Getting better

When a procedure works twice, capture it with `author_skill`: name, one-line
routing description, and the steps that actually mattered (including the
pitfalls that cost a round trip). Skills are how this app compounds — yours and
the user's.
