# Size compared to other analytics scripts

Measured over the wire on **2026-09-22**, from each vendor's own CDN, with the encoding
each one actually serves. Brotli where offered, gzip otherwise, because that is what a
real visitor downloads.

| Service                   |     Raw |   gzip |    brotli |
| ------------------------- | ------: | -----: | --------: |
| **Cabin**                 |   3,751 |  1,988 | **1,958** |
| Plausible                 |   2,841 |  1,283 |     1,271 |
| Fathom                    |   6,981 |  2,090 |     2,100 |
| Simple Analytics          |   7,515 |  3,883 |     3,902 |
| Matomo                    |  83,916 | 28,130 |    26,702 |
| Google Analytics (gtag)   | 242,913 | 89,838 |    88,697 |
| Google Analytics (legacy) |  52,310 | 20,802 |         — |

Plausible is smaller than Cabin and does less: no scroll depth, no carbon or energy
measurement. Fathom and Simple Analytics are larger. Matomo is roughly fourteen times
Cabin, and gtag is around forty-five.

Legacy `analytics.js` serves no brotli, so gzip is its real number.

## Re-measuring

```sh
curl -s -A Mozilla -H 'Accept-Encoding: br' <url> | wc -c
```

Swap `br` for `gzip` or `identity`. The `Accept-Encoding` header has to be explicit:
curl sends none by default, so without it every row reads as raw.

Badges were used here before and were quietly wrong for a long time. Matomo's
`static.matomo.org/piwik.js` stopped resolving, Kissmetrics started returning 403, and
the table mixed gzip and brotli between rows, so it compared Cabin's gzip against a
competitor's brotli. A dated measurement goes stale honestly; a broken badge does not.
