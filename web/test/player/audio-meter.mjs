// The output signal, metered (session 21) : an AudioWorklet node the suite hangs on the game's
// sound before the volume — window.ctrAudio.output (the SPU worklet), else SDL's
// ScriptProcessorNode (the output before session 21) — and silences after itself (gain 0). It
// counts dropouts — stretches of exact digital silence, 1 quantum to 500 ms long, between two
// stretches of sound — and repeats : a non-silent 128-frame quantum identical, sample for sample,
// to one of the 48 before it (6144 frames, three 2048-frame ScriptProcessor blocks). A
// ScriptProcessor the main thread filled too late plays an old block again (measured : no
// silence, the repeats) ; the game's own mix almost never repeats exactly, nor falls silent that
// briefly. Both paths are metered the same way, so the counts compare.
//
//   await installMeter(ctx)      → true once hung (false : no output yet)
//   await readMeter(ctx)         → { quanta, sampleRate, dropouts, droppedMs, list: [ms…], repeats }
//   await resetMeter(ctx)        starts a new window

const PROCESSOR = `
class CtrMeter extends AudioWorkletProcessor {
	constructor() {
		super()
		this.reset()
		this.signal = false
		this.zeroRun = 0
		this.port.onmessage = e => { if (e.data === 'reset') this.reset() }
	}
	reset() { this.quanta = 0; this.list = []; this.sent = 0; this.repeats = 0; this.repeatAt = []; this.hashes = new Float64Array(48) }
	process(inputs) {
		let zero = true
		for (const c of inputs[0]) { for (let i = 0; i < c.length; i++) if (c[i] !== 0) { zero = false; break } if (!zero) break }
		this.quanta++
		if (!zero) {
			let h = 0
			const c = inputs[0][0]
			for (let i = 0; i < c.length; i++) h = (h * 31 + c[i] * 1e6) % 1e15
			if (this.hashes.includes(h)) {
				this.repeats++
				if (this.repeatAt.length < 200) this.repeatAt.push(Math.round((currentFrame * 1000) / sampleRate))
			}
			this.hashes[this.quanta % 48] = h
		}
		if (zero) this.zeroRun++
		else {
			const ms = (this.zeroRun * 128 * 1000) / sampleRate
			if (this.signal && this.zeroRun > 0 && ms <= 500 && this.list.length < 5000) this.list.push(Math.round(ms * 10) / 10)
			this.zeroRun = 0
			this.signal = true
		}
		if (this.quanta - this.sent >= 128) { this.sent = this.quanta; this.port.postMessage({ quanta: this.quanta, sampleRate, list: this.list, repeats: this.repeats, repeatAt: this.repeatAt }) }
		return true
	}
}
registerProcessor('ctr-meter', CtrMeter)`

export const installMeter = ctx =>
	ctx.js(`return (async () => {
	if (globalThis.__ctrMeter) return true
	const A = globalThis.ctrAudio
	const sdl = globalThis.Module?.SDL3
	const context = A?.node ? A.context : sdl?.audioContext
	const source = A?.node ? A.output : sdl?.audio_playback?.scriptProcessorNode
	if (!context || !source) return false
	await context.audioWorklet.addModule(URL.createObjectURL(new Blob([${JSON.stringify(PROCESSOR)}], { type: 'text/javascript' })))
	const meter = new AudioWorkletNode(context, 'ctr-meter', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
	const sink = context.createGain()
	sink.gain.value = 0
	source.connect(meter)
	meter.connect(sink)
	sink.connect(context.destination)
	const M = (globalThis.__ctrMeter = { node: meter, last: { quanta: 0, sampleRate: context.sampleRate, list: [] } })
	meter.port.onmessage = e => { M.last = e.data }
	return true
})()`)

export const readMeter = ctx =>
	ctx.js(`const m = globalThis.__ctrMeter?.last; if (!m) return null; return { quanta: m.quanta, sampleRate: m.sampleRate, dropouts: m.list.length, droppedMs: Math.round(m.list.reduce((s, x) => s + x, 0)), list: m.list.slice(0, 40), repeats: m.repeats ?? 0 }`)

export const resetMeter = ctx => ctx.js(`globalThis.__ctrMeter?.node.port.postMessage('reset'); if (globalThis.__ctrMeter) globalThis.__ctrMeter.last = { quanta: 0, list: [], repeats: 0 }; return true`)
