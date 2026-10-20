// ============================================================
//  car.js — 車輛物理、狀態更新、角色被動能力與 3D 模型渲染
//  負責街機手感駕駛物理（加速/煞車/轉向/草地減速/撞牆）、高低起伏與跳台垂直物理、
//  甩尾集氣與迷你加速、起跑衝刺、角色能力乘數（stats）與視圖同步。
//  本模組核心物理不依賴 DOM，可在 Node.js 環境中執行與測試。
// ============================================================

import * as THREE from 'three';
import { CONFIG, KARTS } from './config.js';
import { clamp, damp } from './utils.js';

export class Car {
  constructor({ slot = 0, track, player = null, onEvent = null }) {
    this.slot = slot;
    this.player = player;
    this.track = track;
    this.onEvent = onEvent || (() => {});

    // 依據角色設定被動能力乘數（stats）
    const kartConfig = KARTS[slot] || KARTS[0];
    this.stats = { ...kartConfig.stats };

    // 起始位置與朝向依據發車格位
    const grid = track.startGrid(slot);
    this.x = grid.x;
    this.y = grid.y;             // 世界高度（路面高度）
    this.z = grid.z;
    this.vy = 0;                 // 垂直速度
    this.grounded = true;        // 是否在地面上
    this.airTime = 0;            // 滯空時間（秒）
    this.pitchAngle = 0;         // 車身縱向坡度俯仰角（視覺）
    this.heading = grid.heading; // 前進方向角（(sin h, cos h) 為前進向量）
    this.speed = 0;              // 前進速度（正為前進，負為倒車）
    this.steerAngle = 0;         // 前輪轉向角度

    // 狀態計時器
    this.boostTimer = 0;         // 氮氣/加速板/落地加速計時器
    this.shieldTimer = 0;        // 護盾計時器
    this.shieldLevel = 0;        // 護盾等級（1~3）
    this.nitroLevel = 0;         // 氮氣等級（1~3）
    this.spinTimer = 0;          // 踩香蕉打滑計時器
    this.hitTimer = 0;           // 被導彈擊中停頓計時器
    this.spinOutTimer = 0;       // 起跑太早按油門空轉懲罰計時器

    // 甩尾狀態
    this.isDrifting = false;
    this.driftDir = 0;           // 甩尾方向：+1 往右，-1 往左
    this.driftCharge = 0;        // 甩尾集氣秒數
    this.driftLevel = 0;         // 0: 無, 1: 藍, 2: 橘, 3: 紫
    this.visualDriftYaw = 0;     // 甩尾時車身側滑視覺偏轉角

    // 賽道進度與圈數追蹤
    this.trackIndex = grid.index;
    this.lateral = grid.lateral;
    this.progress = grid.index - track.N;

    // 圈數狀態
    this.lapsDone = Math.floor(this.progress / track.N);
    this.maxLapsDone = 0;
    this.lap = clamp(this.lapsDone + 1, 1, CONFIG.LAPS);
    this.finished = false;
    this.finishTime = null;
    this.lapTimes = [];
    this.lapStartTime = 0;

    // 碰撞與事件標記
    this.wallHitThisFrame = false;
    this.touchingWall = false;

    // 3D 視覺參考
    this.viewGroup = null;
    this.wheels = { fl: null, fr: null, bl: null, br: null };
    this.shieldMesh = null;
    this.colorRing = null;
    this.nameSprite = null;
    this.sparkGroup = null;
  }

