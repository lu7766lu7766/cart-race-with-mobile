// ============================================================
//  utils.js — 常用的小工具
// ============================================================

// 把數字限制在 min ~ max 之間
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// 線性插值：t=0 得到 a，t=1 得到 b
export const lerp = (a, b, t) => a + (b - a) * t;

// 隨機小數 min ~ max
export const rand = (min, max) => min + Math.random() * (max - min);

// 兩個角度的差（結果落在 -π ~ π），用來判斷「要往左轉還是往右轉」
export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// 和幀率無關的平滑移動：每秒靠近目標 rate 的比例
export const damp = (current, target, rate, dt) => lerp(current, target, 1 - Math.exp(-rate * dt));

// 把秒數變成 1:23.45 的格式
export function formatTime(sec) {
  if (sec == null || !isFinite(sec)) return '--:--.--';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

// 小型事件系統：game.on('事件名', 函式) 訂閱、emit('事件名', 資料) 通知
export class Emitter {
  constructor() {
    this.listeners = {};
  }
  on(name, fn) {
    (this.listeners[name] ||= []).push(fn);
    return () => this.off(name, fn); // 回傳「取消訂閱」的函式
  }
  off(name, fn) {
    this.listeners[name] = (this.listeners[name] || []).filter((f) => f !== fn);
  }
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
