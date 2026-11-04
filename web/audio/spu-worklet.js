// The SPU, in the AudioWorkletGlobalScope (the browser's audio thread) : audio/spu.wasm is
// platform/native_audio.c built as the worklet's copy (CTR_AUDIO_WORKLET, web/emscripten.cmake).
// The game posts its SPU commands (native_audio.c's recorder, through audio.js) as batches
// stamped with the main thread's performance.now() ; each batch is applied at the sample its
// stamp maps to plus a command buffer (bufferMs), then the voices, reverb and XA are mixed here
// for every render quantum. A main-thread stall delays commands, never the samples.
//
// Stamp → sample : offset = the least (arrival frame − stamp frame) seen, i.e. the quickest
// trip from the game to here ; it follows it down at once and up once per 2 s window (clock
// drift, a game that dropped VBlanks). A batch arriving later than its stamp + offset + buffer
// plays as it arrives, counted late ; batches always apply in order.
//
// Port messages : in { module | bytes, bufferMs, tickQuanta } (processorOptions), then
// { batch: [stamp, ArrayBuffer], startup } ; out every tickQuanta quanta
// [frame, xaSerial, xaActive, xaOutputFrame] (the game's XA position and the page's wake clock),
// and once a second { stats }.

const SPU_RATE = 44100
const WINDOW_S = 2

class CtrSpu extends AudioWorkletProcessor {
	constructor(options) {
		super()
		const o = options.processorOptions
		const module = o.module ?? new WebAssembly.Module(o.bytes)
		// the standalone wasm imports one hook (its views are re-made after each call anyway) ;
		// _initialize runs its static constructors
		this.wasm = new WebAssembly.Instance(module, { env: { emscripten_notify_memory_growth() {} } }).exports
		this.wasm._initialize?.()
		this.step = SPU_RATE / sampleRate // 1 : the context runs at the SPU's rate (audio.js asks for it)
		this.bufferFrames = Math.round((o.bufferMs * sampleRate) / 1000)
		this.tickQuanta = o.tickQuanta
		this.queue = []
		this.offset = null
		this.windowMin = Infinity
		this.windowEnd = 0
		this.lastAt = 0
		this.quanta = 0
		this.pcm = 0
		this.pcmFrames = 0
		this.feedback = this.wasm.NativeAudioWorklet_Alloc(16)
		this.phase = 0
		this.prev = [0, 0]
		this.stats = { quanta: 0, batches: 0, late: 0, worstLateMs: 0, lateAt: [], mixMs: 0 }
		this.statsEnd = currentFrame + sampleRate
		this.port.onmessage = e => this.receive(e.data)
	}

	receive(m) {
		if (!m.batch) return
		const [stamp, bytes] = m.batch
		// before the node existed, or while the context is suspended (no process() to play them
		// at their time) : the state follows at once, as SDL's did, instead of a burst on resume
		if (m.startup && !this.queue.length) {
			this.apply(bytes)
			return
		}
		const arrival = currentFrame
		const rel = arrival - (stamp * sampleRate) / 1000
		if (this.offset === null || rel < this.offset) this.offset = rel
		if (rel < this.windowMin) this.windowMin = rel
		let at = (stamp * sampleRate) / 1000 + this.offset + this.bufferFrames
		this.stats.batches++
		if (m.startup) at = arrival
		else if (at < arrival) {
			const ms = ((arrival - at) * 1000) / sampleRate
			this.stats.late++
			if (ms > this.stats.worstLateMs) this.stats.worstLateMs = ms
			if (this.stats.lateAt.length < 50) this.stats.lateAt.push([Math.round(stamp), Math.round(ms)])
			at = arrival
		}
		if (at < this.lastAt) at = this.lastAt
		this.lastAt = at
		this.queue.push({ at: Math.round(at), bytes })
	}

	apply(bytes) {
		const ptr = this.wasm.NativeAudioWorklet_Alloc(bytes.byteLength)
		new Uint8Array(this.wasm.memory.buffer, ptr, bytes.byteLength).set(new Uint8Array(bytes))
		this.wasm.NativeAudioWorklet_Apply(ptr, bytes.byteLength)
		this.wasm.NativeAudioWorklet_Free(ptr)
	}

	// frames of 44.1 kHz stereo s16 into this.pcm (grown as needed)
	render(frames) {
		if (frames > this.pcmFrames) {
			if (this.pcm) this.wasm.NativeAudioWorklet_Free(this.pcm)
			this.pcm = this.wasm.NativeAudioWorklet_Alloc(frames * 4)
			this.pcmFrames = frames
		}
		this.wasm.NativeAudioWorklet_Render(this.pcm, frames)
		return new Int16Array(this.wasm.memory.buffer, this.pcm, frames * 2)
	}

	// out[from, to) at the context's rate : direct when it is 44.1 kHz, else linear steps over
	// the SPU's samples (a browser that refused a 44.1 kHz context)
	mix(left, right, from, to) {
		const n = to - from
		if (n <= 0) return
		if (this.step === 1) {
			const s = this.render(n)
			for (let i = 0; i < n; i++) {
				left[from + i] = s[i * 2] / 32768
				right[from + i] = s[i * 2 + 1] / 32768
			}
			return
		}
		const need = Math.floor(this.phase + n * this.step)
		const s = need > 0 ? this.render(need) : null
		for (let i = 0; i < n; i++) {
			const p = this.phase + i * this.step
			const k = Math.floor(p)
			const f = p - k
			const a0 = k === 0 ? this.prev[0] : s[(k - 1) * 2]
			const a1 = k === 0 ? this.prev[1] : s[(k - 1) * 2 + 1]
			const b0 = k < need ? s[k * 2] : a0
			const b1 = k < need ? s[k * 2 + 1] : a1
			left[from + i] = (a0 + (b0 - a0) * f) / 32768
			right[from + i] = (a1 + (b1 - a1) * f) / 32768
		}
		if (need > 0) this.prev = [s[(need - 1) * 2], s[(need - 1) * 2 + 1]]
		this.phase = this.phase + n * this.step - need
	}

	process(inputs, outputs) {
		const out = outputs[0]
		const left = out[0]
		const right = out[1] ?? out[0]
		const n = left.length
		const t0 = Date.now()
		let pos = 0
		this.stats.quanta++
		while (pos < n) {
			while (this.queue.length && this.queue[0].at <= currentFrame + pos) this.apply(this.queue.shift().bytes)
			const next = this.queue.length ? Math.min(n, Math.max(pos + 1, this.queue[0].at - currentFrame)) : n
			this.mix(left, right, pos, next)
			pos = next
		}
		this.stats.mixMs += Date.now() - t0
		if (currentFrame >= this.windowEnd) {
			if (this.windowMin !== Infinity) this.offset = this.windowMin
			this.windowMin = Infinity
			this.windowEnd = currentFrame + WINDOW_S * sampleRate
		}
		if (++this.quanta % this.tickQuanta === 0) {
			this.wasm.NativeAudioWorklet_Feedback(this.feedback)
			const v = new Int32Array(this.wasm.memory.buffer, this.feedback, 4)
			this.port.postMessage([currentFrame + n, v[0], v[1], (v[2] >>> 0) + (v[3] >>> 0) * 4294967296])
		}
		if (currentFrame >= this.statsEnd) {
			this.port.postMessage({ stats: this.stats })
			this.stats = { quanta: 0, batches: 0, late: 0, worstLateMs: 0, lateAt: [], mixMs: 0 }
			this.statsEnd = currentFrame + sampleRate
		}
		return true
	}
}

registerProcessor('ctr-spu', CtrSpu)
