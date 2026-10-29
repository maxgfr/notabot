---
name: notabot
description: A border checkpoint where the visitor's browser presents its papers, gets cross-checked, and is stamped.
colors:
  paper: "#eef0e6"
  page: "#f4f6ee"
  ink: "#1c2321"
  ink-2: "#48514b"
  rule: "#b9c1ae"
  rule-soft: "#d3d9c9"
  teal: "#2f5d50"
  violet: "#5a3f8c"
  red: "#b3302a"
typography:
  display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.1rem, 3.9vw, 3.7rem)"
    fontWeight: 760
    lineHeight: 1.02
    letterSpacing: "-0.025em"
    fontVariation: "'wdth' 112"
  headline:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.6rem, 2.6vw, 2.35rem)"
    fontWeight: 720
    lineHeight: 1.08
    letterSpacing: "-0.02em"
    fontVariation: "'wdth' 106"
  title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.15rem"
    fontWeight: 720
    lineHeight: 1.55
    fontVariation: "'wdth' 106"
  wordmark:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.3rem"
    fontWeight: 800
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 125"
  document-title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "3.1cqi"
    fontWeight: 760
    lineHeight: 1.08
    letterSpacing: "0.01em"
    fontVariation: "'wdth' 125"
  field-label:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.45cqi"
    fontWeight: 500
    letterSpacing: "0.05em"
    fontVariation: "'wdth' 75"
  field-value:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.15cqi"
    fontWeight: 640
    lineHeight: 1.2
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 600
  data:
    fontFamily: "OCR-B, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.86rem"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "'liga' 0, 'clig' 0, 'dlig' 0, 'tnum' 1"
  mrz:
    fontFamily: "OCR-B, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "2.92cqi"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "0em"
    fontFeature: "'liga' 0, 'clig' 0, 'dlig' 0, 'tnum' 1"
rounded:
  hairline: "4px"
  control: "8px"
  sheet: "10px"
  desk: "12px"
  document: "14px"
  pill: "999px"
spacing:
  gutter: "clamp(18px, 4vw, 56px)"
  section: "clamp(56px, 9vh, 104px)"
  column: "clamp(24px, 4vw, 64px)"
  desk: "22px"
  booth: "16px"
  actions: "10px"
  row: "11px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.page}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
  button-primary-hover:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.page}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
  input-field:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
  mode-choice:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  level-badge:
    textColor: "{colors.ink}"
    typography: "{typography.data}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  passport:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    rounded: "{rounded.document}"
    padding: "4.2cqi 4.6cqi 3.4cqi"
  inspection-desk:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    rounded: "{rounded.desk}"
    padding: "12px 14px 8px"
    width: "min(100%, 380px)"
  code-sheet:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    typography: "{typography.data}"
    rounded: "{rounded.sheet}"
    padding: "14px 16px"
  stamp-admitted:
    textColor: "{colors.teal}"
  stamp-secondary:
    textColor: "{colors.violet}"
  stamp-refused:
    textColor: "{colors.red}"
  stamp-error:
    textColor: "{colors.ink-2}"
  nav-link:
    textColor: "{colors.ink-2}"
---

# Design System: notabot

## Overview

**Creative North Star: "The Border Checkpoint"**

The page is a frontier post on passport security paper. The visitor's browser is the traveller: it presents a data page filled with its own declarations, an officer cross-checks those papers against each other, and a rubber stamp lands on the document with the verdict. Every device the world uses is borrowed from identity documents and does real work: the guilloché engraving is drawn live as hairlines, the machine-readable zone carries real ICAO 9303 check digits computed from the visitor's signals, the portrait is the visitor's own canvas and WebGL render, and the stamp only ever prints the actual verdict.

