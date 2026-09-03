/// <reference path="./hello.d.ts" />

/**
 * Cabin Analytics Script
 * withcabin.com
 * @version 0.6.0
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

	const BANDS = 10 // the content block is split into deciles
	const BAND_MS = 1000 // time a band must be on screen before it counts as read
	const TICK_MS = 250 // how often dwell time is sampled

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

	let maxDepth: number // deepest point reached this pageview, 0-1
	let bandTime: number[] // ms each band has spent on screen
	let mode: number
	let content: Element | null
	let lastSample: number
	let scrolled: boolean
	let interacted: boolean
	let queued: boolean

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
				`Cabin is blocked on ${loc.hostname} - Use cabin.blockMe(false) to unblock`
			)
		}
		return blocked
	}

	const getLoadTime = (): number => {
		if (perf?.getEntriesByType) {
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

	const docHeight = (): number => {
		const body = document.body
		const html = document.documentElement
		return Math.max(
			body ? body.scrollHeight : 0,
			body ? body.offsetHeight : 0,
			html.scrollHeight,
			html.offsetHeight
		)
	}

	// The slice of the page that counts as content. Headers barely matter, they
	// sit at depth 0 where they hardly move the number, but footers do: a
	// newsletter block and related posts can be a quarter of the document, so a
	// full read of the article would report as 75% and no two pages would be
	// comparable. Measured fresh every sample because lazy images grow the box.
	const contentRange = (): number[] => {
		const y = window.scrollY

		if (!content || !content.isConnected) {
			// Two queries, not one combined selector: querySelector returns the
			// first match in document order, so an <article> above the tagged
			// element would beat the customer's explicit choice.
			content = document.querySelector(`[${CONTENT_ATTR}]`)
			mode = MODE_ATTR
			if (!content) {
				content = document.querySelector('article, main, [role=main]')
				mode = MODE_MAIN
			}
		}

		if (content) {
			const box = content.getBoundingClientRect()
			if (box.height > 0) return [box.top + y, box.height]
		}

		// No content element, or it is hidden. Trim at the footer if there is
		// one, which recovers most of the accuracy for a single extra query.
		const height = docHeight()
		const foot = document.querySelector('footer')
		const end = foot ? foot.getBoundingClientRect().top + y : 0

		if (end > 0 && end < height) {
			mode = MODE_FOOT
			return [0, end]
		}

		mode = MODE_DOC
		return [0, height]
	}

	// Reached depth only ever rises, so scrolling back up never lowers it.
	// Dwell is the opposite: a band re-entered collects more time and is more
	// likely to qualify as read. Together they separate a reader from someone
	// who flicked to the bottom, which neither number does on its own.
	const sample = (): void => {
		const t = now()
		// Background tabs throttle timers to once a minute, so cap what a late
		// tick can contribute rather than dumping the whole gap into a band.
		const elapsed = Math.min(t - lastSample, TICK_MS * 2)
		lastSample = t

		if (document.hidden) return

		const range = contentRange()
		const top = range[0]
		const height = range[1]
		if (height <= 0) return

		const y = window.scrollY
		const start = (y - top) / height
		// iOS Safari collapses its toolbar as you scroll, which makes
		// innerHeight grow mid-scroll and can push this past 1.
		const end = Math.min(1, (y + window.innerHeight - top) / height)

		if (end > maxDepth) maxDepth = end

		const from = Math.max(0, Math.floor(start * BANDS))
		const to = Math.min(BANDS, Math.ceil(end * BANDS))
		for (let i = from; i < to; i++) {
			bandTime[i] += elapsed
		}
	}

	const scrollData = (): ScrollData => {
		sample()

		let bits = 0
		for (let i = 0; i < BANDS; i++) {
			if (bandTime[i] >= BAND_MS) bits |= 1 << i
		}

		// Nothing scrolled and nothing could: a page shorter than the viewport,
		// or a site that scrolls an inner element instead of the window. Report
		// that as unmeasured rather than as a perfect read.
		const measured = scrolled || docHeight() > window.innerHeight + 4

		return {
			sd: measured ? Math.round(maxDepth * 100) : -1,
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

		maxDepth = 0
		bandTime = new Array(BANDS).fill(0)
		mode = MODE_NONE
		content = null
		lastSample = startTime
		scrolled = false
		interacted = false

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
		if (window.disableCabin) return

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

	// Track visibility changes for accurate duration
	document.addEventListener('visibilitychange', () =>
		document.hidden ? addDuration() : (snapshot = now())
	)

	// The interval gives dwell its clock. The scroll handler only flags that a
	// scroll happened and asks for an extra sample, so a fast scroll that
	// starts and ends inside one tick still registers its depth.
	window.addEventListener(
		'scroll',
		() => {
			scrolled = true
			interacted = true

			if (!queued) {
				queued = true
				requestAnimationFrame(() => {
					queued = false
					sample()
				})
			}
		},
		{ passive: true }
	)

	window.addEventListener('keydown', () => (interacted = true), {
		passive: true,
	})

	setInterval(sample, TICK_MS)

	// Send duration before page unload
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

		const target = (e.target as Element)?.closest(`[${DATA_EVENT_ATTR}]`)
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

			callback?.()
		},

		blockMe(block: boolean): void {
			storage.set(STORAGE_KEY, block ? '1' : '0')
			console.log(
				`Cabin is now ${block ? 'blocked' : 'unblocked'} on ${loc.hostname}`
			)
		},
	}

	// Initial pageview
	pageview()
})(window, document, '{{.Host}}')
