// ============================================================
//  car.js — 車輛物理、狀態更新與 3D 模型渲染
//  負責街機手感駕駛物理（加速/煞車/轉向/草地減速/撞牆反彈）、
//  圈數進度計算（progress）、道具狀態（加速/護盾/打滑/彈起）與車輛視圖同步。
//  本模組物理核心不依賴 DOM，可在 Node.js 環境中執行與測試。
// ============================================================

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, damp } from './utils.js';

export class Car {
  constructor({ slot = 0, track, player = null }) {
    this.slot = slot;
    this.player = player;
    this.track = track;

    // 起始位置與朝向依據發車格位
    const grid = track.startGrid(slot);
    this.x = grid.x;
    this.y = 0;              // 跳起高度（垂直 Y 軸）
    this.z = grid.z;
    this.vy = 0;             // 垂直速度
    this.heading = grid.heading; // 前進方向角（(sin(heading), cos(heading)) 為前進向量）
    this.speed = 0;          // 前進速度（正為前進，負為倒車）
    this.steerAngle = 0;     // 前輪轉向角度

    // 狀態計時器
    this.boostTimer = 0;     // 氮氣/加速板計時器
    this.shieldTimer = 0;    // 護盾計時器
    this.spinTimer = 0;      // 踩香蕉打滑計時器
    this.hitTimer = 0;       // 被導彈擊中停頓計時器

    // 賽道進度與圈數追蹤
    this.trackIndex = grid.index;
    this.lateral = grid.lateral;
    // 出生時在起跑線後方，progress 為負數（index - N）
    this.progress = grid.index - track.N;

    // 圈數狀態
    this.lapsDone = Math.floor(this.progress / track.N); // 起跑線前為 -1，第 1 圈為 0
    this.maxLapsDone = 0;                                // 記錄已通過的最大圈數
    this.lap = clamp(this.lapsDone + 1, 1, CONFIG.LAPS); // 顯示圈數 1~3
    this.finished = false;                               // 是否已完賽
    this.finishTime = null;                              // 完賽成績（秒）
    this.lapTimes = [];                                  // 每一圈單圈時間
    this.lapStartTime = 0;                               // 當前圈開始時間

    // 碰撞與事件標記
    this.wallHitThisFrame = false;
    this.touchingWall = false; // 是否正處於貼牆狀態（防連續乘 0.4 黏死）

    // 3D 視覺參考
    this.viewGroup = null;
    this.wheels = { fl: null, fr: null, bl: null, br: null };
    this.shieldMesh = null;
    this.colorRing = null;
  }

  // 物理更新步長
  update(dt, inputState, track) {
    // 1. 更新所有道具與異常狀態計時器
    if (this.boostTimer > 0) this.boostTimer = Math.max(0, this.boostTimer - dt);
    if (this.shieldTimer > 0) this.shieldTimer = Math.max(0, this.shieldTimer - dt);
    if (this.spinTimer > 0) this.spinTimer = Math.max(0, this.spinTimer - dt);
    if (this.hitTimer > 0) this.hitTimer = Math.max(0, this.hitTimer - dt);

    // 2. 垂直彈跳物理（被導彈打中時會彈起）
    if (this.y > 0 || this.vy !== 0) {
      this.vy -= 40 * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
      }
    }

    // 3. 輸入讀取與異常狀態處理
    let steer = 0;
    let throttle = 0;
    let brake = 0;

