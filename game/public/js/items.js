// ============================================================
//  items.js — 道具系統（魔石道具升級、道具箱、香蕉、追蹤導彈、加速板）
//  負責道具箱生成與重生、抽獎與等級升級（Lv1 ~ Lv3）、追蹤導彈物理導引、
//  巨大香蕉與前擲香蕉、高度差判定（> 2.5 單位跳躍可避開），以及 3D 視覺管理。
//  本模組核心邏輯可在 Node.js 環境中直接執行測試（無 DOM 依賴）。
// ============================================================

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, angleDiff } from './utils.js';

export class ItemSystem {
  constructor({ game = null, track = null, rng = null } = {}) {
    this.game = game;
    this.track = track;
    this.rng = rng || (game && game.rng) || Math.random;

    this.boxes = [];    // 賽道上的道具箱
    this.pads = [];     // 固定加速板
    this.bananas = [];  // 場上的香蕉皮
    this.missiles = []; // 飛行中的導彈

    this.nextEntityId = 1;

    // 3D 視覺參考
    this.scene = null;
    this.assets = null;
    this.viewGroup = null;
    this.boxMeshes = new Map();
    this.bananaMeshes = new Map();
    this.missileMeshes = new Map();

    if (this.track) {
      this._initBoxes();
      this._initPads();
    }
  }

  // 初始化 4 個區域各 4 個道具箱（共 16 個，避開跳台與加速板）
  _initBoxes() {
    this.boxes = [];
    const N = this.track.N;
    // 分佈在賽道約 18%、45%、68%、88% 處（跳台在約 38% 處，間距均 > 15 單位）
    const locations = [
      Math.floor(N * 0.18),
      Math.floor(N * 0.45),
      Math.floor(N * 0.68),
      Math.floor(N * 0.88),
    ];
    const laterals = [-4.5, -1.5, 1.5, 4.5];

    let id = 1;
    for (const idx of locations) {
      const groundY = this.track.groundHeight(idx, 0);
      for (const lat of laterals) {
        const pos = this.track.pointAtLateral(idx, lat);
        this.boxes.push({
          id: id++,
          index: idx,
          lateral: lat,
          x: pos.x,
          y: groundY + 0.8,
          z: pos.z,
          active: true,
          respawnTimer: 0,
        });
      }
    }
  }

  // 初始化 3 處固定加速板（避開道具箱與跳台）
  _initPads() {
    this.pads = [];
    const N = this.track.N;
    const padLocations = [
      Math.floor(N * 0.08),
      Math.floor(N * 0.55),
      Math.floor(N * 0.78),
    ];

    for (const idx of padLocations) {
      const pos = this.track.pointAtLateral(idx, 0);
      const s = this.track.sampleAt(idx);
      this.pads.push({
        index: idx,
        x: pos.x,
        y: s.height,
        z: pos.z,
        heading: Math.atan2(s.tangent.x, s.tangent.z),
        radius: 3.5,
      });
    }
  }

