// ============================================================
//  input.js — 輸入抽象層（鍵盤輸入與空輸入）
//  提供統一的 getState() -> { steer, throttle, brake, drift, useItem } 介面，
//  使遊戲核心邏輯無縫支援鍵盤、AI 或未來的遠端手機輸入。
//  本模組類別在 Node.js 中可正常 import，頂層不存取 window/document。
// ============================================================

export class KeyboardInput {
  constructor(layout, target = typeof window !== 'undefined' ? window : null) {
    this.layout = layout;
    this.target = target;
    this.pressedKeys = new Set();
    this.itemTriggered = false;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);

    if (this.target && this.target.addEventListener) {
      this.target.addEventListener('keydown', this._onKeyDown);
      this.target.addEventListener('keyup', this._onKeyUp);
    }
  }

  _onKeyDown(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
      return;
    }

    const code = e.code;
    this.pressedKeys.add(code);

    // 檢查是否按下道具鍵（單次觸發）
    if (this.layout?.item?.includes(code)) {
      this.itemTriggered = true;
    }
  }

  _onKeyUp(e) {
    this.pressedKeys.delete(e.code);
  }

  // 取得當前輸入狀態（包含 6.3 甩尾按鍵）
  getState() {
    let throttle = 0;
    let brake = 0;
    let steer = 0;
    let drift = false;

    if (this.layout) {
      const isPressed = (keys) => keys?.some((k) => this.pressedKeys.has(k)) ?? false;

      if (isPressed(this.layout.up)) throttle = 1;
      if (isPressed(this.layout.down)) brake = 1;

      const left = isPressed(this.layout.left);
      const right = isPressed(this.layout.right);
      if (left && !right) steer = -1;
      else if (right && !left) steer = 1;

      if (isPressed(this.layout.drift)) drift = true;
    }

    const useItem = this.itemTriggered;
    this.itemTriggered = false;

    return { steer, throttle, brake, drift, useItem };
  }

  // 清空尚未讀取的道具觸發與按鍵
  reset() {
    this.itemTriggered = false;
    this.pressedKeys.clear();
  }

  // 移除事件監聽
  destroy() {
    if (this.target && this.target.removeEventListener) {
      this.target.removeEventListener('keydown', this._onKeyDown);
      this.target.removeEventListener('keyup', this._onKeyUp);
    }
    this.pressedKeys.clear();
    this.itemTriggered = false;
  }
}

// 空輸入類別（預設或斷線時使用）
export class NullInput {
  getState() {
    return { steer: 0, throttle: 0, brake: 0, drift: false, useItem: false };
  }
  reset() {}
  destroy() {}
}
