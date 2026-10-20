// ============================================================
//  camera.js — 多人共用智慧追蹤相機
//  固定方向斜俯視視角（不跟隨單一車輛旋轉，多人同屏不暈眩）。
//  自動計算所有真人賽車之包圍框，動態調整中心與高度（35 ~ 260），
//  並同步更新日光陰影相機焦點。
// ============================================================

import * as THREE from 'three';
import { clamp, damp } from './utils.js';

export class RaceCamera {
  constructor(camera, light = null) {
    this.camera = camera;
    this.light = light;

    // 當前平滑目標點與相機高度
    this.target = new THREE.Vector3(0, 0, 0);
    this.height = 70;
  }

  // 每幀更新相機位置與縮放
  update(dt, racers) {
    if (!racers || racers.length === 0) {
      // 預設俯瞰賽道中央
      this.target.set(0, 0, 0);
      this.height = 140;
      this._applyTransform();
      return;
    }

    // 優先框住真人玩家；若無真人則框住全體車輛
    let targetRacers = racers.filter((r) => r.kind !== 'ai');
    if (targetRacers.length === 0) {
      targetRacers = racers;
    }

    // 計算目標車輛的邊界框與速度前瞻
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (const r of targetRacers) {
      const car = r.car;
      if (!car) continue;

      // 前瞻點（速度越快往前瞻越遠）
      const lookAheadDist = car.speed * 0.4;
      const fx = car.x + Math.sin(car.heading) * lookAheadDist;
      const fz = car.z + Math.cos(car.heading) * lookAheadDist;

      minX = Math.min(minX, car.x, fx);
      maxX = Math.max(maxX, car.x, fx);
      minZ = Math.min(minZ, car.z, fz);
      maxZ = Math.max(maxZ, car.z, fz);
    }

    if (!Number.isFinite(minX)) {
      minX = maxX = 0;
      minZ = maxZ = 0;
    }

    // 計算幾何中心
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;

    // 計算包圍盒跨度並推導合適的相機高度（範圍 35 ~ 260）
    const spanX = maxX - minX;
    const spanZ = maxZ - minZ;
    const maxSpan = Math.max(spanX, spanZ);

    const desiredHeight = clamp(35 + maxSpan * 0.75, 35, 260);

    // 平滑插值（Damp）
    this.target.x = damp(this.target.x, centerX, 5, dt);
    this.target.z = damp(this.target.z, centerZ, 5, dt);
    this.target.y = 0;
    this.height = damp(this.height, desiredHeight, 4, dt);

    this._applyTransform();
  }

  // 套用相機位置與陰影光照焦點
  _applyTransform() {
    // 固定斜上方俯視角度（向 +Z 偏移高度的 0.75 倍）
    const camX = this.target.x;
    const camY = this.height;
    const camZ = this.target.z + this.height * 0.75;

    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(this.target.x, this.target.y, this.target.z);

    // 陰影聚焦點跟隨相機中心移動
    if (this.light) {
      this.light.position.set(this.target.x + 60, 100, this.target.z + 40);
      this.light.target.position.set(this.target.x, 0, this.target.z);
      this.light.target.updateMatrixWorld();
    }
  }
}
