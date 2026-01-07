declare interface Window {
	cabin: {
		event: (value: string, callback?: () => void) => Promise<void>
		blockMe: (block: boolean) => void
	}
	disableCabin?: boolean
}
