// ============================================================
//  ai.js — 電腦玩家（AI）輸入控制
//  負責路徑巡航、車道偏移、彎道減速、卡住脫困與智慧道具施放。
//  本模組為純邏輯運算，在 Node.js 中可正常 import 執行。
// ============================================================

import { CONFIG } from './config.js';
import { clamp, angleDiff, rand } from './utils.js';

export class AIInput {
  constructor({ car = null, game = null, rng = null, speedFactor = null } = {}) {
    this.car = car;
    this.game = game;
    this.rng = rng || (game && game.rng) || Math.random;

    // 每台 AI 擁有各自的車道偏移（-4 ~ 4）與速度係數（0.92 ~ 0.96）
    this.laneOffset = rand(-4, 4, this.rng);
    this.speedFactor = speedFactor ?? rand(CONFIG.AI_SPEED_MIN, CONFIG.AI_SPEED_MAX, this.rng);

    // 卡住脫困判定狀態
    this.isUnstucking = false;
    this.unstuckTimer = 0;
    this.unstuckSteerDir = 1;
    this.stuckCheckTimer = 0;
    this.lastProgress = 0;

    // 道具施放思考計時器
    this.itemWaitTimer = -1;
    this.hasItemLastFrame = false;
  }

  // 取得當前 AI 輸入狀態
  getState() {
    const dt = 1 / 60; // 核心模擬固定步長
    let steer = 0;
    let throttle = 0;
    let brake = 0;
    let useItem = false;

    if (!this.car || !this.car.track) {
      return { steer: 0, throttle: 0, brake: 0, useItem: false };
    }

    const car = this.car;
    const track = car.track;

    // 1. 卡住脫困機制
    // racing 狀態、速度 < 2 且 1.5 秒內 progress 增加 < 3 → 倒車＋反向打方向 1 秒
    if (this.game && this.game.state === 'racing') {
      this.stuckCheckTimer += dt;
      if (this.stuckCheckTimer >= 1.5) {
        const progressDiff = car.progress - this.lastProgress;
        if (Math.abs(car.speed) < 2.0 && progressDiff < 3) {
          this.isUnstucking = true;
          this.unstuckTimer = 1.0;
          this.unstuckSteerDir = car.lateral > 0 ? -1 : 1;
        }
        this.lastProgress = car.progress;
        this.stuckCheckTimer = 0;
      }
    }

    if (this.isUnstucking) {
      this.unstuckTimer -= dt;
      brake = 1.0;
      throttle = 0;
      steer = this.unstuckSteerDir;
      if (this.unstuckTimer <= 0) {
        this.isUnstucking = false;
      }
      return { steer, throttle, brake, useItem: false };
    }

    // 2. 賽道巡航路徑導航
    // 依據當前車速前瞻 12 ~ 20 個取樣點
    const speedRatio = clamp(Math.abs(car.speed) / CONFIG.MAX_SPEED, 0, 1);
    const lookaheadSamples = Math.floor(12 + speedRatio * 8);
    const targetIdx = (car.trackIndex + lookaheadSamples) % track.N;

    // 計算目標路徑點（加入固定車道偏移）
    const targetPos = track.pointAtLateral(targetIdx, this.laneOffset);
    const dx = targetPos.x - car.x;
    const dz = targetPos.z - car.z;

    // 前進朝向為 (sin(h), cos(h))，計算與目標點的角度差
    const targetHeading = Math.atan2(dx, dz);
    const diff = angleDiff(car.heading, targetHeading);

    // 轉向控制
    steer = clamp(diff * 2.8, -1, 1);

    // 3. 油門與煞車控制
    // 依據當前車輛狀態（是否加速中、是否在草地）決定即時最高速基準
    let currentBaseMax = car.boostTimer > 0 ? CONFIG.BOOST_SPEED : CONFIG.MAX_SPEED;
    if (Math.abs(car.lateral) > (track.width / 2)) {
      currentBaseMax *= CONFIG.OFFROAD_FACTOR;
    }
    const maxAllowedSpeed = currentBaseMax * this.speedFactor;
    if (Math.abs(diff) > 0.85) {
      // 遇急彎時收油門
      throttle = 0.2;
      if (car.speed > maxAllowedSpeed * 0.75) {
        brake = 0.4;
      }
    } else if (car.speed >= maxAllowedSpeed) {
      // 超過 AI 速度上限時鬆開油門
      throttle = 0;
      brake = 0;
    } else {
      // 直道或一般彎道全油門
      throttle = 1.0;
      brake = 0;
    }

    // 4. 智慧道具施放
    const currentItem = car.player?.item;
    if (currentItem) {
      if (!this.hasItemLastFrame) {
        // 剛拿到道具，隨機等待 1 ~ 3 秒後決定施放
        this.itemWaitTimer = rand(1.0, 3.0, this.rng);
        this.hasItemLastFrame = true;
      } else if (this.itemWaitTimer > 0) {
        this.itemWaitTimer -= dt;
        if (this.itemWaitTimer <= 0) {
          // 根據道具種類進行時機判斷
          if (currentItem === 'nitro') {
            // 氮氣在直線上施放（轉角小）
            if (Math.abs(diff) < 0.25) useItem = true;
            else this.itemWaitTimer = 0.5; // 再等半秒
          } else if (currentItem === 'missile') {
            // 導彈等前方有車時發射
            const hasRacerAhead = this._isRacerAhead(car);
            if (hasRacerAhead || Math.abs(diff) < 0.3) useItem = true;
            else this.itemWaitTimer = 0.5;
          } else if (currentItem === 'banana') {
            // 香蕉皮等後方有車或直接丟下
            useItem = true;
          } else if (currentItem === 'shield') {
            // 護盾立即施放防身
            useItem = true;
          } else {
            useItem = true;
          }
        }
      }
    } else {
      this.hasItemLastFrame = false;
      this.itemWaitTimer = -1;
    }

    return { steer, throttle, brake, useItem };
  }

  // 判斷前方視線內是否有其他賽車
  _isRacerAhead(myCar) {
    if (!this.game || !this.game.racers) return false;
    for (const r of this.game.racers) {
      if (!r.car || r.car === myCar) continue;
      const progressDiff = r.car.progress - myCar.progress;
      if (progressDiff > 0 && progressDiff < 100) {
        return true;
      }
    }
    return false;
  }
}