  // 物理更新步長
  update(dt, inputState, track) {
    // 1. 更新所有狀態計時器
    if (this.boostTimer > 0) {
      this.boostTimer = Math.max(0, this.boostTimer - dt);
      if (this.boostTimer === 0) this.nitroLevel = 0;
    }
    if (this.shieldTimer > 0) {
      this.shieldTimer = Math.max(0, this.shieldTimer - dt);
      if (this.shieldTimer === 0) this.shieldLevel = 0;
    }
    if (this.spinTimer > 0) this.spinTimer = Math.max(0, this.spinTimer - dt);
    if (this.hitTimer > 0) this.hitTimer = Math.max(0, this.hitTimer - dt);
    if (this.spinOutTimer > 0) this.spinOutTimer = Math.max(0, this.spinOutTimer - dt);

    // 2. 輸入讀取與異常狀態處理
    let steer = 0;
    let throttle = 0;
    let brake = 0;
    let wantDrift = false;

    if (this.hitTimer > 0) {
      // 導彈擊中：停頓不能動
      this.speed = 0;
      this._cancelDrift();
    } else if (this.spinOutTimer > 0) {
      // 起跑搶跑空轉停頓
      this.speed = 0;
      this._cancelDrift();
    } else if (this.spinTimer > 0) {
      // 香蕉打滑：無法操控，旋轉打轉，速度減慢
      this.heading += 12 * dt;
      this.speed = damp(this.speed, 0, 4, dt);
      this._cancelDrift();
    } else {
      // 正常操作讀取
      steer = clamp(inputState?.steer ?? 0, -1, 1);
      throttle = clamp(inputState?.throttle ?? 0, 0, 1);
      brake = clamp(inputState?.brake ?? 0, 0, 1);
      wantDrift = Boolean(inputState?.drift) || (throttle > 0.5 && brake > 0.5);

      // 空中轉向靈敏度降低，且油門無效
      if (!this.grounded) {
        steer *= 0.3;
        throttle = 0;
      }

      // 3. 甩尾邏輯更新
      if (wantDrift && !this.isDrifting && this.grounded) {
        if (this.speed > CONFIG.DRIFT_MIN_SPEED && Math.abs(steer) > 0.3) {
          this.isDrifting = true;
          this.driftDir = Math.sign(steer);
          this.driftCharge = 0;
          this.driftLevel = 0;
        }
      }

      if (this.isDrifting) {
        const speedInterrupted = this.speed < (CONFIG.DRIFT_MIN_SPEED * 0.6);
        const airInterrupted = !this.grounded;
        const wallInterrupted = this.wallHitThisFrame;

        if (speedInterrupted || airInterrupted || wallInterrupted || !wantDrift) {
          if (!wantDrift && !speedInterrupted && !airInterrupted && !wallInterrupted) {
            // 主動釋放迷你加速
            if (this.driftLevel === 1) {
              this.applyBoost(CONFIG.DRIFT_BOOST_T1);
              this.onEvent('miniTurbo', { level: 1 });
            } else if (this.driftLevel === 2) {
              this.applyBoost(CONFIG.DRIFT_BOOST_T2);
              this.onEvent('miniTurbo', { level: 2 });
            } else if (this.driftLevel === 3) {
              this.applyBoost(CONFIG.DRIFT_BOOST_T3);
              this.onEvent('miniTurbo', { level: 3 });
            }
          }
          this._cancelDrift();
        } else {
          // 累積集氣
          this.driftCharge += dt * this.stats.driftChargeRate;
          if (this.driftCharge >= CONFIG.DRIFT_T3) this.driftLevel = 3;
          else if (this.driftCharge >= CONFIG.DRIFT_T2) this.driftLevel = 2;
          else if (this.driftCharge >= CONFIG.DRIFT_T1) this.driftLevel = 1;
          else this.driftLevel = 0;

          throttle = 1.0;
          brake = 0;

          const into = steer * this.driftDir;
          const turnMultiplier = 0.6 + 0.4 * into;
          const driftTurnRate = CONFIG.TURN_RATE * turnMultiplier;

          const speedRatio = clamp(Math.abs(this.speed) / 8, 0, 1);
          this.heading -= this.driftDir * driftTurnRate * speedRatio * dt;
          this.steerAngle = damp(this.steerAngle, steer * 0.45, 12, dt);
          this.visualDriftYaw = damp(this.visualDriftYaw, -this.driftDir * 0.43, 10, dt);
        }
      } else {
        this.visualDriftYaw = damp(this.visualDriftYaw, 0, 10, dt);
        const speedRatio = clamp(Math.abs(this.speed) / 8, 0, 1);
        const steerDir = this.speed >= 0 ? 1 : -1;
        this.steerAngle = damp(this.steerAngle, steer * 0.45, 12, dt);
        this.heading -= steer * CONFIG.TURN_RATE * speedRatio * steerDir * dt;
      }

      // 4. 加速度與速度計算
      const isOffroad = Math.abs(this.lateral) > (track.width / 2);
      let baseMax = this.boostTimer > 0
        ? CONFIG.BOOST_SPEED * this.stats.boostSpeedMult
        : CONFIG.MAX_SPEED * this.stats.maxSpeedMult;

      let accel = CONFIG.ACCEL * this.stats.accelMult;

      const nextI = (this.trackIndex + 1) % track.N;
      const slopeSign = Math.sign(track.height[nextI] - track.height[this.trackIndex]);
      if (slopeSign > 0) accel *= 0.85;
      else if (slopeSign < 0) accel *= 1.10;

      if (isOffroad) {
        baseMax *= this.stats.offroadFactor;
        accel *= this.stats.offroadFactor;
      }

      if (this.isDrifting) {
        baseMax *= 0.95;
      }

      if (throttle > 0) {
        if (this.speed < 0) {
          this.speed += CONFIG.BRAKE * dt;
        } else {
          if (this.speed < baseMax) {
            this.speed = Math.min(baseMax, this.speed + throttle * accel * dt);
          } else {
            this.speed = Math.max(baseMax, this.speed - CONFIG.COAST_DRAG * dt);
          }
        }
      } else if (brake > 0) {
        if (this.speed > 0) {
          this.speed = Math.max(0, this.speed - brake * CONFIG.BRAKE * dt);
        } else {
          this.speed = Math.max(-CONFIG.REVERSE_SPEED, this.speed - brake * (accel * 0.7) * dt);
        }
      } else {
        if (this.speed > 0) {
          this.speed = Math.max(0, this.speed - CONFIG.COAST_DRAG * dt);
        } else if (this.speed < 0) {
          this.speed = Math.min(0, this.speed + CONFIG.COAST_DRAG * dt);
        }
      }
    }

    // 5. 平面位移更新（記錄移動前索引）
    const indexBeforeMove = this.trackIndex;
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    this.x += fx * this.speed * dt;
    this.z += fz * this.speed * dt;

    // 6. 移動後重新投影與取得地面世界高度
    const projAfter = track.project(this.x, this.z, this.trackIndex);
    const indexAfterMove = projAfter.index;
    this.trackIndex = indexAfterMove;
    this.lateral = projAfter.lateral;
    const currentGroundHeight = track.groundHeight(projAfter.index, projAfter.t);

    // 7. 邊界撞牆檢查與推回
    const maxLat = track.width / 2 + track.shoulder - CONFIG.CAR_RADIUS;
    this.wallHitThisFrame = false;

    if (Math.abs(this.lateral) > maxLat) {
      const wasTouching = this.touchingWall;
      this.touchingWall = true;

      this.lateral = Math.sign(this.lateral) * maxLat;
      const repushed = track.pointAtLateral(this.trackIndex, this.lateral);
      this.x = repushed.x;
      this.z = repushed.z;

      const s = track.sampleAt(this.trackIndex);
      const trackHeading = Math.atan2(s.tangent.x, s.tangent.z);
      this.heading = damp(this.heading, trackHeading, 8, dt);

      if (!wasTouching) {
        this.speed *= 0.4;
        this.wallHitThisFrame = true;
        this.onEvent('wallHit', {});
        if (this.isDrifting) {
          this._cancelDrift();
        }
      }
    } else {
      this.touchingWall = false;
    }

    // 8. 移動後檢查跳台觸發（使用有號環狀差判定是否前向跨過跳台）
    let d = indexAfterMove - indexBeforeMove;
    if (d > track.N / 2) d -= track.N;
    if (d < -track.N / 2) d += track.N;

    if (this.speed > 0 && Math.abs(this.lateral) < (track.width / 2) && (this.grounded || (this.y - currentGroundHeight < 0.8)) && track.jumps) {
      for (const jump of track.jumps) {
        const toJump = (jump.index - indexBeforeMove + track.N) % track.N;
        const crossed = d > 0 && toJump > 0 && toJump <= d;
        if (crossed) {
          this.vy = 6 + this.speed * 0.25;
          this.grounded = false;
          this.airTime = 0;
          this.y = Math.max(this.y, currentGroundHeight);
          this.onEvent('jumped', {});
          break;
        }
      }
    }

    // 9. 垂直運動與空中重力物理
    if (this.grounded) {
      this.y = currentGroundHeight;
      this.vy = 0;
      this.airTime = 0;

      const nextI = (this.trackIndex + 1) % track.N;
      const slope = (track.height[nextI] - track.height[this.trackIndex]) / 1.5;
      this.pitchAngle = damp(this.pitchAngle, -Math.atan(slope), 8, dt);
    } else {
      this.airTime += dt;
      this.vy -= CONFIG.GRAVITY * dt;
      this.y += this.vy * dt;

      // 著地判定（起飛至少 0.05 秒後才可判定著地，避免起飛瞬間或下一幀因坡度上升誤判著地）
      if (this.airTime > 0.05 && this.y <= currentGroundHeight) {
        this.y = currentGroundHeight;
        this.vy = 0;
        this.grounded = true;

        if (this.airTime > CONFIG.JUMP_MIN_AIR_BOOST) {
          this.applyBoost(CONFIG.JUMP_BOOST_TIME);
          this.onEvent('landed', { airTime: this.airTime });
        }
      }
    }

    // 10. 累加進度 progress
    this.progress += d;
    this.lapsDone = Math.floor(this.progress / track.N);
    this.lap = clamp(this.lapsDone + 1, 1, CONFIG.LAPS);
  }

