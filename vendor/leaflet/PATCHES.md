# Leaflet 1.9.4 (vendored, BSD-2-Clause, see LICENSE)

Copied from `node_modules/leaflet/dist/` (ESM build + CSS). One patch:

- **Inline-SVG check** (`var inlineSvg`): the original assigns `innerHTML = '<svg/>'` at load time. Qarib's CSP enforces
  Trusted Types, so that throws and Leaflet would not load. Replaced with `!!svg$1` (any browser with SVG has inline SVG).

Qarib never uses Leaflet's controls or popups that write HTML as strings (zoom, attribution, layers, scale, popups,
tooltips): the map is created with `zoomControl: false, attributionControl: false`, and the app shows the
OpenStreetMap attribution itself. `tests/security.test.js` checks the patch is in place.