    if (this.hitTimer > 0) {
      // 導彈擊中：停頓不能操作，速度歸零
      this.speed = 0;
    } else if (this.spinTimer > 0) {
      // 香蕉打滑：無法操控，旋轉打轉，速度大幅衰減
      this.heading += 12 * dt;
      this.speed = damp(this.speed, 0, 4, dt);
    } else {
      // 正常操作
      steer = clamp(inputState?.steer ?? 0, -1, 1);
      throttle = clamp(inputState?.throttle ?? 0, 0, 1);
      brake = clamp(inputState?.brake ?? 0, 0, 1);

      // 4. 轉向計算
      // 靜止時不能原地轉彎；倒車時轉向方向相反
      const speedRatio = clamp(Math.abs(this.speed) / 8, 0, 1);
      const steerDir = this.speed >= 0 ? 1 : -1;
      this.steerAngle = damp(this.steerAngle, steer * 0.45, 12, dt);
      this.heading += steer * CONFIG.TURN_RATE * speedRatio * steerDir * dt;

      // 5. 速度與加減速計算
      // 判斷是否在草地路肩（超出路面半寬即為草地）
      const isOffroad = Math.abs(this.lateral) > (track.width / 2);
      let maxSpeed = this.boostTimer > 0 ? CONFIG.BOOST_SPEED : CONFIG.MAX_SPEED;
      let accel = CONFIG.ACCEL;

      if (isOffroad) {
        maxSpeed *= CONFIG.OFFROAD_FACTOR;
        accel *= CONFIG.OFFROAD_FACTOR;
      }

      if (throttle > 0) {
        if (this.speed < 0) {
          // 原本在倒車，按油門先當作煞車
          this.speed += CONFIG.BRAKE * dt;
        } else {
          // 前進加速（speed < maxSpeed 時才加速封頂；speed > maxSpeed 時用 COAST_DRAG 慢慢降回）
          if (this.speed < maxSpeed) {
            this.speed = Math.min(maxSpeed, this.speed + throttle * accel * dt);
          } else {
            this.speed = Math.max(maxSpeed, this.speed - CONFIG.COAST_DRAG * dt);
          }
        }
      } else if (brake > 0) {
        if (this.speed > 0) {
          // 前進中按煞車
          this.speed = Math.max(0, this.speed - brake * CONFIG.BRAKE * dt);
        } else {
          // 倒車加速（速度為負值）
          this.speed = Math.max(-CONFIG.REVERSE_SPEED, this.speed - brake * (accel * 0.7) * dt);
        }
      } else {
        // 放開油門自然滑行減速
        if (this.speed > 0) {
          this.speed = Math.max(0, this.speed - CONFIG.COAST_DRAG * dt);
        } else if (this.speed < 0) {
          this.speed = Math.min(0, this.speed + CONFIG.COAST_DRAG * dt);
        }
      }
    }

    // 6. 位移更新
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    this.x += fx * this.speed * dt;
    this.z += fz * this.speed * dt;

    // 7. 賽道投影與側向邊界（撞牆判定）
    const proj = track.project(this.x, this.z, this.trackIndex);
    const oldIndex = this.trackIndex;
    this.trackIndex = proj.index;
    this.lateral = proj.lateral;

    // 撞牆檢查：超過路肩極限就推回邊界
    // 只有初次撞上（上一幀未貼牆）才扣除速度乘 0.4；貼牆時把車頭往切線方向偏轉避免黏牆停死
    const maxLat = track.width / 2 + track.shoulder - CONFIG.CAR_RADIUS;
    this.wallHitThisFrame = false;
    if (Math.abs(this.lateral) > maxLat) {
      const wasTouching = this.touchingWall;
      this.touchingWall = true;

      this.lateral = Math.sign(this.lateral) * maxLat;
      const repushed = track.pointAtLateral(this.trackIndex, this.lateral);
      this.x = repushed.x;
      this.z = repushed.z;

      // 修正車頭朝向：向賽道切線平滑靠攏，避免持續面朝牆壁
      const tangent = track.sampleAt(this.trackIndex).tangent;
      const trackHeading = Math.atan2(tangent.x, tangent.z);
      this.heading = damp(this.heading, trackHeading, 8, dt);

      if (!wasTouching) {
        this.speed *= 0.4;
        this.wallHitThisFrame = true;
      }
    } else {
      this.touchingWall = false;
    }

    // 8. 累加賽道連續進度 progress（防止倒著跑刷圈）
    let delta = this.trackIndex - oldIndex;
    if (delta > track.N / 2) delta -= track.N;
    if (delta < -track.N / 2) delta += track.N;
    this.progress += delta;

