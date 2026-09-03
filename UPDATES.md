## Unreleased: scroll depth

Not versioned yet, since 0.6.0 has not reached the CDN. Decide the bump when it does.

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