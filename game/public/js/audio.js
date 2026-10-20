// ============================================================
//  audio.js — WebAudio 程式化合成音效
//  零外部音效檔案依賴，使用 OscillatorNode 與 GainNode 即時生成街機風格音效。
//  包含倒數、氮氣加速、甩尾摩擦、迷你衝刺、道具升級、跳台起飛與落地音效。
//  嚴格遵守瀏覽器 Autoplay 規範：於首次鍵盤/滑鼠點擊時才執行 resume()；
//  支援 M 鍵切換靜音。
// ============================================================

export class SoundSystem {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.unlocked = false;

    // 持續性音效節點（甩尾摩擦聲）
    this.driftOsc = null;
    this.driftGain = null;
    this.driftFilter = null;

    this._initUserInteractionUnlock();
  }

  // 監聽首次使用者點擊/按鍵以解鎖 AudioContext，並註冊永久 M 鍵靜音監聽
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

      window.removeEventListener('keydown', onUnlockKey);
      window.removeEventListener('click', unlock);
      window.removeEventListener('touchstart', unlock);
    };

    const onUnlockKey = () => {
      unlock();
    };

    window.addEventListener('keydown', onUnlockKey);
    window.addEventListener('click', unlock);
    window.addEventListener('touchstart', unlock);

    // 永久監聽 M 鍵以切換靜音（防止首次解鎖後事件監聽被移除導致 M 鍵失效）
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyM') {
        this.toggleMute();
      }
    });
  }

  // 切換靜音開關
  toggleMute() {
    this.muted = !this.muted;
    if (this.muted && this.driftGain && this.ctx) {
      try {
        this.driftGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      } catch (e) {}
    }
    console.log(`[Audio] 靜音狀態：${this.muted ? '已靜音' : '開啟聲音'}`);
  }

  // 初始化甩尾摩擦音效節點（帶通濾波鋸齒波）
  _initDriftSound() {
    if (!this.ctx || this.driftGain) return;
    try {
      this.driftOsc = this.ctx.createOscillator();
      this.driftOsc.type = 'sawtooth';
      this.driftOsc.frequency.setValueAtTime(140, this.ctx.currentTime);

      this.driftFilter = this.ctx.createBiquadFilter();
      this.driftFilter.type = 'bandpass';
      this.driftFilter.frequency.setValueAtTime(800, this.ctx.currentTime);
      this.driftFilter.Q.setValueAtTime(3.0, this.ctx.currentTime);

      this.driftGain = this.ctx.createGain();
      this.driftGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);

      this.driftOsc.connect(this.driftFilter);
      this.driftFilter.connect(this.driftGain);
      this.driftGain.connect(this.ctx.destination);

      this.driftOsc.start();
    } catch (e) {
      console.warn('Drift sound init failed:', e);
    }
  }

  // 設定甩尾摩擦聲開關（on 時平滑淡入，off 時平滑淡出）
  setDrifting(on) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') {
      if (this.driftGain && this.ctx) {
        try {
          this.driftGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
        } catch (e) {}
      }
      return;
    }

    if (!this.driftGain) {
      this._initDriftSound();
    }
    if (!this.driftGain) return;

    const now = this.ctx.currentTime;
    this.driftGain.gain.cancelScheduledValues(now);
    const targetGain = on ? 0.08 : 0.0001;
    this.driftGain.gain.setTargetAtTime(targetGain, now, 0.05);
  }

  // 播放合成音效
  play(type, extra = null) {
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
          this._playChime(659, 880, 0.2);
          break;
        case 'upgrade':
          // 道具升級三音階上升音
          this._playUpgradeChime();
          break;
        case 'boost':
          this._playSweep(200, 800, 0.4, 'sawtooth');
          break;
        case 'mini_turbo': {
          // 迷你加速音效：依 level 1/2/3 提高起始與結束頻率
          const lvl = (extra && extra.level) ? extra.level : 1;
          const startFreq = 260 + lvl * 70; // 330, 400, 470
          const endFreq = 800 + lvl * 180;  // 980, 1160, 1340
          this._playSweep(startFreq, endFreq, 0.35, 'sawtooth');
          break;
        }
        case 'jump':
          // 跳台起飛音效
          this._playSweep(240, 600, 0.25, 'sine');
          break;
        case 'land':
          // 著地沉重感
          this._playNoise(0.12);
          this._playTone(80, 0.15, 'sine');
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
      // 容錯處理
    }
  }

  // 道具升級和弦音
  _playUpgradeChime() {
    const freqs = [523.25, 659.25, 783.99, 1046.50];
    const now = this.ctx.currentTime;
    freqs.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.06);

      gain.gain.setValueAtTime(0.12, now + idx * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.25);
    });
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

  // 頻率滑音
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

  // 噪音打擊
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
