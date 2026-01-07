## Key Changes in v0.6.0

### Critical Fixes

- **Weak bot detection** - Expanded regex to include headless browsers (`phantom`, `lighthouse`, `pagespeed`)
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