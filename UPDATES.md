## Key Changes in v0.6.2: scroll depth on app-shell layouts

0.6.1 measured scroll depth against the window. Two whole classes of site got nothing
useful out of that, and one of them got a confidently wrong number.

### The window is no longer assumed to be what scrolls

Scroll events do not bubble, but they do reach a capture-phase listener on `document`,
so one listener now sees a window scroll and a scroll inside any pane alike. The first
pane to scroll becomes the page's scroller, and every measurement reads its
`scrollTop`, `clientHeight`, `scrollHeight` and offset instead of the window's.

This matters because the app-shell layout - fixed header, fixed sidebar, one
`overflow-y: auto` content div - is what Nuxt UI, shadcn, Tailwind UI, Radix and
Mantine hand you by default. Those sites never move window scroll position, so under
0.6.1 every visit to one reported `sd: -1`.

A pane is only adopted if it covers at least half the viewport in both directions.
Sidebars, comboboxes, code blocks and date pickers scroll too, and adopting one of
those would measure read depth against a menu.

If nothing has scrolled and the window has nowhere to scroll, the pane is found from
the element stack under the middle of the viewport. Without that step an app shell
would only ever measure visitors who scrolled, which is exactly the shallow end of the
distribution, and its absence would bias the average upwards.

### New public attribute

- **`data-cabin-scroll-root`** - put it on the element that scrolls and it is used
  directly, no guessing. Re-read on every pageview so an SPA route change can swap it.
  Pairs with `data-cabin-content`, which still says what to measure; this one says what
  moves.

### Depth is banked as a pixel, not a percentage

`sd` still only rises. What rises is now the deepest pixel reached, divided once at
send time against the final content height, rather than a ratio maxed on the fly.

The two are the same thing only while the content block keeps its height, and often it
does not: a "load more" button, a virtualized list, a feed that appends on scroll.
Under 0.6.1 the maximum was set against the smallest denominator the visit ever saw, so
reaching the bottom of what existed banked 100% and nothing later could bring it down.

Measured: read to the end of a 2,521px article, then press Load More and let it grow to
7,993px. 0.6.1 reports **100%**. 0.6.2 reports **32%**, which is what the visitor
actually saw.

A note on what this does *not* fix, because it is easy to assume otherwise. A feed that
appends during the scroll is usually safe in both versions: the growth handler runs on
the same scroll event, before the script measures, so the short state is never sampled.
The exposure is growth that happens *after* a measurement, which is the Load More shape
above and the short-content case below.

### A content block shorter than the viewport no longer reports 100%

A block entirely on screen can only ever divide out to 100%, so a stub `<main>` under a
tall nav and a tall footer reported a glance as a complete read - and reported it with
`sm: 3`, i.e. as trusted. Content shorter than the viewport now falls through to the
footer-trimmed document, the same path an absent or hidden content element takes.

Measured: a 108px `<article>` at the top of a 1,924px document, never scrolled. 0.6.1
reports **100%, `sm: 3`**. 0.6.2 reports **57%, `sm: 2`**, which is the viewport over
the footer-trimmed document.

The block has to be on screen for this to bite. Pushed below the fold the sum comes out
negative and clamps to 0, which is why it survived this long without anyone noticing.

Expect `trusted` counts to fall on sites that were hitting this, and their averages to
fall with them. That is the correction landing, not a regression.

### `mode` follows the range that was used, not the lookup

The content element is cached across measurements but `mode` was set where the element
was looked up, so a page that took the fallback on its first measurement and the content
block afterwards kept reporting the fallback for the rest of the visit. `sm` described a
measurement that was not the one being sent, and `trusted` was undercounted. It only
shows up on a page whose content block starts short and grows, which is why it arrived
with the change above.

### `i` was always 0 on app-shell sites

Not a new fix so much as a consequence of the capture listener: the interaction flag was
set from a `window` scroll listener, so a visitor who scrolled a pane and nothing else
was recorded as never having interacted. Those sites have been reporting near-zero
interaction rates. Measured on the app-shell page: 0.6.1 sends `i: 0` after a 2,931px
scroll, 0.6.2 sends `i: 1`.

### Size

1,698 to 1,979 bytes gzip, 1,472 to 1,733 brotli, measured locally at maximum quality.
The viewport-centre pane lookup is 82 of those gzip bytes and can be dropped on its own
if the budget matters more than the unscrolled visits it recovers.

Re-measure `SCRIPT_SIZE` in the site's `shared/site.ts` from the CDN response once this
is uploaded. It is on 1.7 KB and this build will not still be 1.7 KB.

### Verified in a browser

`tests.html` gains `?layout=shell|pinned|feed|short|sidebar`, each rebuilding the page
before the script loads, and `?raf=timer` so it can be driven from automation (a
background tab never fires `requestAnimationFrame`, so only the measurement taken at
send time would survive). Seven scenarios were run against both builds; in every one
0.6.2's `sd` matched the reading computed by hand from the DOM:

