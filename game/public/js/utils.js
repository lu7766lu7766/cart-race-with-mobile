// ============================================================
//  utils.js — 常用的小工具
//  包含數學輔助函式、亂數生成、時間格式化與簡易事件系統。
//  本模組為純邏輯，可在 Node.js 與瀏覽器環境中執行。
// ============================================================

// 把數字限制在 min ~ max 之間
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// 線性插值：t=0 得到 a，t=1 得到 b
export const lerp = (a, b, t) => a + (b - a) * t;

// 隨機小數 min ~ max，可傳入自訂的隨機函式 rng（例如 mulberry32）
export const rand = (min, max, rng = Math.random) => min + rng() * (max - min);

// 兩個角度的差（結果落在 -π ~ π），用來判斷「要往左轉還是往右轉」
export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// 和幀率無關的平滑移動：每秒靠近目標 rate 的比例
export const damp = (current, target, rate, dt) => lerp(current, target, 1 - Math.exp(-rate * dt));

// Mulberry32 偽隨機數生成器（32 位元），傳入整數種子，回傳 0~1 的隨機小數生成函式。
// 相同種子可產生完全一致的隨機數序列，適合單元測試與重播。
export function mulberry32(seed) {
  let a = (seed >>> 0);
  return function() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 把秒數變成 m:ss.cc 的格式（分:秒.百分秒）
// 先換算成整數百分秒再拆分/秒，避免 59.996 秒進位錯誤顯示為 0:60.00
export function formatTime(sec) {
  if (sec == null || !isFinite(sec)) return '--:--.--';
  const totalHundredths = Math.round(sec * 100);
  const totalSec = Math.floor(totalHundredths / 100);
  const hundredths = totalHundredths % 100;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}`;
}

// 小型事件系統：game.on('事件名', 函式) 訂閱、emit('事件名', 資料) 通知
export class Emitter {
  constructor() {
    this.listeners = {};
  }

  // 訂閱事件，回傳取消訂閱的函式
  on(name, fn) {
    (this.listeners[name] ||= []).push(fn);
    return () => this.off(name, fn);
  }

  // 取消訂閱
  off(name, fn) {
    this.listeners[name] = (this.listeners[name] || []).filter((f) => f !== fn);
  }

  // 發送事件
  emit(name, data) {
    for (const fn of this.listeners[name] || []) {
      try {
        fn(data);
      } catch (err) {
        console.error(`事件 ${name} 的處理函式出錯：`, err);
      }
    }
  }
}