  _cancelDrift() {
    this.isDrifting = false;
    this.driftCharge = 0;
    this.driftLevel = 0;
  }

  // 被導彈擊中
  hitByMissile(byPlayer) {
    if (this.shieldTimer > 0) {
      // Lv3 護盾無限次阻擋；Lv1/Lv2 擋一次後護盾消失
      if (this.shieldLevel < 3) {
        this.shieldTimer = 0;
        this.shieldLevel = 0;
      }
      return false;
    }
    this.hitTimer = CONFIG.HIT_TIME * this.stats.hitStunMult;
    this.vy = 12;
    this.grounded = false;
    this.speed = 0;
    this._cancelDrift();
    return true;
  }

  // 踩到香蕉皮
  hitBanana() {
    if (this.shieldTimer > 0) {
      if (this.shieldLevel < 3) {
        this.shieldTimer = 0;
        this.shieldLevel = 0;
      }
      return false;
    }
    this.spinTimer = CONFIG.SPIN_TIME;
    this.speed *= 0.3;
    this._cancelDrift();
    return true;
  }

  // 使用氮氣加速（可帶等級 level 1~3）
  applyBoost(duration = CONFIG.NITRO_TIME, level = 1) {
    this.boostTimer = Math.max(this.boostTimer, duration);
    if (level > this.nitroLevel) {
      this.nitroLevel = level;
    }
  }

