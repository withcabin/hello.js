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

interface DurationData {
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

	// Kill requests from bots, spiders, and headless browsers
	if (
		/bot|spider|crawl|headless|phantom|lighthouse|pagespeed/i.test(
			nav.userAgent
		)
	) {
		return
	}

	const STORAGE_KEY = 'cabin_blocked'
	const DATA_EVENT_ATTR = 'data-cabin-event'

	// Use custom domain if provided, otherwise default
	const baseUrl =
		'https://' + (host.startsWith('{') ? 'ping.withcabin.com' : host)

	let startTime: number
	let snapshot: number
	let duration: number

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
	let isInitialPageview = true

	const pageview = async (): Promise<void> => {
		if (window.disableCabin) {
			delete window.disableCabin
			return
		}

		startTime = Date.now()
		snapshot = startTime
		duration = 0

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

		sendBeacon(`${baseUrl}/duration`, {
			d: duration,
			n: startTime,
			p: loc.href,
		})
	}

	// Track visibility changes for accurate duration
	document.addEventListener('visibilitychange', () =>
		document.hidden ? addDuration() : (snapshot = now())
	)

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
