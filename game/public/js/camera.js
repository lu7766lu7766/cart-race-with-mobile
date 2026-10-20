// ============================================================
//  camera.js — 鏡頭管理（ChaseCamera 追尾鏡頭與 OverviewCamera 全場俯視）
//  實現陸行鳥大賽車經典風格之追尾視角：平滑跟隨、速度感 FOV 動態變化、
//  甩尾側滑延遲朝向跟隨、防穿地高程保護，以及 Sprite 名字圖層隔離（每位玩家不看自己的名字標籤）。
//  本模組亦匯出純函式 getViewportRects 供分割畫面渲染與 HUD 面板排版使用。
// ============================================================

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, damp, angleDiff, getViewportRects } from './utils.js';

export { getViewportRects };

// 單人追尾視角相機（每位上場真人各分配一個）
export class ChaseCamera {
  constructor(slot, track) {
    this.slot = slot;
    this.track = track;

    this.camera = new THREE.PerspectiveCamera(CONFIG.CHASE_FOV_MIN, 1, 1, 1000);
    // 開啟全部玩家名字 Sprite 圖層（1~4）
    for (let s = 1; s <= 4; s++) {
      this.camera.layers.enable(s);
    }
    // 關閉自己那一格的名字 Sprite 圖層（自己不顯示自己的名字）
    this.camera.layers.disable(slot + 1);

    // 狀態追蹤
    this.camHeading = 0;
    this.currentFov = CONFIG.CHASE_FOV_MIN;
    this.targetPos = new THREE.Vector3(0, 5, -10);
    this.initialized = false;
  }

  // 重設相機初始化標記（新開賽倒數時重設位置朝向，避免從上一場終點滑移）
  reset() {
    this.initialized = false;
  }

  // 每幀更新相機位置與朝向
  update(dt, car) {
    if (!car) return;

    // 初次初始化直接對齊車輛位置
    if (!this.initialized) {
      this.camHeading = car.heading;
      const initFx = Math.sin(this.camHeading);
      const initFz = Math.cos(this.camHeading);
      this.camera.position.set(
        car.x - initFx * CONFIG.CHASE_DISTANCE,
        car.y + CONFIG.CHASE_HEIGHT,
        car.z - initFz * CONFIG.CHASE_DISTANCE
      );
      this.initialized = true;
    }

    // 1. 鏡頭朝向跟隨（平滑追隨 car.heading，率約 5）
    // 打滑旋轉時鏡頭不跟隨車身打轉；打滑結束時以有上限的轉速（4 rad/s）追回，避免鏡頭瞬間甩過去
    if (car.spinTimer <= 0) {
      const diff = angleDiff(this.camHeading, car.heading);
      const turnAmount = diff * (1 - Math.exp(-CONFIG.CHASE_ROT_DAMP * dt));
      const maxTurn = 4.0 * dt;
      this.camHeading += clamp(turnAmount, -maxTurn, maxTurn);
    }

    const fx = Math.sin(this.camHeading);
    const fz = Math.cos(this.camHeading);

    // 2. 目標相機位置（車尾後方 CHASE_DISTANCE，高度 CHASE_HEIGHT）
    const desiredX = car.x - fx * CONFIG.CHASE_DISTANCE;
    const desiredZ = car.z - fz * CONFIG.CHASE_DISTANCE;
    let desiredY = car.y + CONFIG.CHASE_HEIGHT;

    // 防穿地保護：鏡頭高度不得低於該處地面高度 + 1.5
    if (this.track) {
      const proj = this.track.project(desiredX, desiredZ);
      const groundAtCam = this.track.groundHeight(proj.index, proj.t);
      if (desiredY < groundAtCam + 1.5) {
        desiredY = groundAtCam + 1.5;
      }
    }

    // 位置平滑插值
    this.camera.position.x = damp(this.camera.position.x, desiredX, CONFIG.CHASE_POS_DAMP, dt);
    this.camera.position.y = damp(this.camera.position.y, desiredY, 6, dt);
    this.camera.position.z = damp(this.camera.position.z, desiredZ, CONFIG.CHASE_POS_DAMP, dt);

    // 3. 看向車子前方 CHASE_LOOK_AHEAD 處
    const carFx = Math.sin(car.heading);
    const carFz = Math.cos(car.heading);
    const lookAtX = car.x + carFx * CONFIG.CHASE_LOOK_AHEAD;
    const lookAtY = car.y + 1.5;
    const lookAtZ = car.z + carFz * CONFIG.CHASE_LOOK_AHEAD;
    this.camera.lookAt(lookAtX, lookAtY, lookAtZ);

    // 4. 動態速度感 FOV（60 ~ 72，加速再 +6）
    const speedRatio = clamp(Math.abs(car.speed) / CONFIG.MAX_SPEED, 0, 1);
    let targetFov = CONFIG.CHASE_FOV_MIN + (CONFIG.CHASE_FOV_MAX - CONFIG.CHASE_FOV_MIN) * speedRatio;
    if (car.boostTimer > 0) {
      targetFov += CONFIG.CHASE_FOV_BOOST;
    }
    this.currentFov = damp(this.currentFov, targetFov, 4, dt);
    this.camera.fov = this.currentFov;
    this.camera.updateProjectionMatrix();
  }
}

// 全場俯視/環繞相機（大廳慢速環繞、結算畫面、3 人模式第 4 格全場俯視或 0 人除錯）
export class OverviewCamera {
  constructor(track = null) {
    this.track = track;
    this.camera = new THREE.PerspectiveCamera(50, 1, 1, 2000);
    // 開啟全部玩家名字圖層
    for (let s = 1; s <= 4; s++) {
      this.camera.layers.enable(s);
    }
    this.orbitAngle = 0;
  }

  // 大廳環繞視角
  updateLobby(dt) {
    this.orbitAngle += 0.25 * dt;
    const r = 85;
    const cx = 0;
    const cz = 110 * 1.15; // 起點直道附近
    this.camera.position.set(cx + Math.cos(this.orbitAngle) * r, 35, cz + Math.sin(this.orbitAngle) * r);
    this.camera.lookAt(cx, 5, cz);
    this.camera.updateProjectionMatrix();
  }

  // 全場俯視（框住整條賽道）
  updateOverview() {
    this.camera.position.set(0, 360, 260);
    this.camera.lookAt(0, 0, -10);
    this.camera.updateProjectionMatrix();
  }
}