  // 啟動護盾（等級 1~3）
  applyShield(duration = CONFIG.SHIELD_TIME, level = 1) {
    this.shieldTimer = Math.max(this.shieldTimer, duration);
    this.shieldLevel = Math.max(this.shieldLevel, level);
  }

  // 建立 3D 視覺模型
  attachView(scene, assets, colorHex) {
    if (!scene) return;

    this.viewGroup = new THREE.Group();
    this.viewGroup.name = `car_${this.slot}`;

    // 1. 車輛模型本體
    let model = null;
    const kartFile = (assets && assets.getKart) ? assets.getKart(this.slot) : null;
    if (kartFile) {
      model = kartFile;
    } else {
      const boxGeo = new THREE.BoxGeometry(1.4, 0.8, 2.2);
      const boxMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.5 });
      model = new THREE.Mesh(boxGeo, boxMat);
      model.position.y = 0.4;
    }

    const scale = CONFIG.KART_SCALE || 2.2;
    model.scale.set(scale, scale, scale);
    this.viewGroup.add(model);

    // 車輪節點
    this.wheels = {
      fl: model.getObjectByName('wheel-front-left'),
      fr: model.getObjectByName('wheel-front-right'),
      bl: model.getObjectByName('wheel-back-left'),
      br: model.getObjectByName('wheel-back-right'),
    };

    // 2. 底部玩家顏色光圈
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

    // 4. 車頂浮動姓名 Sprite（取代舊版 CSS2D 以支援分割畫面並指定 layer）
    if (this.player) {
      const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
      if (canvas) {
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(20, 24, 34, 0.85)';
        ctx.roundRect ? ctx.roundRect(4, 4, 248, 56, 16) : ctx.fillRect(4, 4, 248, 56);
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = colorHex;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 28px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.player.name, 128, 32);

        const tex = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
        this.nameSprite = new THREE.Sprite(spriteMat);
        this.nameSprite.scale.set(3.6, 0.9, 1);
        this.nameSprite.position.set(0, 2.2, 0);

        // 6.1: 名字 Sprite 放置於 layer (slot + 1)
        this.nameSprite.layers.set(this.slot + 1);
        this.viewGroup.add(this.nameSprite);
      }
    }

    // 5. 甩尾火花粒子群
    this.sparkGroup = new THREE.Group();
    const sparkMat = new THREE.PointsMaterial({
      size: 0.4,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
    });
    const sparkGeo = new THREE.BufferGeometry();
    const sparkPositions = new Float32Array(24 * 3);
    const sparkColors = new Float32Array(24 * 3);
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
    sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkColors, 3));
    this.sparkPoints = new THREE.Points(sparkGeo, sparkMat);
    this.sparkGroup.add(this.sparkPoints);
    this.sparkGroup.visible = false;
    this.viewGroup.add(this.sparkGroup);

    scene.add(this.viewGroup);
  }

  // 每幀同步 3D 視覺（位置、朝向、輪子滾動轉向、側傾、護盾與火花）
  syncView(dt) {
    if (!this.viewGroup) return;

    this.viewGroup.position.set(this.x, this.y, this.z);
    // 朝向包含前進方向 heading 與甩尾視覺偏角 visualDriftYaw
    this.viewGroup.rotation.y = this.heading + this.visualDriftYaw + (CONFIG.KART_YAW_OFFSET || 0);
    this.viewGroup.rotation.x = this.pitchAngle;

    // 轉向時側傾
    const roll = this.steerAngle * clamp(Math.abs(this.speed) / CONFIG.MAX_SPEED, 0, 1) * 0.18;
    this.viewGroup.rotation.z = roll;

    // 前輪轉向角與四輪滾動
    const wheelRoll = (this.speed * dt) / 0.35;
    if (this.wheels.fl) {
      this.wheels.fl.rotation.y = -this.steerAngle;
      this.wheels.fl.rotation.x += wheelRoll;
    }
    if (this.wheels.fr) {
      this.wheels.fr.rotation.y = -this.steerAngle;
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

    // 甩尾火花更新
    if (this.sparkGroup && this.sparkPoints) {
      if (this.isDrifting && this.driftLevel > 0) {
        this.sparkGroup.visible = true;
        let cr = 0.2, cg = 0.6, cb = 1.0; // 藍色 (Lv1)
        if (this.driftLevel === 2) {
          cr = 1.0; cg = 0.55; cb = 0.1; // 橘色 (Lv2)
        } else if (this.driftLevel === 3) {
          cr = 0.75; cg = 0.2; cb = 1.0; // 紫色 (Lv3)
        }

        const posAttr = this.sparkPoints.geometry.attributes.position;
        const colAttr = this.sparkPoints.geometry.attributes.color;
        for (let i = 0; i < 24; i++) {
          const side = (i % 2 === 0 ? -1 : 1);
          posAttr.setXYZ(
            i,
            side * 0.7 + (Math.random() - 0.5) * 0.4,
            0.15 + Math.random() * 0.3,
            -0.9 - Math.random() * 0.8
          );
          colAttr.setXYZ(i, cr, cg, cb);
        }
        posAttr.needsUpdate = true;
        colAttr.needsUpdate = true;
      } else {
        this.sparkGroup.visible = false;
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