    this.lapsDone = Math.floor(this.progress / track.N);
    this.lap = clamp(this.lapsDone + 1, 1, CONFIG.LAPS);
  }

  // 被導彈擊中
  hitByMissile(byPlayer) {
    if (this.shieldTimer > 0) {
      // 護盾成功抵擋！護盾消失但車輛不受影響
      this.shieldTimer = 0;
      return false;
    }
    this.hitTimer = CONFIG.HIT_TIME;
    this.vy = 12;
    this.speed = 0;
    return true;
  }

  // 踩到香蕉皮
  hitBanana() {
    if (this.shieldTimer > 0) {
      // 護盾成功抵擋！
      this.shieldTimer = 0;
      return false;
    }
    this.spinTimer = CONFIG.SPIN_TIME;
    this.speed *= 0.3;
    return true;
  }

  // 使用氮氣加速
  applyBoost(duration = CONFIG.NITRO_TIME) {
    this.boostTimer = Math.max(this.boostTimer, duration);
  }

  // 啟動護盾
  applyShield(duration = CONFIG.SHIELD_TIME) {
    this.shieldTimer = Math.max(this.shieldTimer, duration);
  }

  // 建立 3D 視覺模型
  attachView(scene, assets, colorHex) {
    if (!scene) return;

    this.viewGroup = new THREE.Group();
    this.viewGroup.name = `car_${this.slot}`;

    // 1. 車輛本體（使用 Kenney GLB 或彩色備用方塊）
    let model = null;
    const kartFile = (assets && assets.getKart) ? assets.getKart(this.slot) : null;
    if (kartFile) {
      model = kartFile;
    } else {
      // 備用簡單方塊模型
      const boxGeo = new THREE.BoxGeometry(1.4, 0.8, 2.2);
      const boxMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.5 });
      model = new THREE.Mesh(boxGeo, boxMat);
      model.position.y = 0.4;
    }

    const scale = CONFIG.KART_SCALE || 2.2;
    model.scale.set(scale, scale, scale);
    this.viewGroup.add(model);

    // 尋找車輪節點（Kenney 模型內部名稱）
    this.wheels = {
      fl: model.getObjectByName('wheel-front-left'),
      fr: model.getObjectByName('wheel-front-right'),
      bl: model.getObjectByName('wheel-back-left'),
      br: model.getObjectByName('wheel-back-right'),
    };

    // 2. 車底玩家顏色光圈
    const ringGeo = new THREE.RingGeometry(1.2, 1.6, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
    });
    this.colorRing = new THREE.Mesh(ringGeo, ringMat);
    this.colorRing.rotation.x = -Math.PI / 2;
    this.colorRing.position.y = 0.04;
    this.viewGroup.add(this.colorRing);

    // 3. 護盾半透明能量泡泡
    const shieldGeo = new THREE.SphereGeometry(2.3, 20, 20);
    const shieldMat = new THREE.MeshStandardMaterial({
      color: 0x00d2d3,
      transparent: true,
      opacity: 0.45,
      roughness: 0.2,
      metalness: 0.8,
    });
    this.shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
    this.shieldMesh.position.y = 0.9;
    this.shieldMesh.visible = false;
    this.viewGroup.add(this.shieldMesh);

    scene.add(this.viewGroup);
  }

  // 每幀同步 3D 視覺（位置、朝向、輪子旋轉、車身側傾、護盾）
  syncView(dt) {
    if (!this.viewGroup) return;

    this.viewGroup.position.set(this.x, this.y, this.z);
    this.viewGroup.rotation.y = this.heading + (CONFIG.KART_YAW_OFFSET || 0);

    // 轉彎時車身側傾（動態回饋）
    const roll = -this.steerAngle * clamp(Math.abs(this.speed) / CONFIG.MAX_SPEED, 0, 1) * 0.18;
    this.viewGroup.rotation.z = roll;

    // 前輪隨方向盤轉向，四輪隨車速滾動
    const wheelRoll = (this.speed * dt) / 0.35; // 假設車輪半徑約 0.35
    if (this.wheels.fl) {
      this.wheels.fl.rotation.y = this.steerAngle;
      this.wheels.fl.rotation.x += wheelRoll;
    }
    if (this.wheels.fr) {
      this.wheels.fr.rotation.y = this.steerAngle;
      this.wheels.fr.rotation.x += wheelRoll;
    }
    if (this.wheels.bl) {
      this.wheels.bl.rotation.x += wheelRoll;
    }
    if (this.wheels.br) {
      this.wheels.br.rotation.x += wheelRoll;
    }

    // 護盾顯示
    if (this.shieldMesh) {
      this.shieldMesh.visible = this.shieldTimer > 0;
      if (this.shieldMesh.visible) {
        this.shieldMesh.rotation.y += 2 * dt;
      }
    }
  }

  // 銷毀 3D 視覺物件
  detachView() {
    if (this.viewGroup && this.viewGroup.parent) {
      this.viewGroup.parent.remove(this.viewGroup);
      this.viewGroup = null;
    }
  }
}
