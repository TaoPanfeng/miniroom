/** 雨声由浏览器在本机合成；只有用户主动开启声音时才创建音频上下文。 */
export class RoomAudio {
  #context = null;
  #master = null;
  #rainGain = null;
  #rainSource = null;
  #enabled = false;
  #rain = false;
  #volume = 35;
  #version = 0;
  #disposed = false;
  #suspendTimer = null;

  get enabled() { return this.#enabled; }

  #prepare() {
    if (this.#context) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('这个浏览器暂不支持环境音。');
    const context = new AudioContextClass();
    const master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);
    const rainGain = context.createGain();
    rainGain.gain.value = 0;
    rainGain.connect(master);

    const buffer = context.createBuffer(1, context.sampleRate * 5, context.sampleRate);
    const samples = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < samples.length; i++) {
      const white = Math.random() * 2 - 1;
      brown = (brown + 0.02 * white) / 1.02;
      samples[i] = brown * 2.2 + white * 0.16;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2800;
    filter.Q.value = 0.6;
    source.connect(filter);
    filter.connect(rainGain);
    source.start();
    this.#context = context;
    this.#master = master;
    this.#rainGain = rainGain;
    this.#rainSource = source;
  }

  #update() {
    if (!this.#context || this.#context.state === 'closed') return;
    const time = this.#context.currentTime;
    this.#master.gain.setTargetAtTime(this.#enabled ? this.#volume / 100 : 0, time, 0.12);
    this.#rainGain.gain.setTargetAtTime(this.#rain ? 0.65 : 0, time, 0.2);
  }

  async setEnabled(value) {
    if (this.#disposed) return;
    const enabled = Boolean(value);
    const version = ++this.#version;
    clearTimeout(this.#suspendTimer);
    if (!enabled) {
      this.#enabled = false;
      this.#update();
      // 先淡出再暂停处理；再次开启时取消暂停，避免快速切换产生竞态。
      this.#suspendTimer = setTimeout(() => {
        if (!this.#disposed && !this.#enabled && version === this.#version && this.#context?.state === 'running') {
          this.#context.suspend().catch(() => {});
        }
      }, 500);
      return;
    }
    this.#prepare();
    try {
      if (this.#context.state !== 'running') await this.#context.resume();
      if (this.#disposed || version !== this.#version) return;
      this.#enabled = true;
      this.#update();
    } catch {
      if (version === this.#version) this.#enabled = false;
      throw new Error('环境音没有启动，请再点击一次声音按钮。');
    }
  }

  setRain(value) { this.#rain = Boolean(value); this.#update(); }

  setVolume(value) {
    if (!Number.isFinite(value)) return;
    this.#volume = Math.max(0, Math.min(100, value));
    this.#update();
  }

  chime() {
    if (!this.#enabled || !this.#context || this.#context.state !== 'running') return;
    const time = this.#context.currentTime;
    [523.25, 659.25].forEach((frequency, index) => {
      const oscillator = this.#context.createOscillator();
      const gain = this.#context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      const start = time + index * 0.2;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.22, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.8);
      oscillator.connect(gain);
      gain.connect(this.#master);
      oscillator.start(start);
      oscillator.stop(start + 0.85);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    });
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#version++;
    clearTimeout(this.#suspendTimer);
    this.#enabled = false;
    this.#rainSource?.stop();
    this.#rainSource?.disconnect();
    if (this.#context && this.#context.state !== 'closed') this.#context.close().catch(() => {});
  }
}
