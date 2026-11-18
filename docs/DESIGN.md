# Design system

## Colour

**Palette logic.** Deep teal-green (cool, ~190°) against lamp-lit gold (warm, ~42°): nearly complementary, so the gold reads as light in a dark room. Teal-green carries the calm of the night sky and the traditional colour of the masjid. Gold carries the lamp and the call. Dark is the default because the app is used most at Fajr and Isha, and dark surfaces save power on OLED phones.

**60 · 30 · 10.** 60% surfaces · 30% text and raised containers · 10% gold. Gold is rationed to **one focal point per screen**: the next prayer, the current prayer, the nearest masjid's Directions button, the active tab. When everything is gold, nothing is.

**Semantic colour is separate from the accent.**

| Role | Dark | Light | Meaning |
|---|---|---|---|
| `--emerald` | #5BD1A6 | #1B7356 | Published by the masjid (trust) |
| `--amber` | #F2C46B | #7D5300 | Demo or out of date (caution) |
| `--danger` | #FF8F85 | #B3261E | Errors |

Status is never shown by colour alone. Every pill has a word and, where it helps, an icon.

**Accessibility.** Every text role passes WCAG 2.2 AA (≥ 4.5:1) on every surface in both themes, including the primary button's text on gold. `tests/security.test.js` checks this on every build. Light-mode gold is a darker, ink-strength shade (#7A5A16), not the dark-mode gold reused.

## Type

System fonts only: zero downloads, instant first paint, native feel on each platform. Arabic is set in the platform's Naskh (`Noto Naskh Arabic` / `Geeza Pro`), with `lang="ar"` and `dir="rtl"`. Numbers use tabular figures so times line up in columns. The scale runs from 0.84 rem to 3.6 rem, and the largest size is used once per screen: the next prayer's time.

## Layout and interaction

| Principle | Where it shows |
|---|---|
| **Fitts's law** | Bottom tab bar in thumb reach; every target ≥ 48 px |
| **Hick's law** | Three tabs; one primary action per screen; settings folded away |
| **Progressive disclosure** | Calculation settings and portal forms appear only when needed |
| **Ask in context** | Location is requested when the user taps "Use my location", never on page load, with a plain reason and a city-search alternative |
| **Visibility of system status** | Skeleton cards while loading; "updated 5 min ago"; offline banner; jamaat times show when they were published and flag them when stale |
| **Error prevention** | Times must be in order before they can be published; weak passwords are explained, not just refused |
| **Recognition over recall** | Arabic names beside English; Hijri date beside Gregorian; ranked list (1–4) with distance and walking minutes |
| **Motion with purpose** | One 280 ms entrance per screen; content is readable from the first frame; everything stops under reduced motion |

## Spacing and shape

A 4-point scale (4 · 8 · 12 · 16 · 24 · 32 · 48). Radius 10 / 16 / 22 by nesting depth: the larger the container, the rounder its corners. A shadow appears only on the hero card, so depth means "look here".

## Icon

The Khātam Sulaymānī, an eight-pointed star made of two squares, the oldest geometric motif in Islamic art. A crescent sits at its centre: the moon that is always near.