| Scenario | 0.6.1 | 0.6.2 | Truth |
|---|---|---|---|
| App shell, read to 60% of the article | `-1` | 60 | 60 |
| App shell, never scrolled | `-1` | 0 | 0 |
| Short `<main>` at top, glanced at | 100 (`sm` 3) | 57 (`sm` 2) | 57 |
| Read to the end, then Load More triples it | 100 | 32 | 32 |
| Scrolling sidebar, window untouched | n/a | 0 | 0 |
| Pinned pane, stopped halfway | n/a | 64 | 64 |
| Ordinary article, stopped 40% in | 40 | 40 | 40 |

Two of the harness layouts needed fixing before they meant anything, and both are worth
knowing about when reading a scroll number: **scroll restoration** puts the browser back
where it was before the script has measured, which records as a full read, and Chrome's
**scroll anchoring** drags the window down when content is appended above other content.
Neither is a bug in the script - it reported the position the browser had actually put
the page in - but both make a reload-based test lie.

### No server change

The payload shape is unchanged: the same four fields, the same ranges, the same five
`sm` modes. Ingest clamps `sm` to 0-4, so a new mode for "measured inside a pane" would
have been silently rewritten to 4 and counted as trusted. Adding one is a two-sided
change and is deliberately not in this release.

---

## Key Changes in v0.6.1: scroll depth

0.6.0 never reached the CDN, so this supersedes it and ships both sets of changes at once.
The live file is still 0.5.10 (2,062 bytes, `last-modified` Feb 2025).

### New payload fields (on `/duration`, no new requests)

- **`sd`** - deepest point reached, 0-100, or `-1` when the page could not be measured
- **`sb`** - read bands: the content block is split into deciles and each one that spends `BAND_MS` (1s) or more on screen sets a bit, giving one integer 0-1023
- **`sm`** - how the content range was found: `0` unmeasured, `1` whole document, `2` trimmed at `<footer>`, `3` `<article>`/`<main>`/`[role=main]`, `4` `[data-cabin-content]`
- **`i`** - `1` if the visitor scrolled, clicked or typed

`sd` and `sb` answer different questions on purpose. `sd` only ever rises, so scrolling back up never lowers it, but on its own it cannot tell a reader from someone who flicked to the bottom. `sb` can: a band re-entered collects more dwell, so a skim leaves a high `sd` with almost no bits set, and a real read leaves a contiguous run.

### New public attribute

- **`data-cabin-content`** - put it on the element wrapping the real content and depth is measured against that element instead of the document. Needs documenting in cabin-docs.

### Why it is not measured against the document

A footer with a newsletter block and related posts is easily a quarter of the page, so measuring against `scrollHeight` reports a full read of the article as 75% and puts a fake cliff in the drop-off curve where the article merely ended. Worse, the distortion differs per page, so depths cannot be compared across pages. The lookup order is explicit attribute, then semantic element, then trim at `<footer>`, then give up and use the document, and `sm` records which one applied so the dashboard can keep untrusted pages out of any ranking.

### Not measurable

Pages shorter than the viewport, and sites that scroll an inner element rather than the window, report `sd: -1` rather than a fake 100%.

### Dwell has no timer

Time is credited to the band range that was on screen since the last measurement, and only then is the range recomputed. Scroll (rAF-throttled) and the send are the only triggers, so there is no polling interval, and elapsed time is attributed to where the visitor was rather than where they have just arrived. A hidden gap is discarded by resetting the clock on the way back.

### Delivery

Duration now also sends on `pagehide` and on the first `visibilitychange` to hidden, not only `beforeunload`, which mobile Safari frequently never fires. All three share a `sent` guard that resets per pageview. The trade-off is that the first hide wins: tab away at 5s, return and read for 3 minutes, and the visit records 5s. Dropping the guard needs the ingest side to treat `(p, n)` as an upsert.

---

## Key Changes in v0.6.0

### Critical Fixes

- **Weak bot detection** - Expanded regex to include synthetic performance tools (`phantom`, `lighthouse`, `pagespeed`). `headless` was trialled and deliberately left out: agentic browsers run headless Chrome and are the only AI traffic this script can see, and the server already drops generic headless scrapers via `isbot()`.
- **Deprecated `performance.timing`** - Replaced with Navigation Timing API Level 2 (`getEntriesByType('navigation')`)
- **Undefined `doc` variable** - Fixed reference error in pushState handler
- **Event listener leaks** - Replaced `initEvents()` with single event delegation pattern
- **Missing popstate handler** - Added handler for browser back/forward navigation
- **Fixed referrer being sent multiple times** - Now only sends the referrer on the first pageview

### Privacy & Security

- **Referrer PII risk** - Now strips query parameters from referrer to avoid leaking sensitive data

### Robustness

- **No error handling** - Added try/catch blocks and `.onerror` handlers for failed requests
- **localStorage throws in private browsing** - Wrapped in safe accessor that handles exceptions
- **Minification** - Improved terser configuration to optimize the script for size and performance
- **pnpm** - Switched to pnpm for package management

### Cleanup

- **Unused `data.s` placeholder** - Removed dead code
- **Removed `initEvents()` method** - No longer needed with event delegation
- **TypeScript rewrite** - Full type safety and improved maintainability
- **Build script** - Added build script to compile and minify the script
- **Removed deploy scripts** - Removed deploy scripts as we are using BunnyCDN now