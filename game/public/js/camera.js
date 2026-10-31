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

  // 換地圖時切換賽道（清除快取的包圍盒與距離）
  setTrack(track) {
    this.track = track;
    this._lobbyPos = null; // 換地圖時鏡頭直接跳到新地圖
    this._bounds = undefined;
    this._fitAspect = null;
    this._fitDist = null;
  }

  // 大廳展示視角（三種模式，切換時鏡頭平滑移動）：
  //   focus = null                     ：在起跑格附近慢速環繞，展示 4 台車
  //   focus = { type: 'tour' }         ：剛換地圖時，從高空環繞整張地圖預覽地形
  //   focus = { type: 'kart', x, y, z }：剛換造型時，特寫該台卡丁車與車手
  // shiftRatio > 0 時用 setViewOffset 把畫面焦點往右移（左側留給大廳選單）
  updateLobby(dt, shiftRatio = 0, focus = null) {
    const targetPos = new THREE.Vector3();
    const targetLook = new THREE.Vector3();

    if (focus && focus.type === 'tour' && this.track) {
      this.orbitAngle += 0.35 * dt;
      const b = this._trackBounds();
      const span = Math.max(b.halfW, b.halfD);
      targetPos.set(b.cx + Math.cos(this.orbitAngle) * span * 1.05, span * 0.6, b.cz + Math.sin(this.orbitAngle) * span * 1.05);
      targetLook.set(b.cx, 0, b.cz);
    } else if (focus && focus.type === 'kart') {
      // 從車頭斜前方看（左右緩慢擺動），車手的臉與車身都看得到
      this.focusTime = (this.focusTime || 0) + dt;
      const a = (focus.heading || 0) + Math.sin(this.focusTime * 0.8) * 0.9;
      const r = 8;
      targetPos.set(focus.x + Math.sin(a) * r, focus.y + 3.4, focus.z + Math.cos(a) * r);
      targetLook.set(focus.x, focus.y + 1.4, focus.z);
    } else {
      this.orbitAngle += 0.22 * dt;
      let cx = 0, cy = 0, cz = 0;
      if (this.track) {
        // 焦點：4 個發車格的中心
        for (let slot = 0; slot < 4; slot++) {
          const g = this.track.startGrid(slot);
          cx += g.x / 4; cy += g.y / 4; cz += g.z / 4;
        }
      }
      const r = 32;
      targetPos.set(cx + Math.cos(this.orbitAngle) * r, cy + 11, cz + Math.sin(this.orbitAngle) * r);
      targetLook.set(cx, cy + 1.2, cz);
    }

    // 平滑移動（第一次直接就位）
    if (!this._lobbyPos) {
      this._lobbyPos = targetPos.clone();
      this._lobbyLook = targetLook.clone();
    } else {
      const k = 1 - Math.exp(-2.5 * dt);
      this._lobbyPos.lerp(targetPos, k);
      this._lobbyLook.lerp(targetLook, k);
    }
    this.camera.position.copy(this._lobbyPos);
    this.camera.lookAt(this._lobbyLook);

    const w = 1000;
    const h = w / (this.camera.aspect || 1);
    if (shiftRatio > 0) {
      this.camera.setViewOffset(w, h, -w * shiftRatio, 0, w, h);
    } else {
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();
  }

  // 全場俯視（依目前畫面比例算出剛好框住整條賽道的距離，讓賽道盡量放大）
  updateOverview() {
    this.camera.clearViewOffset();
    const bounds = this._trackBounds();
    if (!bounds) {
      this.camera.position.set(0, 360, 260);
      this.camera.lookAt(0, 0, -10);
      this.camera.updateProjectionMatrix();
      return;
    }

    // 從斜上方俯視（仰角約 60 度），水平與垂直方向各自需要的距離取較大者
    const elevation = Math.PI / 3;
    const margin = 1.08;
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const distForWidth = (bounds.halfW * margin) / Math.tan(hHalf) + bounds.halfD * Math.cos(elevation);
    const distForDepth = (bounds.halfD * Math.sin(elevation) * margin) / Math.tan(vHalf) + bounds.halfD * Math.cos(elevation);
    let dist = Math.max(distForWidth, distForDepth);

    // 畫面比例沒變就沿用上次算好的距離
    if (this._fitAspect === this.camera.aspect) {
      dist = this._fitDist;
    } else {
      this._placeOverview(bounds, elevation, dist);
      // 估算式偏保守：實際投影賽道點，依最外側點佔畫面的比例再縮放一次距離，讓賽道中心線填滿約 82%（留空間給路面寬度與玩家標記）
      this.camera.updateMatrixWorld();
      let extent = 0;
      const v = new THREE.Vector3();
      const points = this.track.points;
      for (let i = 0; i < points.length; i += 4) {
        v.set(points[i].x, 0, points[i].z).project(this.camera);
        extent = Math.max(extent, Math.abs(v.x), Math.abs(v.y));
      }
      if (extent > 0) dist *= extent / 0.82;
      this._fitAspect = this.camera.aspect;
      this._fitDist = dist;
    }

    this._placeOverview(bounds, elevation, dist);
  }

  _placeOverview(bounds, elevation, dist) {
    this.camera.position.set(
      bounds.cx,
      dist * Math.sin(elevation),
      bounds.cz + dist * Math.cos(elevation)
    );
    this.camera.lookAt(bounds.cx, 0, bounds.cz);
    this.camera.updateProjectionMatrix();
  }

  // 賽道 XZ 包圍盒（含路面與路肩寬度，只算一次）
  _trackBounds() {
    if (this._bounds !== undefined) return this._bounds;
    const points = this.track?.points;
    if (!points || points.length === 0) {
      this._bounds = null;
      return null;
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const edge = (this.track.width || CONFIG.TRACK_WIDTH) / 2 + CONFIG.SHOULDER;
    this._bounds = {
      cx: (minX + maxX) / 2,
      cz: (minZ + maxZ) / 2,
      halfW: (maxX - minX) / 2 + edge,
      halfD: (maxZ - minZ) / 2 + edge,
    };
    return this._bounds;
  }
}
