# Cabin client script

The tracking script for [withcabin.com](https://withcabin.com), privacy-first and
carbon-aware web analytics. No cookies, no fingerprint, no visitor identifier.

Served from `https://scripts.withcabin.com/hello.js`. This repository is the source
for that file, and `dist/hello.js` here is byte-for-byte what the CDN serves, so you
can read exactly what runs on your site.

```html
<script src="https://scripts.withcabin.com/hello.js" async defer></script>
```

[![version](https://img.shields.io/badge/dynamic/json?url=https://raw.githubusercontent.com/withcabin/hello.js/main/package.json&label=version&query=version&color=green)](package.json)
![raw](https://img.badgesize.io/https://scripts.withcabin.com/hello.js?label=raw)
![gzip](https://img.badgesize.io/https://scripts.withcabin.com/hello.js?compression=gzip&label=gzip)
![brotli](https://img.badgesize.io/https://scripts.withcabin.com/hello.js?compression=brotli&label=brotli)

See [BENCHMARKS.md](BENCHMARKS.md) for how that compares.

## Development

```sh
pnpm dev     # dev server on localhost:8000, serving tests.html
pnpm build   # typecheck, then minify to dist/hello.js
pnpm size    # gzipped byte count
```

`tests.html` exercises events, campaigns and scroll depth. `?layout=` switches between
window scrolling, an app shell, a growing feed, a short page and a scrolling sidebar;
`?content=` switches how the content block is exposed.

The source is written with terser's compression and mangling in mind, so some of it
looks unusual.

## Measuring scroll depth

**What is measured.** Depth is taken against the page's content block, not the whole
document, so a tall footer doesn't report a full read as 75%. The lookup order is:

1. `[data-cabin-content]`, if you have tagged an element
2. the first `<article>` or `<main>`
3. the document, trimmed at `<footer>`
4. the whole document

Which one applied is sent as `sm`, so a page measured against the whole document can be
treated as less trustworthy than one that was tagged. A content block shorter than the
viewport is skipped, because a block entirely on screen can only ever divide out to 100%.

**What scrolls.** Most sites scroll the window. App layouts often scroll a panel
instead, and those are followed automatically: the first element to scroll that covers
at least half the viewport in both directions is used, which keeps sidebars and menus
out of it. If nothing has scrolled and the window can't, the panel is found from the
element stack at the centre of the viewport. Override it with `[data-cabin-scroll-root]`
when the guess can't work.

The two attributes answer different questions and are independent: the scroll root is
where the scrollbar is, the content block is the part inside it that counts. Most sites
need neither.

```html
<div data-cabin-scroll-root>
	<article data-cabin-content>...</article>
	<footer>tall, shouldn't count</footer>
</div>
```

**On pages that grow.** Feeds and "load more" pages change the total while the visitor
reads, so the percentage falls when new content arrives and climbs back as they read it.
It stays a true reading of how far they got through what had loaded, but count an event
on the button if you want to know how deep people went.
