# Vendored front-end libraries (Grafo view)

Pinned static dist files, served locally — no CDN at runtime, no npm, no build step.
The Node server stays zero-dependency; these are browser-only assets for the corpus
knowledge graph (Grafo).

| File | Package | Version | Source |
| --- | --- | --- | --- |
| `cytoscape.min.js` | cytoscape (MIT) | 3.30.2 | https://unpkg.com/cytoscape@3.30.2/dist/cytoscape.min.js |
| `layout-base.js` | layout-base (MIT) | 2.0.1 | https://unpkg.com/layout-base@2.0.1/layout-base.js |
| `cose-base.js` | cose-base (MIT) | 2.2.0 | https://unpkg.com/cose-base@2.2.0/cose-base.js |
| `cytoscape-fcose.js` | cytoscape-fcose (MIT) | 2.2.0 | https://unpkg.com/cytoscape-fcose@2.2.0/cytoscape-fcose.js |

Load order (index.html): `layout-base` → `cose-base` → `cytoscape` → `cytoscape-fcose`
(fcose auto-registers against the global `cytoscape` and falls back to the built-in
`cose` layout if the chain ever breaks).
