// ============================================================
//  audio.js — WebAudio 程式化合成音效與背景音樂
//  零外部音效檔案依賴：所有聲音都用 OscillatorNode（振盪器）、噪音緩衝與濾波器即時合成。
//
//  聲音分成三條「匯流排」（bus），最後一起送到 master 總音量：
//    sfxBus   ：一次性音效（倒數、道具技能、碰撞、圈數…）
//    carBus   ：持續性車輛聲（引擎、甩尾摩擦、煞車尖叫、草地噪音），每位真人玩家一組
//    musicBus ：背景音樂（每張地圖一首，依 maps.js 的 music 參數程式生成）
//
//  嚴格遵守瀏覽器 Autoplay 規範：於首次鍵盤/滑鼠/觸控時才建立並 resume() AudioContext。
//  M 鍵：全部靜音；B 鍵：只開關背景音樂。
//  檔案上半部的純函式（engineRpm、buildMusicBar…）不依賴瀏覽器，可在 Node.js 測試。
// ============================================================

import { getMap } from './maps.js';

// ------------------------------------------------------------
// 1. 純函式（可在 Node.js 測試）
// ------------------------------------------------------------

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// MIDI 音高編號轉頻率（69 = A4 = 440Hz）
export function noteToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// 引擎轉速（0 ~ 1.15）：用速度比例模擬 4 檔變速箱
// 每升一檔轉速會掉下來再爬升，聽起來像真的在換檔
export function engineRpm(speedRatio, gears = 4) {
  const r = Math.max(0, Math.min(1.25, Math.abs(speedRatio)));
  if (r < 0.02) return 0;
  const pos = Math.min(r * gears, gears + 0.6);
  const gear = Math.min(gears - 1, Math.floor(pos));
  const within = pos - gear; // 本檔位內的進度（最高檔可超過 1，代表加速時轉速拉高）
  const low = gear === 0 ? 0.12 : 0.38;
  return Math.min(1.15, low + (1 - low) * within * (gear === 0 ? 1 : 0.95));
}

// 轉速轉成引擎基頻（Hz）：怠速約 45Hz，紅線約 165Hz
export function engineFrequency(rpm) {
  return 45 + Math.max(0, rpm) * 120;
}

// 音階級數轉半音數（支援負數與超過 7 的級數，會自動跨八度）
export function degreeToSemitone(scale, degree) {
  const n = scale.length;
  const octave = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return octave * 12 + scale[idx];
}

// 產生一小節（16 個十六分音符）的音樂事件
// mode：'lobby'（大廳，柔和無鼓）、'race'（比賽）、'final'（最後一圈，加花）
// 回傳 [{ step, voice, midi?, len, vel }]，len 為持續幾個十六分音符
export function buildMusicBar(music, bar, mode = 'race') {
  const events = [];
  const prog = music.progression;
  const chordDeg = prog[((bar % prog.length) + prog.length) % prog.length];
  const root = music.root;
  const scale = music.scale;
  const phrase = Math.floor(bar / prog.length) % 2; // 每跑完一輪和弦換一種變化

  // 和弦長音（三和弦：根音、三度、五度）
  for (const off of [0, 2, 4]) {
    events.push({ step: 0, voice: 'pad', midi: root + degreeToSemitone(scale, chordDeg + off), len: 16, vel: mode === 'lobby' ? 1 : 0.7 });
  }

  // 貝斯：八分音符，根音 / 五度 / 八度交替
  const bassPattern = mode === 'lobby' ? [0, null, null, null, 4, null, null, null] : [0, 0, 4, 0, 7, 0, 4, 0];
  bassPattern.forEach((off, k) => {
    if (off == null) return;
    events.push({ step: k * 2, voice: 'bass', midi: root - 24 + degreeToSemitone(scale, chordDeg + off), len: mode === 'lobby' ? 6 : 2, vel: 1 });
  });

  // 主旋律：maps.js 的 lead 陣列（數字 = 相對和弦根音的音階級數，null = 休止）
  let lead = music.lead.slice(0, 16);
  if (phrase === 1) lead = lead.slice(8).concat(lead.slice(0, 8)); // 第二輪前後半交換，增加變化
  lead.forEach((off, step) => {
    if (off == null) return;
    if (mode === 'lobby' && step % 2 === 1) return; // 大廳版本只留正拍，比較悠閒
    events.push({ step, voice: 'lead', midi: root + 12 + degreeToSemitone(scale, chordDeg + off), len: 1, vel: 1 });
    // 最後一圈：高八度和聲讓氣氛更緊張
    if (mode === 'final') {
      events.push({ step, voice: 'lead', midi: root + 24 + degreeToSemitone(scale, chordDeg + off), len: 1, vel: 0.45 });
    }
  });

  // 鼓組（大廳沒有大鼓與小鼓，只有輕輕的 hi-hat）
  if (mode !== 'lobby') {
    const kicks = phrase === 1 ? [0, 6, 8, 11] : [0, 8];
    for (const st of kicks) events.push({ step: st, voice: 'kick', len: 1, vel: 1 });
    for (const st of [4, 12]) events.push({ step: st, voice: 'snare', len: 1, vel: 1 });
    if (mode === 'final') events.push({ step: 15, voice: 'snare', len: 1, vel: 0.5 });
  }
  for (let st = 0; st < 16; st += 2) {
    events.push({ step: st, voice: 'hat', len: 1, vel: mode === 'lobby' ? 0.4 : (st % 4 === 2 ? 1 : 0.6) });
  }

  return events;
}

