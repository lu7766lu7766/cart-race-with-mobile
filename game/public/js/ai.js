// ============================================================
//  ai.js — 電腦玩家（AI）輸入控制
//  負責路徑巡航導航（左右轉向新定義）、車道偏移、急彎減速、卡住脫困，
//  以及陸行鳥大賽車魔石道具升級保留策略（60% 機率留到下一排箱子後施放）。
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

    // 道具施放與升級保留計時器
    this.itemWaitTimer = -1;
    this.missileWaitTimer = 0;
    this.lastItem = null;
    this.lastItemLevel = 0;
    this.holdForUpgrade = false;
    this.holdTimer = 0;
    this.targetPassIndex = null;
  }

  // 取得當前 AI 輸入狀態
  getState() {
    const dt = 1 / 60;
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
    const speedRatio = clamp(Math.abs(car.speed) / CONFIG.MAX_SPEED, 0, 1);
    const lookaheadSamples = Math.floor(14 + speedRatio * 10);
    const targetIdx = (car.trackIndex + lookaheadSamples) % track.N;

    const targetPos = track.pointAtLateral(targetIdx, this.laneOffset);
    const dx = targetPos.x - car.x;
    const dz = targetPos.z - car.z;

    const targetHeading = Math.atan2(dx, dz);
    const diff = angleDiff(car.heading, targetHeading);

    // 6.0 修正：steer = +1 為往右轉（減少 heading），因此 steer = clamp(-diff * 2.8, -1, 1)
    steer = clamp(-diff * 2.8, -1, 1);

    // 3. 油門與煞車控制
    let currentBaseMax = car.boostTimer > 0
      ? (CONFIG.BOOST_SPEED * car.stats.boostSpeedMult)
      : (CONFIG.MAX_SPEED * car.stats.maxSpeedMult);

    if (Math.abs(car.lateral) > (track.width / 2)) {
      currentBaseMax *= car.stats.offroadFactor;
    }
    const maxAllowedSpeed = currentBaseMax * this.speedFactor;

    if (Math.abs(diff) > 0.85) {
      throttle = 0.2;
      if (car.speed > maxAllowedSpeed * 0.75) {
        brake = 0.4;
      }
    } else if (car.speed >= maxAllowedSpeed) {
      throttle = 0;
      brake = 0;
    } else {
      throttle = 1.0;
      brake = 0;
    }

    // 4. 道具升級與智慧施放策略（6.4）
    const currentItem = car.player?.item;
    const currentLevel = car.player?.itemLevel || 1;

    if (currentItem) {
      // 偵測是否為剛抽到或剛升級的道具
      if (this.lastItem !== currentItem || this.lastItemLevel !== currentLevel) {
        this.lastItem = currentItem;
        this.lastItemLevel = currentLevel;
        this.missileWaitTimer = 0;

        // 若為 Lv1 或 Lv2，以 60% 機率決定留著等升級
        if (currentLevel < 3 && this.rng() < 0.6) {
          this.holdForUpgrade = true;
          this.holdTimer = 12.0; // 最多留 12 秒
          this.targetPassIndex = this._findNextBoxRowIndex(car.trackIndex, track);
        } else {
          this.holdForUpgrade = false;
          this.itemWaitTimer = rand(1.0, 3.0, this.rng);
        }
      }

      // 若處於留著等升級狀態
      if (this.holdForUpgrade) {
        this.holdTimer -= dt;
        // 檢查是否已通過下一排道具箱
        let hasPassed = false;
        if (this.targetPassIndex != null) {
          let delta = car.trackIndex - this.targetPassIndex;
          if (delta < -track.N / 2) delta += track.N;
          if (delta > track.N / 2) delta -= track.N;
          if (delta > 0 && delta < 50) hasPassed = true;
        }

        if (hasPassed || this.holdTimer <= 0) {
          this.holdForUpgrade = false;
          this.itemWaitTimer = rand(0.5, 2.0, this.rng);
        }
      }

      // 當不再保留時，依照各道具特性施放
      if (!this.holdForUpgrade) {
        if (this.itemWaitTimer > 0) {
          this.itemWaitTimer -= dt;
        } else {
          if (currentItem === 'nitro') {
            if (Math.abs(diff) < 0.3) useItem = true;
            else this.itemWaitTimer = 0.4;
          } else if (currentItem === 'missile') {
            this.missileWaitTimer += dt;
            const hasAhead = this._isRacerAhead(car);
            // 導彈（任何等級）只在前方有車時發射，等最久 6 秒才放棄條件直接用
            if (hasAhead || this.missileWaitTimer >= 6.0) {
              useItem = true;
              this.missileWaitTimer = 0;
            } else {
              this.itemWaitTimer = 0.5;
            }
          } else if (currentItem === 'banana') {
            useItem = true;
          } else if (currentItem === 'shield') {
            useItem = true;
          } else {
            useItem = true;
          }
        }
      }
    } else {
      this.lastItem = null;
      this.lastItemLevel = 0;
      this.holdForUpgrade = false;
      this.itemWaitTimer = -1;
      this.missileWaitTimer = 0;
    }

    return { steer, throttle, brake, useItem };
  }

  // 尋找沿賽道前方的下一排道具箱索引
  _findNextBoxRowIndex(myIndex, track) {
    if (!this.game || !this.game.itemSystem || !this.game.itemSystem.boxes) {
      return null;
    }
    const boxIndices = [...new Set(this.game.itemSystem.boxes.map((b) => b.index))];
    boxIndices.sort((a, b) => a - b);

    for (const bIdx of boxIndices) {
      let delta = bIdx - myIndex;
      if (delta < -track.N / 2) delta += track.N;
      if (delta > track.N / 2) delta -= track.N;
      if (delta > 0) return bIdx;
    }
    return boxIndices[0] || null;
  }

  // 判斷前方視線內是否有其他賽車
  _isRacerAhead(myCar) {
    if (!this.game || !this.game.racers) return false;
    for (const r of this.game.racers) {
      if (!r.car || r.car === myCar || r.car.finished) continue;
      const progressDiff = r.car.progress - myCar.progress;
      if (progressDiff > 0 && progressDiff < (myCar.track.N / 2)) {
        return true;
      }
    }
    return false;
  }
}