The system is light, ruled and achromatic where people read, coloured only where the security print, the stamps and the states live. Density is that of an official ledger: hairline-ruled rows, a strict monospace grid for every machine value, a condensed small-caps-like sans for field labels, and generous section air between dossiers. One object is lifted off the paper, the passport; everything else lies flat and is separated by rules, never boxed into cards. The world refuses the developer-tool landing (headline, demo card, feature grid) and the hacker terminal: no dark phosphor screens, no green-on-black glyph art.

**Key Characteristics:**
- Pale sage security paper with a lighter data-page tone; all text in near-black ink and its faded second ink.
- Colour lives in hairlines: guilloché strokes, link underlines, rule markers, stamp ink, focus rings.
- Two scripts: Archivo (variable width axis) for everything a person reads, OCR-B for everything a machine wrote.
- Three inks with fixed meanings: teal admits, violet sends to secondary inspection, red refuses.
- Ruled ledgers instead of cards; one lifted, slightly tilted passport as the only elevated object.

## Colors

A muted security-paper palette: two sage paper tones, two inks, two hairline greys, and three stamp inks whose meanings never change.

### Primary
- **Inspection Teal** (#2f5d50): the admitting ink. Guilloché strokes (at 26% opacity), the admitted stamp, completed checkpoints and the moving marker, the selected mode outline, the focus ring, the caret, `accent-color`, the hover state of the primary button, the "ok" status line, and the section microprint. 6.5:1 on paper, so it holds as text when a state needs it.

### Secondary
- **Visa Violet** (#5a3f8c): the second engraving ink and the secondary-inspection stamp. Guilloché strokes (at 22% opacity), the "unsure" stamp, the double outline of a high privacy cost badge, the underline of in-page action links. In the embedded widget it maps to the challenge (warn) state.

### Tertiary
- **Refusal Red** (#b3302a): reserved ink. The refused stamp, a rule that raised (its head, state and detail), the contradicting part of a ledger value, the "raised by" note under it, and a failed officer status. 5.4:1 on paper. The direction contract named #c2372b; the build ships the deeper #b3302a, and the build is canonical.

### Neutral
- **Security Paper** (#eef0e6): the page ground (`html` background), the checkpoint dot fill at rest, the scrollbar track.
- **Data Page** (#f4f6ee): the lighter sheet for things laid on the paper: the passport, the inspection desk, inputs, mode choices, code sheets, and the text colour on the ink button.
- **Ink** (#1c2321): all headings, body text, field values, the primary button fill. 13.9:1 on paper.
- **Faded Ink** (#48514b): ledes, captions, hints, field labels, nav links, the second line of the passport title, the error stamp. 7.1:1 on paper.
- **Rule** (#b9c1ae): every structural hairline: ledger row rules, input and sheet borders, the passport head rule, checkpoint track at rest, low privacy badge outline.
- **Soft Rule** (#d3d9c9): the lighter rule above the MRZ, where a full rule would be too heavy inside the document.

### Named Rules
**The Hairline Colour Rule.** Colour lives in strokes, underlines, outlines, markers and stamp ink. Running text, headings and labels stay in Ink or Faded Ink; links keep the text colour and carry their colour in the underline (teal or violet decoration, 1px, offset 0.22em).

**The Three Inks Rule.** Teal means admitted, done, selected or focused. Violet means secondary inspection, high cost or an in-page action. Red means refused. An ink never borrows another's meaning.

**The Red Ink Rule.** Red is used for the refused verdict and the contradictions that caused it, nothing else: no red for emphasis, decoration, warnings or brand.

## Typography

**Display Font:** Archivo variable (weight 100 to 900, width 62% to 125%), with ui-sans-serif, system-ui fallback
**Body Font:** Archivo, same file
**Label/Mono Font:** OCR-B, with ui-monospace, SFMono-Regular, Menlo fallback

**Character:** a sturdy grotesque that changes register through its width axis, stretched wide for the wordmark and the document's name, condensed for small field labels, paired with the machine-readable typeface of real passports for every value the browser itself emitted.

### Hierarchy
- **Wordmark** (800, 1.3rem, width 125%, -0.01em): the "notabot" mark in the rail.
- **Display** (760, clamp(2.1rem, 3.9vw, 3.7rem), 1.02, width 112%, -0.025em): the single headline at the inspection desk.
- **Headline** (720, clamp(1.6rem, 2.6vw, 2.35rem), 1.08, width 106%, -0.02em): section titles, balanced wrap.
- **Title** (720, 1.15rem, width 106%): ledger group and transcript sub-heads (1rem to 1.15rem).
- **Document title** (760, 3.1cqi, 1.08, width 125%, uppercase, 0.01em): the bilingual "Browser passport / Passeport navigateur" heading; second line at 500 in Faded Ink.
- **Field label** (500, 1.45cqi to 1.55cqi, width 75%, uppercase, 0.05em, Faded Ink): passport field names; floor of 10px on narrow screens.
- **Field value** (640, 2.15cqi, 1.2, uppercase): the declared value on the data page, two lines max; floor of 13px on narrow screens.
- **Body** (400, 17px, 1.55; 16px below 640px): prose, max 44ch for the lede (1.12rem), 64ch to 76ch for section text.
- **Label** (600, 0.95rem): buttons, form labels, mode legend.
- **Data** (OCR-B 400, 0.86rem, 1.45): ledger values, rule ids, privacy levels, timestamps, code sheets (0.8rem), video time links (0.85rem).
- **MRZ** (OCR-B 400, 2.92cqi, 1.35, 0 tracking, `white-space: pre`): the two 44-character lines at the foot of the passport.

### Named Rules
**The Two Scripts Rule.** Archivo for whatever a person reads (headings, prose, field labels, explanations); OCR-B for whatever the machine wrote (every value, rule id, level, MRZ, code, timestamp). A label is never set in mono and a value is never set in the sans, except the passport's human-readable field values, which stay in the sans as on a real data page.

**The Width Axis Rule.** Register is carried by `font-stretch`, not by new families: 125% for the wordmark and the document's name, 112% for the display and the stamps, 106% for section and group heads, 100% for reading, 75% for small field labels.

**The Clean Glyph Rule.** OCR-B always runs with ligatures off (`liga`, `clig`, `dlig` at 0) and tabular numerals: its fi, fl and ff ligature glyphs are not the letters they replace.

## Layout

Full-bleed sections with a fluid side gutter (clamp(18px, 4vw, 56px)) and no centred max-width container; reading measure is held by `ch` limits on text blocks instead.

The first viewport is the crossing itself: a two-column grid, document left (7fr) and desk right (minmax(300px, 5fr)), vertically centred, at least the viewport tall minus the rail. The passport keeps passport proportions (125:88) and sizes everything inside in container query units (`cqi`), so the data page scales as one object. The desk stacks headline, lede and the booth (widget, checkpoint line, note) with 22px and 16px gaps.

Below the fold every section shares one ledger grid: a heading column and a content column (5fr / 7fr for section heads and the officer form, 5fr / 12fr for ledger groups and the unreadable-papers list), with a column gap of clamp(24px, 4vw, 64px). Sections are padded clamp(56px, 9vh, 104px) and each opens on a teal microprint hairline. Rule lists flow in auto-fill columns of at least 340px.

Responsive behaviour: at 980px every two-column grid collapses to one, and the desk moves above the passport so the check is the first thing on a phone. At 640px the passport drops its fixed aspect ratio and its tilt, uses fixed padding (18px 16px 14px), stacks the portrait (40% wide) above the fields, applies legible floors to its `cqi` type, and ledger rows become a two-column grid with the value on its own line.

**The Border Crossing Rule.** On wide screens the document sits left and the desk right; on narrow screens the desk comes first. The verdict always lands on the document, never in a separate panel.

## Elevation & Depth

The system is flat on paper. Depth comes from tone (Data Page laid on Security Paper) and from hairline rules, not from shadows. Exactly one object is lifted: the passport, with a close contact shadow and a long soft drop, rotated -0.6deg as if laid on a counter. The stamp sits on it with `mix-blend-mode: multiply` at 0.9 opacity, so the ink reads as pressed into the paper rather than floating above it.

### Shadow Vocabulary
- **Document lift** (`box-shadow: 0 1px 2px rgb(28 35 33 / 0.12), 0 24px 48px -24px rgb(28 35 33 / 0.38)`): the passport only.
- **Double rule** (`box-shadow: inset 0 0 0 1px <ink>`): thickens a 1px outline to 2px without layout shift; used for the selected mode choice (teal) and the high privacy badge (violet). It is a border device, not elevation.

### Named Rules
**The One Lifted Object Rule.** Only the passport casts a shadow. Sections, ledgers, sheets and the desk lie flat; if something needs separation, it gets a rule or a tone step.

## Shapes

Gently rounded, document-like corners scaled by object size: 4px for the portrait frame and the focus ring, 8px for controls (buttons, inputs, selects, mode choices, skip link), 10px for code sheets, 12px for the inspection desk, 14px for the passport, and full pills only for privacy level badges. Stamps are double rounded frames (an outer 5-unit and an inner 1.5-unit stroke, 10-unit corners) rotated -9deg.

The dominant form is the rule, not the box: ledger rows, rule lists and the unreadable-papers list are separated by 1px top hairlines (closed by a bottom rule on the last row), the checkpoint line is a 2px track with 10px circular markers, and every section begins with a hairline carrying 6px microprint. The guilloché is cut from hypotrochoid rosettes whose centres sit outside the page, so only their rings cross it, plus six interlaced sine bands at the head and foot.

**The Ruled, Not Boxed Rule.** Collections are ruled ledgers. Bordered boxes are reserved for things a visitor handles: controls, code sheets, the desk and the document.

## Components

### Buttons
Plain and official, like a counter clerk's controls.
- **Shape:** gently rounded (8px), 1px border matching the fill.
- **Primary:** Ink fill, Data Page text, label type (600, 0.95rem), 9px 16px padding.
- **Hover / Focus:** fill and border turn Inspection Teal over 200ms on the house easing; focus is the global 2px teal outline offset 3px.
- **Quiet:** transparent with an Ink border and Ink text; hover adds a 7% ink wash.
- **Disabled:** 0.55 opacity with a progress cursor (used while a request runs).
- **Text action:** an unboxed button set in body type with a violet underline, for secondary in-page actions.

### Chips (privacy levels and mode choices)
- **Privacy level badge:** pill, 1px outline, OCR-B uppercase 0.78rem, 2px 8px. Low: Rule outline, Faded Ink text. Medium: teal outline. High: violet outline doubled to 2px. Text stays Ink.
- **Mode choice:** a radio wrapped in an 8px Data Page box with a Rule border, 7px 12px; when checked the border turns teal and doubles.

### Cards / Containers
- **Code sheet:** Data Page fill, 1px Rule border, 10px corners, 14px 16px padding, OCR-B at 0.8rem, wraps rather than scrolls sideways; the embed tag a visitor copies spans full width and is never clipped.
- **No content cards.** Sections and groups are ruled ledgers (see Shapes).

### Inputs / Fields
- **Style:** Data Page fill, 1px Rule border, 8px corners, 9px 12px, 0.95rem; selects carry an inline ink chevron and 36px right padding.
- **Focus:** border turns teal with the global teal outline at 1px offset.
- **Status:** a line below the form, teal when the model answered, red when it failed.

### Navigation
- **Rail:** wordmark left (wide Archivo), links right in Faded Ink at 0.94rem without underline; hover returns to Ink and underlines. The language switch is Ink at 600. Below 640px the rail stacks.

### Passport data page (signature)
The visitor's browser as an identity document: Data Page sheet at 125:88, 14px corners, document lift, -0.6deg tilt, live guilloché behind the content. A head row (bilingual title, type, issuing code) closed by a Rule hairline; a body with the portrait (the visitor's canvas and WebGL renders, pixelated, framed by a 1px inset rule) and a two-column field list (condensed labels over heavy uppercase values, the print number and issue time in OCR-B); and the MRZ under a Soft Rule. Every field is real data; nothing on the page is placeholder decoration once the signals arrive.

### Entry stamp (signature)
An SVG rubber stamp pressed onto the passport when the verdict lands: double rounded frame, "NOTABOT · BORDER CONTROL" and the date in small tracked caps, the verdict word in Archivo 820 at width 112%, squeezed to the frame when long. Ink by verdict: teal admitted, violet secondary, red refused, Faded Ink for error. It enters with the press animation (620ms, from 1.55 scale and 4px blur to -9deg rest); with reduced motion it appears at once.

**The Real Verdict Rule.** A stamp is printed only for an actual verdict, in the ink of that verdict. No decorative, sample or preview stamps.

### Checkpoint line (signature)
Four steps (signals, cross-check, proof of work, model) on a 2px Rule track with a 10px dot per step. Done steps turn the track and dot teal and the label Ink; the current step's teal-ringed dot travels along its segment (1.2s loop). With reduced motion the marker parks at the segment's centre.

### Ledger row (signature)
A signal in a ruled table: the field name (600) with its "what it reveals" caption below (0.84rem Faded Ink), the value in OCR-B, and the privacy level badge right-aligned. When a rule raised on a value, the contradicting part turns red and a red "raised by" note names the rule.

### Inspection desk (`<notabot-check>`)
The embeddable widget, restyled by the host only through its `--notabot-*` custom properties. On this site it maps to the world: `--notabot-bg` Data Page, `--notabot-fg` Ink, `--notabot-muted` Faded Ink, `--notabot-border` Rule, `--notabot-accent` teal, `--notabot-warn` violet, `--notabot-bad` red, `--notabot-font` Archivo, `--notabot-radius` 12px, at most 380px wide, forced to the light theme. Inside: a 30px seal (7px corners, 2px border) that spins while checking, fills with the accent and a check when human, shows a red cross when refused; a status line in the state's ink; an optional slider challenge (34px track, dashed warn target zone, ink handle); and a disclosure of details. Its standalone defaults (a neutral light palette and a dark palette for `theme="auto"` or `"dark"`) belong to the package for hosts that set nothing, not to this site's world.

## Do's and Don'ts

### Do:
- **Do** separate rows and groups with 1px Rule hairlines and a Data Page tone step, never with cards or shadows.
- **Do** set every machine value (signal values, rule ids, levels, MRZ, code, timestamps) in OCR-B with ligatures off and tabular numerals.
- **Do** keep colour in strokes: guilloché at 22% to 26% opacity, link underlines, outlines, markers, stamp ink.
- **Do** map any embedded `<notabot-check>` to the site tokens through the `--notabot-*` variables rather than styling its internals.
- **Do** give each passport or ledger field its caption saying what it reveals and what it costs in privacy.
- **Do** use the house easing (cubic-bezier(0.16, 1, 0.3, 1)) for state transitions, and collapse animation to near-instant under reduced motion.
- **Do** keep the guilloché rosette centres off the page so only their rings cross it.

### Don't:
- **Don't** use Refusal Red (#b3302a) for anything but the refused verdict and the contradictions that caused it.
- **Don't** colour running text, headings or labels teal or violet; states may colour a status line or a value, prose stays in ink.
- **Don't** cast a shadow on anything but the passport.
- **Don't** set labels, headings or prose in OCR-B, and don't introduce another monospace.
- **Don't** print a stamp that does not carry a real verdict.
- **Don't** drift into the hacker-terminal look (dark screens, green glyphs) or the dev-tool landing (headline, demo card, feature grid).
