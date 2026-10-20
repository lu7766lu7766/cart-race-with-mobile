// ============================================================
//  audio.js — WebAudio 程式化合成音效
//  零外部音效檔案依賴，使用 OscillatorNode 與 GainNode 即時生成街機風格音效。
//  嚴格遵守瀏覽器 Autoplay 規範：於首次鍵盤/滑鼠點擊時才執行 resume()；
//  支援 M 鍵切換靜音。
// ============================================================

export class SoundSystem {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.unlocked = false;

    this._initUserInteractionUnlock();
  }

  // 監聽首次使用者點擊/按鍵以解鎖 AudioContext
  _initUserInteractionUnlock() {
    if (typeof window === 'undefined') return;

    const unlock = () => {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      this.unlocked = true;

      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('click', unlock);
      window.removeEventListener('touchstart', unlock);
    };

    const onKeyDown = (e) => {
      // M 鍵切換靜音
      if (e.code === 'KeyM') {
        this.toggleMute();
      }
      unlock();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('click', unlock);
    window.addEventListener('touchstart', unlock);
  }

  // 切換靜音開關
  toggleMute() {
    this.muted = !this.muted;
    console.log(`[Audio] 靜音狀態：${this.muted ? '已靜音' : '開啟聲音'}`);
  }

  // 播放合成音效
  play(type) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;

    try {
      const now = this.ctx.currentTime;
      switch (type) {
        case 'countdown':
          this._playTone(440, 0.15, 'sine');
          break;
        case 'go':
          this._playTone(880, 0.4, 'triangle');
          break;
        case 'box':
          // 雙音清脆鈴聲
          this._playChime(659, 880, 0.2);
          break;
        case 'boost':
          this._playSweep(200, 800, 0.4, 'sawtooth');
          break;
        case 'shield':
          this._playChime(523, 784, 0.35);
          break;
        case 'drop':
          this._playSweep(350, 150, 0.15, 'sine');
          break;
        case 'missile':
          this._playSweep(600, 300, 0.3, 'sawtooth');
          break;
        case 'hit':
          this._playNoise(0.4);
          break;
        case 'spin':
          this._playSweep(800, 200, 0.3, 'triangle');
          break;
        case 'bump':
          this._playTone(120, 0.08, 'square');
          break;
        case 'wall':
          this._playTone(90, 0.12, 'square');
          break;
        case 'lap':
          this._playChime(587, 880, 0.3);
          break;
        case 'finished':
          this._playChime(523, 1046, 0.5);
          break;
        case 'race_over':
          this._playChime(440, 880, 0.6);
          break;
      }
    } catch (err) {
      // 音訊合成非關鍵路徑，出錯不中斷主遊戲
    }
  }

  // 單音合成
  _playTone(freq, duration, type = 'sine') {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + duration);
  }

  // 雙音和弦/鈴音合成
  _playChime(f1, f2, duration) {
    const now = this.ctx.currentTime;
    for (const freq of [f1, f2]) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + duration);
    }
  }

  // 頻率滑音（音調上升或下降）
  _playSweep(startFreq, endFreq, duration, type = 'sine') {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;

    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + duration);
  }

  // 噪音（碰撞/爆炸打擊感）
  _playNoise(duration) {
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = buffer;

    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    whiteNoise.connect(gain);
    gain.connect(this.ctx.destination);

    whiteNoise.start(now);
  }
}
