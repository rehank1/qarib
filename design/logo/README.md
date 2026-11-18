# Qarīb logo

Files: `qarib-logo.svg` (master, 512×512 viewBox), `qarib-logo-512.png`, `qarib-logo-48.png`.

## Concept
A **mihrab pin**. The outer shape is a pointed arch, like a dome or the top of a mihrab, that narrows into the tip of a map pin. A mihrab niche is cut through the middle. The mark reads as "the masjid, right here", which is what *Qarīb* (near, Quran 2:186) means, and what the app does: it finds the nearest masjids and guides you to them.

## Why it won
Six concepts were built and tested: a round pin with a niche cut out, a crescent pin, this arch pin, three nested arches, an eight-point star pin, and a teardrop niche.
- **It's legible at 48 px and 24 px.** It's one solid gold shape with one large hole, and nothing thin closes up at small sizes.
- **Its meaning is clear.** It's still recognisably a location pin, but it's clearly about a masjid, not a generic map app.
- **It's distinctive.** The pointed arch-and-pin outline is less generic than the round pin and crescent that many prayer apps use. The nested-arches concept looked like a Wi-Fi or rainbow icon, and the star was too busy at small sizes.
- **It's calm and premium.** It uses a single gold shape on deep teal-black.

## Construction and colours
- Background: full-bleed 512×512 square with a radial gradient #1c363c → #0f1c20 → #091215. It's full-bleed so the icon works as a maskable Android icon.
- Symbol: a single path (`fill-rule="evenodd"`) with a gold gradient #f6dc96 → #e8c16a → #b98d34. Use flat #e8c16a where gradients aren't supported.
- Light theme / one colour: ink gold #7a5a16 on parchment #f7f2e8. This was tested and works.
- The whole mark sits inside a circle about 170 px in radius, comfortably within the maskable safe zone (80% diameter, radius 204.8 px).
- There's no text in the icon, so nothing becomes illegible at launcher sizes.
- This isn't legal clearance. Run a trademark and reverse-image search before launch.
