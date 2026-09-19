class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Int16Array(1600);
    this.length = 0;
    this.startFrame = 0;
    this.port.onmessage = ({ data }) => {
      if (data === 'flush') { this.flush(); this.port.postMessage({ flushed: true }); }
    };
  }
  flush() {
    if (!this.length) return;
    const bytes = new ArrayBuffer(this.length * 2);
    const view = new DataView(bytes);
    for (let i = 0; i < this.length; i++) view.setInt16(i * 2, this.samples[i], true);
    this.port.postMessage({ samples: bytes, startFrame: this.startFrame }, [bytes]);
    this.length = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      if (!this.length) this.startFrame = currentFrame + i;
      const value = Math.max(-1, Math.min(1, input[i]));
      this.samples[this.length++] = value < 0 ? value * 32768 : value * 32767;
      if (this.length === this.samples.length) this.flush();
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
