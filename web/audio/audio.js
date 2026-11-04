// The game's sound output : an AudioContext at the SPU's 44.1 kHz and the SPU itself in an
// AudioWorklet (spu-worklet.js running audio/spu.wasm, the worklet's copy of
// platform/native_audio.c). Loaded by index.html after window.ctrAudio (the volume) exists ;
// this adds to it :
//   open()          the game's SpuInit (native_audio.c, NativeAudio_WebOpenJS) : creates the
//                   context and the node once, returns 1 (0 : no Web Audio)
//   post(stamp, ab) one batch of the game's SPU commands (an ArrayBuffer, transferred),
//                   held until the node exists
//   context, node   the AudioContext, the AudioWorkletNode (null until ready)
//   output          a GainNode after the node, at 1 : the game's sound before the volume. It goes
//                   to the speakers through ctrMute (index.html) ; Share taps it
//                   (share/capture.js)
//   ticks           an EventTarget : 'tick' every 4 render quanta (~11.6 ms), the audio clock
//                   (platform/native_platform.c wakes a hidden page on it)
//   feedback        { serial, active, outputFrame } : the XA track's position, read by the game
//                   once per VBlank
//   stats           counters for __ctr.audio (platform/web_debug_bridge.c), resetStats()
(() => {
	const audio = window.ctrAudio;
	const BUFFER_MS = 20; // the command buffer (session 21, the user's pick) : a VBlank's commands play 20 ms after its due time
	const TICK_QUANTA = 4;
	const ticks = new EventTarget();
	const tick = new Event('tick');
	let pending = [];

	const freshStats = () => ({ quanta: 0, batches: 0, lateBatches: 0, worstLateMs: 0, workletMixMs: 0, longestGapMs: 0, ticks: 0, since: performance.now() });

	async function start(ctx) {
		const [bytes] = await Promise.all([fetch('audio/spu.wasm').then((r) => r.arrayBuffer()), ctx.audioWorklet.addModule('audio/spu-worklet.js')]);
		const module = await WebAssembly.compile(bytes);
		const options = { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] };
		let node;
		try {
			node = new AudioWorkletNode(ctx, 'ctr-spu', { ...options, processorOptions: { module, bufferMs: BUFFER_MS, tickQuanta: TICK_QUANTA } });
		} catch {
			// a browser that cannot clone a compiled module into the worklet : the bytes, compiled there
			node = new AudioWorkletNode(ctx, 'ctr-spu', { ...options, processorOptions: { bytes, bufferMs: BUFFER_MS, tickQuanta: TICK_QUANTA } });
		}
		let lastTick = 0;
		node.port.onmessage = (e) => {
			const m = e.data;
			if (Array.isArray(m)) {
				const now = performance.now();
				const s = audio.stats;
				if (lastTick && now - lastTick > s.longestGapMs) s.longestGapMs = Math.round(now - lastTick);
				lastTick = now;
				s.ticks++;
				if (audio.times.length < 20000) audio.times.push(Math.round(now));
				audio.feedback = { serial: m[1], active: m[2], outputFrame: m[3] };
				ticks.dispatchEvent(tick);
			} else if (m.stats) {
				const s = audio.stats;
				const w = m.stats;
				s.quanta += w.quanta;
				s.batches += w.batches;
				s.lateBatches += w.late;
				s.worstLateMs = Math.max(s.worstLateMs, Math.round(w.worstLateMs * 10) / 10);
				s.workletMixMs += w.mixMs;
				for (const [stamp, ms] of w.lateAt) if (audio.late.length < 2000) audio.late.push({ at: stamp, ms });
			}
		};
		node.connect(audio.output);
		audio.node = node;
		for (const [stamp, ab] of pending) node.port.postMessage({ batch: [stamp, ab], startup: true }, [ab]);
		pending = null;
	}

	Object.assign(audio, {
		context: null,
		node: null,
		output: null,
		ticks,
		feedback: null,
		bufferMs: BUFFER_MS,
		stats: freshStats(),
		times: [],
		late: [],
		resetStats() {
			this.stats = freshStats();
		},
		open() {
			if (this.context) return 1;
			const AC = window.AudioContext || window.webkitAudioContext;
			if (!AC || !window.AudioWorkletNode) return 0;
			let ctx;
			try {
				ctx = new AC({ latencyHint: 'interactive', sampleRate: 44100 });
			} catch {
				ctx = new AC({ latencyHint: 'interactive' }); // the worklet steps 44.1 kHz to this rate
			}
			this.context = ctx;
			this.output = ctx.createGain();
			this.output.connect(ctx.destination);
			// Chrome starts a context made after the page's first gesture ; the others wait for a
			// resume, retried each second as SDL did (index.html also resumes inside each gesture)
			const resume = setInterval(() => (ctx.state === 'running' ? clearInterval(resume) : ctx.resume().catch(() => {})), 1000);
			start(ctx).catch((e) => {
				pending = null;
				console.error('[CTR Web] audio worklet failed:', e);
			});
			return 1;
		},
		post(stamp, ab) {
			if (this.node) this.node.port.postMessage({ batch: [stamp, ab], startup: this.context.state !== 'running' }, [ab]);
			else if (pending) pending.push([stamp, ab]);
		},
	});
})();
