# Qarīb logo v2: "Near, in prostration"

## Concept
A gold **mihrab** (the prayer niche that faces the qibla) holds two things cut through to the dark background:

- **قَرِيب** (*qarīb*, "near") in its crown: the word from **Quran 2:186**,
  «وَإِذَا سَأَلَكَ عِبَادِي عَنِّي فَإِنِّي قَرِيبٌ ۖ أُجِيبُ دَعْوَةَ الدَّاعِ إِذَا دَعَانِ».
- **A worshipper in sujood** (prostration) on its floor. Sujood is the moment in salah when a servant is nearest to his Lord, so the figure illustrates the name.

At launcher size (48 px) it reads as "prayer niche + someone praying". At larger sizes (splash, store listing, header) the Quranic word becomes legible.

## Arabic used
- Text: `قَرِيب` (U+0642 U+064E U+0631 U+0650 U+064A U+0628). Qāf with fatḥa, rāʾ with kasra, yāʾ, bāʾ. The verse has the tanwīn form قَرِيبٌ; the logo uses the bare word as the name.
- Shaped with HarfBuzz (harfbuzzjs 1.6.4) from **Times New Roman Bold** (`timesbd.ttf`, Windows), right to left with contextual joining, then converted to outlines. The SVG contains no live text and needs no font.
- Font licence: Times New Roman is a Monotype/Microsoft font. Check that its licence allows logo use, or redraw the word in an OFL naskh such as Amiri before a commercial or trademark use.

## Files
- `qarib-logo.svg`: 512×512, full-bleed teal-black radial background (#1c363c → #0f1c20 → #091215) and a gold gradient mark (#f6dc96 / #e8c16a / #b98d34; flat fallback #e8c16a). The mark is one even-odd path and sits inside a circle of radius ~165 px, so it survives Android adaptive-icon masks.
- `qarib-logo-512.png`, `qarib-logo-48.png`: renders made with sharp.
- `mark.svg`: the symbol on its own, `fill="currentColor"`, tight viewBox, for the app header.

## Why it won
Other concepts: an outlined mihrab with the figure, a solid mihrab with only قَرِيب, ٱلصَّلَوٰة under a crescent, and an outlined mihrab with the word and the figure.
- Only this one meets all three asks at once: it is Arabic, it comes from the Quran (the app's own name, 2:186), and it signals prayer instantly. The mihrab and the sujood silhouette both read at 48 px.
- The solid niche with cut-outs holds up at small sizes much better than the outlined versions, whose thin strokes broke up. The crescent and calligraphy-only versions were illegible or generic at 48 px.
- Respect: no face and no depiction of Allah or the Prophet. The Quranic word sits at the top of the niche, above the worshipper and never beneath him.