  // 物理邏輯更新（固定 1/60 秒步長）
  update(dt, racers) {
    // 1. 更新道具箱重生計時
    for (const box of this.boxes) {
      if (!box.active) {
        box.respawnTimer -= dt;
        if (box.respawnTimer <= 0) {
          box.active = true;
          box.respawnTimer = 0;
        }
      }
    }

    // 2. 更新玩家抽獎轉盤狀態
    for (const racer of racers) {
      if (racer.rolling) {
        racer.rollingTimer -= dt;
        if (racer.rollingTimer <= 0) {
          racer.rolling = false;
          racer.rollingTimer = 0;
          // 根據玩家名次進行加權抽獎得到 Lv1 道具
          const rank = clamp(racer.position || 1, 1, 4);
          const drawnItem = this._drawItem(rank);
          racer.item = drawnItem;
          racer.itemLevel = 1;
          if (this.game) {
            this.game.emit('itemChanged', { player: racer, item: drawnItem, level: 1 });
          }
        }
      }
    }

    // 3. 檢查車輛與道具箱、加速板的碰撞（包含高度差 <= 2.5 判定）
    for (const racer of racers) {
      const car = racer.car;
      if (!car) continue;

      // 檢查道具箱拾取（拾取半徑 2.5，高度差 <= 2.5）
      for (const box of this.boxes) {
        if (!box.active) continue;
        const dx = car.x - box.x;
        const dz = car.z - box.z;
        const dy = Math.abs(car.y - box.y);

        if (dx * dx + dz * dz <= 2.5 * 2.5 && dy <= 2.5) {
          box.active = false;
          box.respawnTimer = CONFIG.ITEM_BOX_RESPAWN;

          if (racer.rolling) {
            // 抽獎中吃箱子無效果
          } else if (racer.item == null) {
            // 手上無道具：開始抽獎 Lv1
            racer.rolling = true;
            racer.rollingTimer = CONFIG.ITEM_ROLL_TIME;
            if (this.game) this.game.emit('sound', 'box');
          } else {
            // 手上已有道具：魔石升級（最多 Lv3）
            if (racer.itemLevel < 3) {
              racer.itemLevel = Math.min(3, (racer.itemLevel || 1) + 1);
              if (this.game) {
                this.game.emit('itemChanged', { player: racer, item: racer.item, level: racer.itemLevel });
                this.game.emit('sound', 'upgrade');
              }
            }
          }
        }
      }

      // 檢查加速板（半徑 3.5，高度差 <= 2.5）
      for (const pad of this.pads) {
        const dx = car.x - pad.x;
        const dz = car.z - pad.z;
        const dy = Math.abs(car.y - pad.y);
        if (dx * dx + dz * dz <= pad.radius * pad.radius && dy <= 2.5) {
          car.applyBoost(CONFIG.PAD_BOOST_TIME);
        }
      }
    }

    // 4. 更新香蕉皮（碰撞半徑 1.8 / 巨大香蕉 3.6；高度差 <= 2.5）
    for (let i = this.bananas.length - 1; i >= 0; i--) {
      const banana = this.bananas[i];
      if (banana.ownerImmunityTimer > 0) {
        banana.ownerImmunityTimer -= dt;
      }

      let hit = false;
      for (const racer of racers) {
        const car = racer.car;
        if (!car) continue;
        // 丟出者在免疫時間內不會踩到
        if (banana.ownerImmunityTimer > 0 && racer.id === banana.ownerPlayerId) {
          continue;
        }

        const dx = car.x - banana.x;
        const dz = car.z - banana.z;
        const dy = Math.abs(car.y - banana.y);
        const radius = banana.radius || 1.8;

        // 6.5: 高度差 > 2.5 不算碰到（跳過香蕉是合法技巧）
        if (dx * dx + dz * dz <= radius * radius && dy <= 2.5) {
          hit = true;
          const spinDuration = banana.spinTime || CONFIG.SPIN_TIME;
          const wasSpun = car.hitBanana(spinDuration);
          if (wasSpun) {
            if (this.game) {
              this.game.emit('playerHit', { player: racer, by: banana.ownerPlayerId });
              this.game.emit('sound', 'spin');
            }
          }
          break;
        }
      }

      if (hit) {
        this._removeBanana(i);
      }
    }

    // 5. 更新導彈（直線/追蹤導引、碰撞半徑 2.2、撞牆消失）
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const missile = this.missiles[i];
      missile.life -= dt;
      if (missile.life <= 0) {
        this._removeMissile(i);
        continue;
      }

      // 若為追蹤導彈且有目標車輛，每步朝目標轉向（最大 3.5 rad/s）
      if (missile.homing && missile.targetPlayerId) {
        const targetRacer = racers.find((r) => r.id === missile.targetPlayerId);
        if (targetRacer && targetRacer.car && !targetRacer.car.finished) {
          const tCar = targetRacer.car;
          const dx = tCar.x - missile.x;
          const dz = tCar.z - missile.z;
          const desiredHeading = Math.atan2(dx, dz);
          const diff = angleDiff(missile.heading, desiredHeading);
          const maxTurn = 3.5 * dt;
          missile.heading += clamp(diff, -maxTurn, maxTurn);
        }
      }

      // 前進移動
      missile.x += Math.sin(missile.heading) * CONFIG.MISSILE_SPEED * dt;
      missile.z += Math.cos(missile.heading) * CONFIG.MISSILE_SPEED * dt;

      // 貼地高度更新
      const proj = this.track.project(missile.x, missile.z);
      missile.y = this.track.groundHeight(proj.index, proj.t) + 0.8;

      // 撞牆檢查（超出賽道路肩邊界立即消失）
      const maxLat = this.track.width / 2 + this.track.shoulder;
      if (Math.abs(proj.lateral) > maxLat) {
        this._removeMissile(i);
        continue;
      }

      // 車輛碰撞檢查（高度差 <= 2.5）
      let hit = false;
      for (const racer of racers) {
        const car = racer.car;
        if (!car) continue;
        if (racer.id === missile.ownerPlayerId) continue;

        const dx = car.x - missile.x;
        const dz = car.z - missile.z;
        const dy = Math.abs(car.y - missile.y);

        if (dx * dx + dz * dz <= 2.2 * 2.2 && dy <= 2.5) {
          hit = true;
          const wasHit = car.hitByMissile(missile.ownerPlayerId);
          if (wasHit && this.game) {
            this.game.emit('playerHit', { player: racer, by: missile.ownerPlayerId });
            this.game.emit('sound', 'hit');
          }
          break;
        }
      }

      if (hit) {
        this._removeMissile(i);
      }
    }
  }

  // 依名次加權隨機抽取道具
  _drawItem(rank) {
    const weights = CONFIG.ITEM_WEIGHTS[rank - 1] || CONFIG.ITEM_WEIGHTS[0];
    const pool = [];
    for (const [item, w] of Object.entries(weights)) {
      for (let i = 0; i < w; i++) pool.push(item);
    }
    const r = Math.floor(this.rng() * pool.length);
    return pool[r] || 'nitro';
  }

  // 玩家使用道具（依 itemLevel 觸發對應等級效果）
  useItem(racer) {
    if (!racer || !racer.car || racer.item == null || racer.rolling) return;
    const item = racer.item;
    const level = racer.itemLevel || 1;
    racer.item = null;
    racer.itemLevel = 0;

    if (this.game) {
      this.game.emit('itemChanged', { player: racer, item: null, level: 0 });
    }

    const car = racer.car;
    switch (item) {
      case 'nitro': {
        const times = CONFIG.ITEM_LEVELS.nitro;
        const duration = times[level - 1] || times[0];
        car.applyBoost(duration, level);
        if (this.game) this.game.emit('sound', 'boost');
        break;
      }
      case 'shield': {
        const times = CONFIG.ITEM_LEVELS.shield;
        const duration = times[level - 1] || times[0];
        car.applyShield(duration, level);
        if (this.game) this.game.emit('sound', 'shield');
        break;
      }
      case 'banana':
        this._spawnBanana(racer, level);
        if (this.game) this.game.emit('sound', 'drop');
        break;
      case 'missile':
        this._spawnMissile(racer, level);
        if (this.game) this.game.emit('sound', 'missile');
        break;
    }
  }

  // 生成香蕉（Lv1: 1個, Lv2: 扇形3個, Lv3: 1巨大香蕉 + 1前方香蕉）
  _spawnBanana(racer, level = 1) {
    const car = racer.car;
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    // 右手邊向量
    const rx = -Math.cos(car.heading);
    const rz = Math.sin(car.heading);

    const spinTimes = CONFIG.ITEM_LEVELS?.bananaSpinTime || [1.2, 1.2, 2.0];
    const spinLv1 = spinTimes[0] || CONFIG.SPIN_TIME;
    const spinLv2 = spinTimes[1] || CONFIG.SPIN_TIME;
    const spinLv3 = spinTimes[2] || 2.0;

    if (level === 1) {
      this._addBanana({
        x: car.x - fx * 3,
        z: car.z - fz * 3,
        ownerPlayerId: racer.id,
        radius: 1.8,
        spinTime: spinLv1,
        ownerImmunityTimer: 0.5,
      });
    } else if (level === 2) {
      // 車後扇形 3 個
      this._addBanana({
        x: car.x - fx * 3,
        z: car.z - fz * 3,
        ownerPlayerId: racer.id,
        radius: 1.8,
        spinTime: spinLv2,
        ownerImmunityTimer: 0.5,
      });
      this._addBanana({
        x: car.x - fx * 3.5 - rx * 1.5,
        z: car.z - fz * 3.5 - rz * 1.5,
        ownerPlayerId: racer.id,
        radius: 1.8,
        spinTime: spinLv2,
        ownerImmunityTimer: 0.5,
      });
      this._addBanana({
        x: car.x - fx * 3.5 + rx * 1.5,
        z: car.z - fz * 3.5 + rz * 1.5,
        ownerPlayerId: racer.id,
        radius: 1.8,
        spinTime: spinLv2,
        ownerImmunityTimer: 0.5,
      });
    } else if (level === 3) {
      // 巨大香蕉 1 個（半徑 3.6，打滑時間依 CONFIG.ITEM_LEVELS.bananaSpinTime[2]）
      this._addBanana({
        x: car.x - fx * 3.5,
        z: car.z - fz * 3.5,
        ownerPlayerId: racer.id,
        radius: 3.6,
        spinTime: spinLv3,
        isGiant: true,
        ownerImmunityTimer: 0.5,
      });

      // 前方 15 單位放 1 個普通香蕉（免疫時間 1.5 秒）
      const aheadSamples = Math.round(15 / (this.track.length / this.track.N));
      const aheadIdx = (car.trackIndex + aheadSamples) % this.track.N;
      const aheadPos = this.track.pointAtLateral(aheadIdx, car.lateral);
      this._addBanana({
        x: aheadPos.x,
        z: aheadPos.z,
        ownerPlayerId: racer.id,
        radius: 1.8,
        spinTime: spinLv1,
        ownerImmunityTimer: 1.5,
      });
    }
  }

  _addBanana(opts) {
    if (this.bananas.length >= CONFIG.MAX_BANANAS) {
      this._removeBanana(0);
    }

    const proj = this.track.project(opts.x, opts.z);
    const groundY = this.track.groundHeight(proj.index, proj.t);

    const banana = {
      id: this.nextEntityId++,
      x: opts.x,
      y: groundY,
      z: opts.z,
      ownerPlayerId: opts.ownerPlayerId,
      radius: opts.radius || 1.8,
      spinTime: opts.spinTime || CONFIG.SPIN_TIME,
      isGiant: Boolean(opts.isGiant),
      ownerImmunityTimer: opts.ownerImmunityTimer ?? 0.5,
    };
    this.bananas.push(banana);
  }

  // 發射導彈（Lv1: 直線, Lv2: 追蹤最近前方車, Lv3: 追蹤所有前方車最多3枚）
  _spawnMissile(racer, level = 1) {
    const car = racer.car;
    const mx = car.x + Math.sin(car.heading) * 2.5;
    const mz = car.z + Math.cos(car.heading) * 2.5;

    // 尋找前方目標車輛（依 progress 差距最小排序）
    const aheadRacers = [];
    if (this.game && this.game.racers) {
      for (const r of this.game.racers) {
        if (!r.car || r.id === racer.id || r.car.finished) continue;
        const diff = r.car.progress - car.progress;
        if (diff > 0 && diff < (this.track.N / 2)) {
          aheadRacers.push({ racer: r, diff });
        }
      }
      aheadRacers.sort((a, b) => a.diff - b.diff);
    }

    if (level === 1) {
      // Lv1: 直線飛行
      this.missiles.push({
        id: this.nextEntityId++,
        x: mx,
        y: car.y + 0.8,
        z: mz,
        heading: car.heading,
        ownerPlayerId: racer.id,
        life: CONFIG.MISSILE_LIFE,
        homing: false,
        targetPlayerId: null,
      });
    } else if (level === 2) {
      // Lv2: 追蹤鎖定前方最近的一台
      const target = aheadRacers[0]?.racer || null;
      this.missiles.push({
        id: this.nextEntityId++,
        x: mx,
        y: car.y + 0.8,
        z: mz,
        heading: car.heading,
        ownerPlayerId: racer.id,
        life: 3.0,
        homing: Boolean(target),
        targetPlayerId: target ? target.id : null,
      });
    } else if (level === 3) {
      // Lv3: 對所有 progress 比自己大的車各發一枚追蹤導彈（最多 3 枚）
      const count = Math.min(3, Math.max(1, aheadRacers.length));
      for (let k = 0; k < count; k++) {
        const target = aheadRacers[k]?.racer || null;
        // 稍微左右分開排列發射
        const spreadOffset = (k - (count - 1) / 2) * 0.8;
        const rx = -Math.cos(car.heading);
        const rz = Math.sin(car.heading);

        this.missiles.push({
          id: this.nextEntityId++,
          x: mx + rx * spreadOffset,
          y: car.y + 0.8,
          z: mz + rz * spreadOffset,
          heading: car.heading,
          ownerPlayerId: racer.id,
          life: 3.0,
          homing: Boolean(target),
          targetPlayerId: target ? target.id : null,
        });
      }
    }
  }

  _removeBanana(index) {
    const banana = this.bananas[index];
    if (!banana) return;
    if (this.bananaMeshes.has(banana.id)) {
      const mesh = this.bananaMeshes.get(banana.id);
      if (mesh.parent) mesh.parent.remove(mesh);
      mesh.geometry?.dispose?.();
      mesh.material?.dispose?.();
      this.bananaMeshes.delete(banana.id);
    }
    this.bananas.splice(index, 1);
  }

  _removeMissile(index) {
    const missile = this.missiles[index];
    if (!missile) return;
    if (this.missileMeshes.has(missile.id)) {
      const mesh = this.missileMeshes.get(missile.id);
      if (mesh.parent) mesh.parent.remove(mesh);
      mesh.geometry?.dispose?.();
      mesh.material?.dispose?.();
      this.missileMeshes.delete(missile.id);
    }
    this.missiles.splice(index, 1);
  }

  // 重設道具系統
  reset() {
    while (this.bananas.length > 0) {
      this._removeBanana(this.bananas.length - 1);
    }
    while (this.missiles.length > 0) {
      this._removeMissile(this.missiles.length - 1);
    }
    for (const box of this.boxes) {
      box.active = true;
      box.respawnTimer = 0;
    }
  }

  // 建立 3D 視覺模型
  attachView(scene, assets) {
    if (!scene) return;
    this.scene = scene;
    this.assets = assets;
    this.viewGroup = new THREE.Group();
    this.viewGroup.name = 'itemSystemMeshes';

    // 建立道具箱 3D 模型
    const boxGeo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    const boxMat = new THREE.MeshStandardMaterial({
      color: 0xf39c12,
      emissive: 0xd35400,
      emissiveIntensity: 0.3,
      roughness: 0.3,
    });

    for (const box of this.boxes) {
      const mesh = new THREE.Mesh(boxGeo, boxMat.clone());
      mesh.position.set(box.x, box.y, box.z);
      mesh.castShadow = true;
      this.viewGroup.add(mesh);
      this.boxMeshes.set(box.id, mesh);
    }

    // 建立加速板 3D 網格
    const padGeo = new THREE.PlaneGeometry(3.6, 5.0);
    const padMat = new THREE.MeshBasicMaterial({
      color: 0xf1c40f,
      side: THREE.DoubleSide,
    });
    for (const pad of this.pads) {
      const padMesh = new THREE.Mesh(padGeo, padMat);
      padMesh.rotation.x = -Math.PI / 2;
      padMesh.rotation.z = -pad.heading;
      padMesh.position.set(pad.x, pad.y + 0.02, pad.z);
      this.viewGroup.add(padMesh);
    }

    scene.add(this.viewGroup);
  }

  // 每幀視覺同步
  syncView(dt) {
    if (!this.viewGroup) return;

    // 道具箱旋轉與顯示/隱藏
    for (const box of this.boxes) {
      const mesh = this.boxMeshes.get(box.id);
      if (mesh) {
        mesh.visible = box.active;
        if (box.active) {
          mesh.rotation.y += 2.0 * dt;
          mesh.rotation.x += 1.0 * dt;
        }
      }
    }

    // 香蕉 3D 視覺
    for (const banana of this.bananas) {
      let mesh = this.bananaMeshes.get(banana.id);
      if (!mesh) {
        const radius = banana.isGiant ? 0.8 : 0.4;
        const height = banana.isGiant ? 0.8 : 0.4;
        const bGeo = new THREE.CylinderGeometry(radius * 0.6, radius, height, 8);
        const bMat = new THREE.MeshStandardMaterial({
          color: banana.isGiant ? 0xe67e22 : 0xf1c40f,
          roughness: 0.4,
        });
        mesh = new THREE.Mesh(bGeo, bMat);
        mesh.castShadow = true;
        this.viewGroup.add(mesh);
        this.bananaMeshes.set(banana.id, mesh);
      }
      mesh.position.set(banana.x, banana.y + (banana.isGiant ? 0.4 : 0.2), banana.z);
    }

    // 導彈 3D 視覺
    for (const missile of this.missiles) {
      let mesh = this.missileMeshes.get(missile.id);
      if (!mesh) {
        const mGeo = new THREE.ConeGeometry(0.3, 1.2, 8);
        const mMat = new THREE.MeshStandardMaterial({
          color: missile.homing ? 0x9b59b6 : 0xe74c3c,
          roughness: 0.3,
        });
        mesh = new THREE.Mesh(mGeo, mMat);
        mesh.rotation.x = Math.PI / 2;
        mesh.castShadow = true;
        this.viewGroup.add(mesh);
        this.missileMeshes.set(missile.id, mesh);
      }
      mesh.position.set(missile.x, missile.y, missile.z);
      mesh.rotation.y = missile.heading;
    }
  }

  // 清除 3D 物件並釋放動態生成之幾何體與材質
  detachView() {
    for (const mesh of this.bananaMeshes.values()) {
      mesh.geometry?.dispose?.();
      mesh.material?.dispose?.();
    }
    for (const mesh of this.missileMeshes.values()) {
      mesh.geometry?.dispose?.();
      mesh.material?.dispose?.();
    }
    if (this.viewGroup && this.viewGroup.parent) {
      this.viewGroup.parent.remove(this.viewGroup);
      this.viewGroup = null;
    }
    this.boxMeshes.clear();
    this.bananaMeshes.clear();
    this.missileMeshes.clear();
  }
}