// ------------------------------------------------------------
// 2. 音效系統（瀏覽器端）
// ------------------------------------------------------------
export class SoundSystem {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicEnabled = true;
    this.unlocked = false;

    // 匯流排節點（AudioContext 建立後才會產生）
    this.master = null;
    this.sfxBus = null;
    this.carBus = null;
    this.musicBus = null;
    this.noiseBuffer = null;

    // 每位真人玩家一組車輛聲（key = 玩家 id）
    this.voices = new Map();

    // 背景音樂狀態
    this.musicMode = 'off';     // 'off' | 'lobby' | 'race' | 'final'
    this.musicMapId = null;
    this.musicTimer = null;
    this.musicBar = 0;
    this.musicStep = 0;
    this.nextStepTime = 0;
    this.barEvents = [];

    this.onChange = null; // 靜音狀態改變時通知 HUD（可選）

    this._initUserInteractionUnlock();
  }

  // 監聽首次使用者點擊/按鍵以解鎖 AudioContext，並註冊永久 M / B 鍵監聽
  _initUserInteractionUnlock() {
    if (typeof window === 'undefined') return;

    const unlock = () => {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
          this._buildGraph();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      this.unlocked = true;
      this._restartMusic();

      window.removeEventListener('keydown', unlock);
      window.removeEventListener('click', unlock);
      window.removeEventListener('touchstart', unlock);
    };

    window.addEventListener('keydown', unlock);
    window.addEventListener('click', unlock);
    window.addEventListener('touchstart', unlock);

    // 永久監聽 M（全部靜音）與 B（背景音樂開關）
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyM') this.toggleMute();
      if (e.code === 'KeyB') this.toggleMusic();
    });
  }

  // 建立匯流排與共用的白噪音緩衝
  _buildGraph() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;

    // 壓縮器避免多個聲音疊在一起時爆音
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 1.0;
    this.sfxBus.connect(this.master);

    this.carBus = ctx.createGain();
    this.carBus.gain.value = 1.0;
    this.carBus.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicEnabled ? 0.42 : 0;
    this.musicBus.connect(this.master);

    // 2 秒白噪音，供甩尾、煞車、爆炸等聲音重複使用
    const len = Math.floor(ctx.sampleRate * 2);
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  _ready() {
    return Boolean(this.ctx && this.master && this.ctx.state === 'running');
  }

  // 切換全部靜音
  toggleMute() {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.85, this.ctx.currentTime, 0.03);
    }
    console.log(`[Audio] 靜音狀態：${this.muted ? '已靜音' : '開啟聲音'}`);
    this.onChange?.();
  }

  // 切換背景音樂
  toggleMusic() {
    this.musicEnabled = !this.musicEnabled;
    if (this.musicBus && this.ctx) {
      this.musicBus.gain.setTargetAtTime(this.musicEnabled ? 0.42 : 0, this.ctx.currentTime, 0.05);
    }
    console.log(`[Audio] 背景音樂：${this.musicEnabled ? '開啟' : '關閉'}`);
    this.onChange?.();
  }

  // ----------------------------------------------------------
  // 2-1. 背景音樂（lookahead 排程器：每 25ms 檢查，提前 0.15 秒排好音符，節拍才會穩）
  // ----------------------------------------------------------

  // 設定音樂模式與地圖；相同設定重複呼叫不會重頭播放
  setMusic(mode, mapId) {
    const sameTheme = mapId === this.musicMapId;
    if (mode === this.musicMode && sameTheme) return;
    const prevMode = this.musicMode;
    this.musicMode = mode;
    this.musicMapId = mapId;

    // race -> final 只是加速加花，不重頭開始
    if (sameTheme && prevMode === 'race' && mode === 'final') return;
    this._restartMusic();
  }

  _restartMusic() {
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    if (!this.ctx || this.musicMode === 'off' || !this.musicMapId) return;

    this.musicBar = 0;
    this.musicStep = 0;
    this.nextStepTime = this.ctx.currentTime + 0.12;
    this.musicTimer = setInterval(() => this._scheduleMusic(), 25);
  }

  _scheduleMusic() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const music = getMap(this.musicMapId).music;
    if (!music) return;

    const tempo = this.musicMode === 'lobby' ? 0.8 : (this.musicMode === 'final' ? 1.12 : 1.0);
    const stepDur = 60 / (music.bpm * tempo) / 4;

    // 分頁切到背景後 setInterval 會變慢，追不上時直接跳到現在，避免一次爆出一堆音符
    if (this.nextStepTime < this.ctx.currentTime - 0.3) {
      this.nextStepTime = this.ctx.currentTime + 0.05;
    }

    while (this.nextStepTime < this.ctx.currentTime + 0.15) {
      if (this.musicStep === 0) {
        this.barEvents = buildMusicBar(music, this.musicBar, this.musicMode);
      }
      for (const ev of this.barEvents) {
        if (ev.step === this.musicStep) {
          this._playMusicNote(ev, this.nextStepTime, stepDur, music);
        }
      }
      this.nextStepTime += stepDur;
      this.musicStep++;
      if (this.musicStep >= 16) {
        this.musicStep = 0;
        this.musicBar++;
      }
    }
  }

  _playMusicNote(ev, t, stepDur, music) {
    const ctx = this.ctx;
    const dur = ev.len * stepDur;
    const out = this.musicBus;

    switch (ev.voice) {
      case 'pad': {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = noteToFreq(ev.midi);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.035 * ev.vel, t + 0.12);
        g.gain.setValueAtTime(0.035 * ev.vel, t + dur * 0.8);
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
        osc.connect(g); g.connect(out);
        osc.start(t); osc.stop(t + dur + 0.05);
        break;
      }
      case 'bass': {
        const osc = ctx.createOscillator();
        const f = ctx.createBiquadFilter();
        const g = ctx.createGain();
        osc.type = music.bassWave || 'triangle';
        osc.frequency.value = noteToFreq(ev.midi);
        f.type = 'lowpass';
        f.frequency.value = 700;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.16, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.95);
        osc.connect(f); f.connect(g); g.connect(out);
        osc.start(t); osc.stop(t + dur);
        break;
      }
      case 'lead': {
        const osc = ctx.createOscillator();
        const f = ctx.createBiquadFilter();
        const g = ctx.createGain();
        osc.type = music.leadWave || 'square';
        osc.frequency.value = noteToFreq(ev.midi);
        f.type = 'lowpass';
        f.frequency.value = 2600;
        const peak = (osc.type === 'triangle' ? 0.11 : 0.05) * ev.vel;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.09, dur * 1.6));
        osc.connect(f); f.connect(g); g.connect(out);
        osc.start(t); osc.stop(t + Math.max(0.1, dur * 1.7));
        break;
      }
      case 'kick': {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        g.gain.setValueAtTime(0.45 * ev.vel, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        osc.connect(g); g.connect(out);
        osc.start(t); osc.stop(t + 0.18);
        break;
      }
      case 'snare':
        this._noiseAt(t, 0.12, 0.16 * ev.vel, 'highpass', 1500, 1500, 0.7, out);
        break;
      case 'hat':
        this._noiseAt(t, 0.035, 0.05 * ev.vel, 'highpass', 7000, 7000, 0.7, out);
        break;
    }
  }

  // ----------------------------------------------------------
  // 2-2. 持續性車輛聲（引擎、甩尾、煞車、草地）
  // ----------------------------------------------------------

  // 每幀由 main.js 呼叫：list 為目前要發聲的真人車輛狀態
  // { id, speedRatio, throttle, brake, speed, skidding, driftLevel, offroad, grounded, boosting, revving, pan }
  updateVehicles(list) {
    if (!this._ready()) return;
    const now = this.ctx.currentTime;
    const seen = new Set();
    const voiceScale = 1 / Math.sqrt(Math.max(1, list.length)); // 多人同時發聲時降低每台音量

    for (const car of list) {
      seen.add(car.id);
      let v = this.voices.get(car.id);
      if (!v) {
        v = this._createVoice();
        this.voices.set(car.id, v);
      }

      // 引擎轉速：倒數時依油門空踩轉速（起跑催油門很有感），比賽中依速度模擬換檔
      let targetRpm;
      if (car.revving) {
        targetRpm = car.throttle > 0.5 ? 0.92 + Math.sin(now * 23) * 0.04 : 0.1;
      } else {
        targetRpm = engineRpm(car.speedRatio);
        if (car.throttle > 0.5) targetRpm += 0.06;
        if (car.boosting) targetRpm += 0.1;
        if (!car.grounded) targetRpm += 0.15; // 空中輪胎空轉
        targetRpm = Math.max(targetRpm, 0.06);
      }
      const k = targetRpm > v.rpm ? 0.25 : 0.12;
      v.rpm += (targetRpm - v.rpm) * k;

      const freq = engineFrequency(v.rpm);
      v.osc1.frequency.setTargetAtTime(freq, now, 0.03);
      v.osc2.frequency.setTargetAtTime(freq * 0.5, now, 0.03);
      v.engFilter.frequency.setTargetAtTime(260 + v.rpm * 1500 + car.throttle * 500, now, 0.05);
      const engGain = (0.05 + 0.04 * car.throttle + 0.03 * Math.min(1, v.rpm)) * voiceScale;
      v.engGain.gain.setTargetAtTime(engGain, now, 0.05);

      // 甩尾／打滑摩擦：帶通噪音，集氣等級越高音調越尖
      const skidOn = car.skidding && car.grounded && car.speed > 5;
      v.skidFilter.frequency.setTargetAtTime(950 + (car.driftLevel || 0) * 280 + Math.sin(now * 17) * 60, now, 0.05);
      v.skidGain.gain.setTargetAtTime(skidOn ? (0.11 + 0.025 * (car.driftLevel || 0)) * voiceScale : 0.0001, now, 0.04);

      // 煞車尖叫：高速前進時踩煞車
      const brakeAmt = (car.brake > 0.5 && car.speed > 10 && car.grounded && !car.skidding) ? clamp01((car.speed - 10) / 20) : 0;
      v.brakeGain.gain.setTargetAtTime(brakeAmt > 0 ? (0.04 + 0.08 * brakeAmt) * voiceScale : 0.0001, now, 0.03);

      // 草地低頻沙沙聲
      const roughAmt = car.offroad && car.grounded ? clamp01(Math.abs(car.speed) / 30) : 0;
      v.roughGain.gain.setTargetAtTime(roughAmt * 0.22 * voiceScale, now, 0.06);

      if (v.panner) v.panner.pan.setTargetAtTime(car.pan || 0, now, 0.1);
    }

    // 已不在清單中的車輛：淡出後停止
    for (const [id, v] of this.voices) {
      if (!seen.has(id)) {
        this._destroyVoice(v);
        this.voices.delete(id);
      }
    }
  }

  // 停止全部車輛聲（離開比賽時呼叫）
  stopVehicles() {
    for (const v of this.voices.values()) this._destroyVoice(v);
    this.voices.clear();
  }

  _createVoice() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 1;
    let panner = null;
    if (typeof ctx.createStereoPanner === 'function') {
      panner = ctx.createStereoPanner();
      out.connect(panner);
      panner.connect(this.carBus);
    } else {
      out.connect(this.carBus);
    }

    // 引擎：鋸齒波 + 低八度方波，經低通濾波模擬引擎蓋悶住的聲音
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 50;
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 25;
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = 0.6;
    const engFilter = ctx.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 400;
    engFilter.Q.value = 2;
    const engGain = ctx.createGain();
    engGain.gain.value = 0.0001;
    osc1.connect(engFilter);
    osc2.connect(osc2Gain);
    osc2Gain.connect(engFilter);
    engFilter.connect(engGain);
    engGain.connect(out);

    // 噪音來源（循環播放）分給甩尾、煞車、草地三組濾波器
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;

    const skidFilter = ctx.createBiquadFilter();
    skidFilter.type = 'bandpass';
    skidFilter.frequency.value = 1000;
    skidFilter.Q.value = 5;
    const skidGain = ctx.createGain();
    skidGain.gain.value = 0.0001;
    noise.connect(skidFilter); skidFilter.connect(skidGain); skidGain.connect(out);

    const brakeFilter = ctx.createBiquadFilter();
    brakeFilter.type = 'bandpass';
    brakeFilter.frequency.value = 3100;
    brakeFilter.Q.value = 14;
    const brakeGain = ctx.createGain();
    brakeGain.gain.value = 0.0001;
    noise.connect(brakeFilter); brakeFilter.connect(brakeGain); brakeGain.connect(out);

    const roughFilter = ctx.createBiquadFilter();
    roughFilter.type = 'lowpass';
    roughFilter.frequency.value = 320;
    const roughGain = ctx.createGain();
    roughGain.gain.value = 0.0001;
    noise.connect(roughFilter); roughFilter.connect(roughGain); roughGain.connect(out);

    osc1.start();
    osc2.start();
    noise.start(0, Math.random() * 1.5);

    return { out, panner, osc1, osc2, engFilter, engGain, noise, skidFilter, skidGain, brakeGain, roughGain, rpm: 0.1 };
  }

  _destroyVoice(v) {
    try {
      const now = this.ctx.currentTime;
      v.out.gain.setTargetAtTime(0.0001, now, 0.08);
      v.osc1.stop(now + 0.4);
      v.osc2.stop(now + 0.4);
      v.noise.stop(now + 0.4);
    } catch (e) {}
  }

  // ----------------------------------------------------------
  // 2-3. 一次性音效
  // extra.volume：音量倍率（電腦玩家的音效由 main.js 調小）；extra.pan：左右聲道 -1 ~ 1
  // ----------------------------------------------------------
  play(type, extra = null) {
    if (!this._ready()) return;

    try {
      const vol = extra && Number.isFinite(extra.volume) ? extra.volume : 1;
      const pan = extra && Number.isFinite(extra.pan) ? extra.pan : 0;
      const out = this._makeOut(vol, pan);
      const t = this.ctx.currentTime;
      const level = (extra && extra.level) || 1;

      switch (type) {
        // ---------- 倒數 ----------
        case 'countdown':
          this._toneAt(t, 'square', 587, 587, 0.22, 0.12, out, 1800);
          this._toneAt(t, 'sine', 293, 293, 0.25, 0.15, out);
          break;
        case 'go':
          this._toneAt(t, 'square', 1175, 1175, 0.7, 0.12, out, 3000);
          this._toneAt(t, 'square', 880, 880, 0.7, 0.09, out, 3000);
          this._toneAt(t, 'sine', 587, 587, 0.7, 0.14, out);
          this._noiseAt(t, 0.5, 0.12, 'bandpass', 600, 4000, 1, out);
          break;

        // ---------- 道具與技能 ----------
        case 'box': // 抽道具轉盤：一連串越來越慢的滴答聲
          for (let i = 0; i < 9; i++) {
            const dt = 0.75 * Math.pow(i / 9, 1.3);
            this._toneAt(t + dt, 'triangle', 900 + (i % 3) * 220, 900 + (i % 3) * 220, 0.035, 0.12, out);
          }
          this._toneAt(t + 0.8, 'sine', 1319, 1319, 0.25, 0.12, out);
          this._toneAt(t + 0.8, 'sine', 1760, 1760, 0.3, 0.09, out);
          break;
        case 'upgrade': // 魔石升級：上升琶音＋閃亮泛音
          [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
            this._toneAt(t + i * 0.055, 'triangle', f, f, 0.25, 0.12, out);
          });
          this._noiseAt(t + 0.2, 0.25, 0.04, 'highpass', 8000, 8000, 0.7, out);
          break;
        case 'boost': // 氮氣：噴射呼嘯聲（等級越高越長）
          this._noiseAt(t, 0.45 + level * 0.2, 0.2, 'bandpass', 400, 3200, 1.5, out);
          this._toneAt(t, 'sawtooth', 160, 700 + level * 120, 0.5 + level * 0.15, 0.1, out, 2200);
          break;
        case 'pad': // 加速板
          this._toneAt(t, 'sine', 420, 1250, 0.25, 0.15, out);
          this._noiseAt(t, 0.25, 0.1, 'bandpass', 1200, 3500, 1.2, out);
          break;
        case 'mini_turbo': { // 甩尾迷你加速：等級越高起始音越高
          const startFreq = 260 + level * 70;
          const endFreq = 800 + level * 180;
          this._toneAt(t, 'sawtooth', startFreq, endFreq, 0.35, 0.12, out, 2600);
          this._noiseAt(t, 0.3 + level * 0.08, 0.12, 'bandpass', 700, 2800 + level * 400, 1.2, out);
          break;
        }
        case 'shield': { // 護盾：閃爍泛音和弦
          const partials = level >= 3 ? [523, 784, 1046, 1318] : [523, 784, 1046];
          partials.forEach((f, i) => {
            this._toneAt(t + i * 0.03, 'sine', f, f * 1.01, 0.6, 0.08, out);
          });
          this._toneAt(t, 'triangle', 262, 392, 0.4, 0.08, out);
          break;
        }
        case 'drop': // 丟香蕉：啵一聲
          this._toneAt(t, 'sine', 720, 170, 0.13, 0.2, out);
          this._noiseAt(t, 0.03, 0.08, 'highpass', 3000, 3000, 0.7, out);
          if (level >= 2) this._toneAt(t + 0.08, 'sine', 650, 160, 0.13, 0.16, out);
          break;
        case 'missile': // 發射導彈：點火噴射＋（追蹤導彈）鎖定嗶嗶
          this._noiseAt(t, 0.55, 0.18, 'bandpass', 1500, 350, 1.4, out);
          this._toneAt(t, 'sawtooth', 900, 240, 0.4, 0.09, out, 2400);
          if (level >= 2) {
            this._toneAt(t + 0.1, 'square', 1760, 1760, 0.06, 0.06, out);
            this._toneAt(t + 0.22, 'square', 1760, 1760, 0.06, 0.06, out);
          }
          break;

        // ---------- 碰撞與受擊 ----------
        case 'hit': // 導彈命中：爆炸
          this._noiseAt(t, 0.8, 0.4, 'lowpass', 3200, 140, 0.8, out);
          this._toneAt(t, 'sine', 90, 32, 0.55, 0.35, out);
          break;
        case 'spin': // 踩香蕉打滑：三段下滑音
          for (let i = 0; i < 3; i++) {
            this._toneAt(t + i * 0.12, 'triangle', 900 - i * 120, 380 - i * 60, 0.12, 0.12, out);
          }
          this._noiseAt(t, 0.45, 0.07, 'bandpass', 1200, 900, 3, out);
          break;
        case 'bump': { // 車與車碰撞：悶撞＋金屬敲擊（相對速度越快越大聲）
          const amt = clamp01(((extra && extra.speed) || 10) / 25) * 0.7 + 0.3;
          this._toneAt(t, 'sine', 170, 65, 0.13, 0.3 * amt, out);
          this._noiseAt(t, 0.09, 0.2 * amt, 'lowpass', 1400, 500, 0.7, out);
          this._toneAt(t, 'square', 1250, 900, 0.05, 0.04 * amt, out, 4000);
          break;
        }
        case 'wall': { // 撞牆：比較重的撞擊與刮擦
          const amt = clamp01(((extra && extra.speed) || 15) / 30) * 0.7 + 0.3;
          this._noiseAt(t, 0.2, 0.28 * amt, 'lowpass', 900, 250, 0.7, out);
          this._toneAt(t, 'square', 140, 55, 0.15, 0.12 * amt, out, 800);
          this._noiseAt(t + 0.02, 0.18, 0.06 * amt, 'bandpass', 2600, 1800, 4, out);
          break;
        }
        case 'jump':
          this._toneAt(t, 'sine', 280, 720, 0.25, 0.15, out);
          this._noiseAt(t, 0.2, 0.05, 'bandpass', 800, 2000, 1, out);
          break;
        case 'land':
          this._toneAt(t, 'sine', 130, 48, 0.2, 0.3, out);
          this._noiseAt(t, 0.14, 0.18, 'lowpass', 1200, 300, 0.7, out);
          break;
        case 'wrong_way': // 逆向警告：低音蜂鳴兩聲
          this._toneAt(t, 'square', 196, 196, 0.16, 0.1, out, 1200);
          this._toneAt(t + 0.22, 'square', 196, 196, 0.16, 0.1, out, 1200);
          break;

        // ---------- 比賽進度 ----------
        case 'lap':
          this._toneAt(t, 'triangle', 1319, 1319, 0.15, 0.13, out);
          this._toneAt(t + 0.12, 'triangle', 1760, 1760, 0.3, 0.13, out);
          break;
        case 'final_lap': // 最後一圈小號角
          [523, 659, 784, 1046].forEach((f, i) => {
            this._toneAt(t + i * 0.11, 'square', f, f, i === 3 ? 0.6 : 0.1, 0.08, out, 3000);
          });
          break;
        case 'finished': // 完賽歡呼旋律
          [523, 659, 784, 1046, 1319].forEach((f, i) => {
            this._toneAt(t + i * 0.1, 'triangle', f, f, i === 4 ? 0.7 : 0.14, 0.14, out);
          });
          break;
        case 'race_over':
          [784, 659, 784, 1046].forEach((f, i) => {
            this._toneAt(t + i * 0.16, 'square', f, f, i === 3 ? 0.8 : 0.14, 0.07, out, 2500);
            this._toneAt(t + i * 0.16, 'sine', f / 2, f / 2, i === 3 ? 0.8 : 0.14, 0.1, out);
          });
          break;

        // ---------- 介面 ----------
        case 'select':
          this._toneAt(t, 'square', 880, 1320, 0.07, 0.07, out, 3000);
          break;
      }
    } catch (err) {
      // 容錯處理：音效失敗不影響遊戲
    }
  }

  // 建立單次音效的輸出（音量＋左右聲道），播完自動被垃圾回收
  _makeOut(vol, pan) {
    const g = this.ctx.createGain();
    g.gain.value = vol;
    if (pan && typeof this.ctx.createStereoPanner === 'function') {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      p.connect(this.sfxBus);
    } else {
      g.connect(this.sfxBus);
    }
    return g;
  }

  // 振盪器音：從 f1 滑到 f2，指數衰減；filterFreq 有值時加低通濾波讓方波/鋸齒波不刺耳
  _toneAt(t, type, f1, f2, dur, peak, out, filterFreq = null) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, f1), t);
    if (f2 !== f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (filterFreq) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filterFreq;
      osc.connect(f);
      f.connect(g);
    } else {
      osc.connect(g);
    }
    g.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // 濾波噪音：濾波頻率從 f1 滑到 f2（爆炸、呼嘯、撞擊、鼓）
  _noiseAt(t, dur, peak, filterType, f1, f2, q, out) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.Q.value = q;
    f.frequency.setValueAtTime(f1, t);
    if (f2 !== f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(t, Math.random() * 1.0, dur + 0.05);
  }
}
