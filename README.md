# Cabin client script

This is the client script for [withcabin.com](https://withcabin.com) - Privacy-first, carbon-aware web analytics.

The script is accessible via CDN at https://scripts.withcabin.com/hello.js

![Version number](https://img.shields.io/badge/dynamic/json?url=https://raw.githubusercontent.com/Normally/cabin-script/main/package.json&label=version&query=version&color=green) ![file size in bytes](https://img.badgesize.io/normally/cabin-script/main/dist/hello.js) ![file size in bytes](https://img.badgesize.io/normally/cabin-script/main/dist/hello.js?compression=gzip) ![file size in bytes](https://img.badgesize.io/normally/cabin-script/main/dist/hello.js?compression=brotli)

`yarn dev` - run a dev server and visit localhost:8000 to test the script locally

`yarn min` - minify the script to `/dist` with [terser](https://github.com/terser/terser)

`yarn deploy` - deploy to CDN and invalidate cache

## Measuring scroll depth

Depth is measured against the page's content block, not the whole document, so a tall
footer does not report a full read as 75%. The script looks for, in order:

1. `[data-cabin-content]` - put this on the element wrapping your content to be explicit
2. `<article>`, `<main>` or `[role=main]`
3. the document, trimmed at `<footer>` if there is one
4. the whole document

Which one applied is sent as `sm` on the duration payload, so a page measured against the
whole document can be treated as less trustworthy than one that was tagged.

Note: This script is written with a tacit knowledge of terser compression and mangle. Some of the script may look unusual but it is written to be compressed as effectively as possible to reduce file size.
