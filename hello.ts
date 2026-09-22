/// <reference path="./hello.d.ts" />

/**
 * Cabin Analytics Script
 * withcabin.com
 * @version 0.6.2
 */

interface CabinData {
	r: string // referrer
	w: number // screen width
	t: number // load time
	p: string // page URL
	u?: number // domain visit count
	up?: number // page visit count
}

interface ScrollData {
	sd: number // deepest point reached, 0-100, or -1 when not measurable
	sb: number // read bands, one bit per decile of the content block
	sm: number // how the content range was found, see MODE_* below
	i: number // 1 if the visitor scrolled, clicked or typed
}

interface DurationData extends Partial<ScrollData> {
	d: number // duration
	n: number // start timestamp
	p: string // page URL
}

interface EventData extends DurationData {
	e: string // event name
}

interface Cabin {
	event: (value: string, callback?: () => void) => Promise<void>
	blockMe: (block: boolean) => void
}

;(function (window: Window, document: Document, host: string): void {
	const nav = window.navigator
	const loc = window.location
	const perf = window.performance
	const screen = window.screen

	// Kill requests from bots, spiders, and synthetic performance tools.
	//
	// `headless` is deliberately NOT in this list. Agentic browsers (ChatGPT
	// Atlas, Operator, computer-use) run headless Chrome and DO execute this
	// script, so they are the only AI traffic a client-side script can ever
	// see — the high-volume crawlers (GPTBot, ClaudeBot, PerplexityBot, CCBot)
	// never run JavaScript at all. Killing `headless` here would blind the
	// dashboard's AI Agents section to the one category it can measure.
	//
	// Nothing is lost by omitting it: the server drops generic headless
	// scrapers via isbot(), and classifies named AI agents via detectAiBot()
	// which runs first. See cabin/lambdas/logVisits/modules/aiBots.js.
	if (/bot|spider|crawl|phantom|lighthouse|pagespeed/i.test(nav.userAgent)) {
		return
	}

	const STORAGE_KEY = 'cabin_blocked'
	const DATA_EVENT_ATTR = 'data-cabin-event'
	const CONTENT_ATTR = 'data-cabin-content'
	const SCROLL_ATTR = 'data-cabin-scroll-root'

	const BANDS = 10 // the content block is split into deciles
	const BAND_MS = 1000 // time a band must be on screen before it counts as read

	// How the content range was found, sent as `sm` so the dashboard knows how
	// much to trust a page's depth and support can see why one looks odd.
	const MODE_NONE = 0 // nothing scrollable, depth not measured
	const MODE_DOC = 1 // whole document, footer included
	const MODE_FOOT = 2 // document trimmed at the footer
	const MODE_MAIN = 3 // <article>, <main> or [role=main]
	const MODE_ATTR = 4 // element carrying data-cabin-content

	// Use custom domain if provided, otherwise default
	const baseUrl =
		'https://' + (host.startsWith('{') ? 'ping.withcabin.com' : host)

	let startTime: number
	let snapshot: number
	let duration: number

	let maxBottom: number // deepest pixel reached, in the scroller's coordinates
	let bandTime: number[] // ms each band has spent on screen
	let mode: number
	let content: Element | null
	let contentMode: number // how `content` was found, applied only when it is used
	let contentTop: number // content range as of the last measurement
	let contentHeight: number
	let scroller: Element | null // the pane that scrolls, null for the window
	let pinned: boolean // scroller came from the attribute, so never guess over it
	let lastSample: number
	let bandFrom: number
	let bandTo: number
	let interacted: boolean
	let queued: boolean
	let sent: boolean

	// Safe localStorage access (handles private browsing)
	const storage = {
		get(key: string): string | null {
			try {
				return window.localStorage.getItem(key)
			} catch {
				return null
			}
		},
		set(key: string, value: string): void {
			try {
				window.localStorage.setItem(key, value)
			} catch {
				// Silently fail in private browsing
			}
		},
	}

	const isBlocked = (logMessage = false): boolean => {
		const blocked = storage.get(STORAGE_KEY) === '1'
		if (blocked && logMessage) {
			console.log(
				`Cabin is blocked on ${loc.hostname}. cabin.blockMe(false) to unblock`
			)
		}
		return blocked
	}

	const getLoadTime = (): number => {
		if (perf && perf.getEntriesByType) {
			const navEntry = perf.getEntriesByType('navigation')[0] as
				| PerformanceNavigationTiming
				| undefined
			if (navEntry) {
				return Math.round(navEntry.domContentLoadedEventEnd)
			}
		}
		return 0
	}

	const buildParams = (data: Record<string, string | number>): string => {
		return Object.entries(data)
			.map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
			.join('&')
	}

	const cleanReferrer = (referrer: string): string => {
		if (!referrer) return ''
		try {
			const url = new URL(referrer)
			return url.origin + url.pathname
		} catch {
			return ''
		}
	}

	const sendXHR = (url: string, logBlocked = false): Promise<number> => {
		if (isBlocked(logBlocked)) {
			return Promise.resolve(0)
		}

		return new Promise(resolve => {
			const xhr = new XMLHttpRequest()
			xhr.onreadystatechange = (): void => {
				if (xhr.readyState === 4) {
					resolve(parseFloat(xhr.response) || 0)
				}
			}
			xhr.onerror = (): void => resolve(0)
			xhr.open('GET', url)
			xhr.send()
		})
	}

	const sendBeacon = (url: string, data: DurationData | EventData): void => {
		if (isBlocked()) return

		if (nav.sendBeacon) {
			nav.sendBeacon(url, JSON.stringify(data))
		} else {
			// Fallback for older browsers
			sendXHR(
				`${url}?${buildParams(
					data as unknown as Record<string, string | number>
				)}`
			)
		}
	}

	const now = (): number => Date.now()

	const addDuration = (): void => {
		duration += now() - snapshot
	}

	// Everything below reads its geometry through these four, so the same code
	// measures a window-scrolled page and an app-shell pane. `scroller` is null
	// for the window, which is still the common case.
	//
	// scrollingElement is <body> in quirks mode and <html> everywhere else,
	// which is the only difference the old four-way Math.max was papering over,
	// and it cannot be null the way document.body can be mid-parse.
	const docHeight = (): number =>
		(scroller || document.scrollingElement || document.documentElement)
			.scrollHeight

	const viewHeight = (): number =>
		scroller ? scroller.clientHeight : window.innerHeight

	const scrollTop = (): number => (scroller ? scroller.scrollTop : window.scrollY)

	// getBoundingClientRect is viewport-relative, but depth is measured in the
	// scroller's own coordinates, so a pane that starts below a fixed header has
	// to have that offset taken back off.
	const originTop = (): number =>
		scroller ? scroller.getBoundingClientRect().top : 0

	// A pane counts as the page's scroller only if it covers most of the viewport
	// in both directions. Sidebars, comboboxes, code blocks and date pickers all
	// scroll, and adopting one of those would measure read depth against a menu.
	const bigEnough = (el: Element): boolean =>
		el.clientHeight * 2 >= window.innerHeight &&
		el.clientWidth * 2 >= window.innerWidth

	// The window has nowhere to scroll and nothing has scrolled yet, so nothing
	// has told us which pane holds the page. Without this, an app shell only ever
	// measured visitors who scrolled: everyone who read the first screen and left
	// reported unmeasurable, which is precisely the shallow end of the
	// distribution, and the average would have been biased upwards by its
	// absence. Asking what sits under the middle of the viewport answers it in
	// one call — on an app shell that stack is the content pane and its
	// ancestors, and the pane is the first of them with somewhere to scroll.
	const findScroller = (): void => {
		// An SPA route change can unmount the pane under us.
		if (scroller && !scroller.isConnected) scroller = null

		if (scroller || pinned || docHeight() > viewHeight() + 4) return

		const stack = document.elementsFromPoint(
			window.innerWidth / 2,
			window.innerHeight / 2
		)
		for (let i = 0; i < stack.length; i++) {
			const el = stack[i]
			// Overflowing is not the same as scrolling. An `overflow: hidden`
			// wrapper, which every app shell has several of, also reports
			// scrollHeight above clientHeight, and adopting one would pin scrollTop
			// at 0 and report the first screen as the whole visit — a fresh wrong
			// number in place of the honest -1 this is meant to replace. Only the
			// computed style can tell the two apart. Elements arrive innermost
			// first, so the pane is found before its ancestors.
			//
			// Matched on the first letter because the scrolling values are scroll,
			// auto and overlay, against visible, hidden and clip. Current Chrome
			// normalises `overlay` to `auto` so spelling out `auto|scroll` works
			// today, but it did not always, and this costs the same bytes.
			if (
				el.scrollHeight > el.clientHeight + 4 &&
				/^[sao]/.test(getComputedStyle(el).overflowY) &&
				bigEnough(el)
			) {
				scroller = el
				return
			}
		}
	}

	// Dwell is credited to the range that was on screen since the last
	// measurement, and only then is the range recomputed. That is exact without
	// a timer: the visible range changes when the page scrolls or reflows, so
	// measuring on scroll and once more at send time covers every state, and it
	// attributes the elapsed time to where the visitor actually was rather than
	// to where they have just arrived.
	//
	// Reached depth only ever rises, so scrolling back up never lowers it. Dwell
	// is the opposite: a band re-entered collects more time and is more likely to
	// qualify as read. Together they separate a reader from someone who flicked
	// to the bottom, which neither number does on its own.
	//
	// What rises is the deepest PIXEL reached, not the deepest percentage. Those
	// are the same thing only while the content block keeps its height, and it
	// often does not: a feed that appends on scroll, a virtualized list, a
	// "load more" button. Banking the ratio meant the maximum was set against
	// whatever the smallest denominator of the visit had been, so a feed holding
	// one screen at first paint locked in 100% and stayed there however far it
	// grew. Keeping the pixel and dividing once, at send time, against the final
	// height, reports two screens out of an eventual ten as 20%.
	const measure = (): void => {
		const t = now()
		for (let i = bandFrom; i < bandTo; i++) {
			bandTime[i] += t - lastSample
		}
		lastSample = t

		findScroller()

		const y = scrollTop()
		const vh = viewHeight()
		const origin = originTop()
		let top = 0
		let height = 0

		// The slice of the page that counts as content. Headers barely matter,
		// they sit at depth 0 where they hardly move the number, but footers do: a
		// newsletter block and related posts can be a quarter of the document, so
		// a full read of the article would report as 75% and no two pages would be
		// comparable. Re-read every time because lazy images grow the box.
		if (!content || !content.isConnected) {
			// Two queries, not one combined selector: querySelector returns the
			// first match in document order, so an <article> above the tagged
			// element would beat the customer's explicit choice.
			content = document.querySelector(`[${CONTENT_ATTR}]`)
			contentMode = MODE_ATTR
			if (!content) {
				content = document.querySelector('article, main')
				contentMode = MODE_MAIN
			}
		}

		// `mode` is set from the branch that actually supplies the range, not from
		// the lookup. A page whose content block starts short and grows - a feed,
		// a lazy-loaded article - takes the fallback on its first measurement and
		// the content block later, and the element is cached across both, so
		// setting it at the lookup left `sm` reporting the fallback for the rest
		// of the visit and undercounting `trusted`.
		if (content) {
			const box = content.getBoundingClientRect()
			top = box.top - origin + y
			height = box.height
			mode = contentMode
		}

		// No content element, it is hidden, or it is shorter than the viewport.
		// That last one is the one that used to lie: a block entirely on screen
		// can only ever divide out to 100%, so a stub <main> under a tall nav and
		// a tall footer reported a glance as a complete read, and reported it as
		// trusted. Trim at the footer instead, which recovers most of the accuracy
		// for a single extra query, and fall back to the whole document.
		if (height <= vh) {
			const foot = document.querySelector('footer')
			const cut = foot ? foot.getBoundingClientRect().top - origin + y : 0
			top = 0
			height = docHeight()
			mode = MODE_DOC
			if (cut > 0 && cut < height) {
				height = cut
				mode = MODE_FOOT
			}
		}

		// iOS Safari collapses its toolbar as you scroll, which makes innerHeight
		// grow mid-scroll and can push this past 1.
		const bottom = y + vh
		if (bottom > maxBottom) maxBottom = bottom
		contentTop = top
		contentHeight = height

		const end = Math.min(1, (bottom - top) / height)
		bandFrom = Math.max(0, Math.floor(((y - top) / height) * BANDS))
		bandTo = Math.ceil(end * BANDS)
	}

	const scrollData = (): ScrollData => {
		measure()

		let bits = 0
		for (let i = 0; i < BANDS; i++) {
			if (bandTime[i] >= BAND_MS) bits |= 1 << i
		}

		// Nothing could scroll: a page shorter than the viewport. An app-shell
		// pane answers this for itself now rather than reporting the window's
		// static viewport, so the whole layout is no longer unmeasurable.
		const measured = docHeight() > viewHeight() + 4
		const depth = Math.min(
			1,
			Math.max(0, (maxBottom - contentTop) / contentHeight)
		)

		return {
			sd: measured ? Math.round(depth * 100) : -1,
			sb: measured ? bits : 0,
			sm: measured ? mode : MODE_NONE,
			i: interacted ? 1 : 0,
		}
	}

	let isInitialPageview = true

	const pageview = async (): Promise<void> => {
		if (window.disableCabin) {
			delete window.disableCabin
			return
		}

		startTime = Date.now()
		snapshot = startTime
		duration = 0

		maxBottom = 0
		bandTime = new Array(BANDS).fill(0)
		mode = MODE_NONE
		content = null
		contentMode = MODE_NONE
		contentTop = 0
		contentHeight = 1
		// An explicit root always wins, and is re-read per pageview because an SPA
		// route change can swap the pane. Everything else waits for the first
		// scroll to say which element moved.
		scroller = document.querySelector(`[${SCROLL_ATTR}]`)
		pinned = !!scroller
		lastSample = startTime
		bandFrom = 0
		bandTo = 0
		interacted = false
		sent = false

		const hostname = loc.hostname
		const pathname = loc.pathname
		const cacheUrl = `${baseUrl}/cache?`

		// Only send referrer on first pageview, not SPA navigations
		const ref = document.referrer
		let cleanRef = ''
		if (isInitialPageview && ref) {
			try {
				const u = new URL(ref)
				cleanRef = u.origin + u.pathname
			} catch {}
		}
		isInitialPageview = false

		const data: CabinData = {
			r: cleanRef,
			w: screen.width,
			t: getLoadTime(),
			p: loc.href,
		}

		try {
			const [domainVisits, pageVisits] = await Promise.all([
				sendXHR(cacheUrl + hostname),
				sendXHR(cacheUrl + hostname + pathname),
			])

			data.u = domainVisits
			data.up = pageVisits

			sendXHR(
				`${baseUrl}/hello?${buildParams(
					data as unknown as Record<string, string | number>
				)}`,
				true
			)
		} catch {
			// Silently fail if requests error
		}
	}

	const sendDuration = (): void => {
		if (window.disableCabin || sent) return
		sent = true

		if (!document.hidden) {
			addDuration()
		}

		const data: DurationData = {
			d: duration,
			n: startTime,
			p: loc.href,
		}

		sendBeacon(`${baseUrl}/duration`, Object.assign(data, scrollData()))
	}

	// Track visibility changes for accurate duration, and treat the first hide
	// as the last reliable chance to report. Mobile Safari frequently never
	// fires beforeunload, so a reader who switches apps and never comes back
	// used to be lost entirely, and they are exactly the engaged visit the
	// scroll fields are there to describe.
	document.addEventListener('visibilitychange', () => {
		if (document.hidden) {
			addDuration()
			sendDuration()
		} else {
			snapshot = lastSample = now()
		}
	})

	// Scroll events do not bubble, but they do reach a capture-phase listener on
	// document, so this one listener sees a window scroll and a scroll inside any
	// pane alike. That matters because the app-shell layout — fixed header, fixed
	// sidebar, one overflow-y content div — is what Nuxt UI, shadcn, Tailwind UI,
	// Radix and Mantine all hand you by default. Those sites never move window
	// scroll position, so every visit to them used to report as unmeasurable.
	document.addEventListener(
		'scroll',
		(e: Event) => {
			interacted = true

			// The window's own scroll targets the document, which has no
			// clientHeight, so it falls out of bigEnough and leaves the current
			// choice alone.
			const el = e.target as Element
			if (!pinned && el !== document.scrollingElement && bigEnough(el)) {
				scroller = el
			}

			// One measurement per frame at most: any more would be reading
			// layout faster than the browser can paint it.
			if (!queued) {
				queued = true
				requestAnimationFrame(() => {
					queued = false
					measure()
				})
			}
		},
		{ capture: true, passive: true }
	)

	window.addEventListener('keydown', () => (interacted = true), {
		passive: true,
	})

	// Belt and braces. All three paths run through the same guard, so whichever
	// the browser honours first wins and the rest are no-ops.
	window.addEventListener('pagehide', sendDuration)
	window.addEventListener('beforeunload', sendDuration)

	// Handle SPA navigation via pushState
	const originalPushState = history.pushState.bind(history)
	history.pushState = function (...args: Parameters<typeof history.pushState>) {
		const result = originalPushState(...args)
		sendDuration()
		pageview()
		return result
	}

	// Also handle popstate for back/forward navigation
	window.addEventListener('popstate', () => {
		sendDuration()
		pageview()
	})

	// Event delegation for data-cabin-event attributes
	document.addEventListener('click', (e: MouseEvent) => {
		interacted = true

		const el = e.target as Element | null
		const target = el && el.closest(`[${DATA_EVENT_ATTR}]`)
		if (target) {
			const eventName = target.getAttribute(DATA_EVENT_ATTR)
			if (eventName) {
				window.cabin.event(eventName)
			}
		}
	})

	// Global cabin object
	window.cabin = {
		async event(value: string, callback?: () => void): Promise<void> {
			addDuration()

			sendBeacon(`${baseUrl}/event`, {
				e: value,
				p: loc.href,
				d: duration,
				n: startTime,
			})

			if (callback) callback()
		},

		blockMe(block: boolean): void {
			storage.set(STORAGE_KEY, block ? '1' : '0')
			// Deliberately phrased to share as much text as possible with the
			// message above: on a gzipped file, repetition is cheaper than brevity.
			console.log(`Cabin is ${block ? '' : 'un'}blocked on ${loc.hostname}`)
		},
	}

	// Initial pageview
	pageview()
})(window, document, '{{.Host}}')
