// ============================================================
//  items.js — 道具系統（道具箱、抽獎加權、香蕉、導彈、加速板）
//  負責道具箱生成與重生、動態道具物件物理碰撞、名次加權機率計算，
//  以及 3D 道具物件的建立、旋轉與回收管理。
//  本模組核心邏輯可在 Node.js 環境中直接執行測試（無 DOM 依賴）。
// ============================================================

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, rand } from './utils.js';

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

  // 初始化 3 個區域各 4 個道具箱（共 12 個）
  _initBoxes() {
    this.boxes = [];
    const N = this.track.N;
    // 分佈在賽道約 25%、55%、80% 處
    const locations = [
      Math.floor(N * 0.25),
      Math.floor(N * 0.55),
      Math.floor(N * 0.80),
    ];
    // 橫向排開 4 個
    const laterals = [-4.5, -1.5, 1.5, 4.5];

    let id = 1;
    for (const idx of locations) {
      for (const lat of laterals) {
        const pos = this.track.pointAtLateral(idx, lat);
        this.boxes.push({
          id: id++,
          index: idx,
          lateral: lat,
          x: pos.x,
          z: pos.z,
          active: true,
          respawnTimer: 0,
        });
      }
    }
  }

  // 初始化 2 處固定加速板
  _initPads() {
    this.pads = [];
    const N = this.track.N;
    const padLocations = [
      Math.floor(N * 0.15),
      Math.floor(N * 0.70),
    ];

    for (const idx of padLocations) {
      const pos = this.track.pointAtLateral(idx, 0);
      const tangent = this.track.sampleAt(idx).tangent;
      this.pads.push({
        index: idx,
        x: pos.x,
        z: pos.z,
        heading: Math.atan2(tangent.x, tangent.z),
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
          // 根據玩家當前名次（1~4）進行加權抽獎
          const rank = clamp(racer.position || 1, 1, 4);
          const drawnItem = this._drawItem(rank);
          racer.item = drawnItem;
          if (this.game) {
            this.game.emit('itemChanged', { player: racer, item: drawnItem });
          }
        }
      }
    }

    // 3. 檢查車輛與道具箱、加速板的碰撞
    for (const racer of racers) {
      const car = racer.car;
      if (!car) continue;

      // 檢查道具箱拾取（拾取半徑 2.5）
      for (const box of this.boxes) {
        if (!box.active) continue;
        const dx = car.x - box.x;
        const dz = car.z - box.z;
        if (dx * dx + dz * dz <= 2.5 * 2.5) {
          box.active = false;
          box.respawnTimer = CONFIG.ITEM_BOX_RESPAWN;

          // 若玩家目前已持有道具或正在抽獎，則箱子消失但不給道具
          if (racer.item == null && !racer.rolling) {
            racer.rolling = true;
            racer.rollingTimer = CONFIG.ITEM_ROLL_TIME;
            if (this.game) {
              this.game.emit('sound', 'box');
            }
          }
        }
      }

      // 檢查加速板（半徑 3.5）
      for (const pad of this.pads) {
        const dx = car.x - pad.x;
        const dz = car.z - pad.z;
        if (dx * dx + dz * dz <= pad.radius * pad.radius) {
          car.applyBoost(CONFIG.PAD_BOOST_TIME);
        }
      }
    }

    // 4. 更新香蕉皮（碰撞半徑 1.8）
    for (let i = this.bananas.length - 1; i >= 0; i--) {
      const banana = this.bananas[i];
      if (banana.ownerImmunityTimer > 0) {
        banana.ownerImmunityTimer -= dt;
      }

      let hit = false;
      for (const racer of racers) {
        const car = racer.car;
        if (!car) continue;
        // 發射者在免疫時間內不會踩到自己的香蕉
        if (banana.ownerImmunityTimer > 0 && racer.id === banana.ownerPlayerId) {
          continue;
        }

        const dx = car.x - banana.x;
        const dz = car.z - banana.z;
        if (dx * dx + dz * dz <= 1.8 * 1.8) {
          hit = true;
          const wasSpun = car.hitBanana();
          if (wasSpun && this.game) {
            this.game.emit('playerHit', { player: racer, by: banana.ownerPlayerId });
            this.game.emit('sound', 'spin');
          }
          break;
        }
      }

      if (hit) {
        this._removeBanana(i);
      }
    }

    // 5. 更新導彈（直線飛行、碰撞半徑 2.2、撞牆消失）
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const missile = this.missiles[i];
      missile.life -= dt;
      if (missile.life <= 0) {
        this._removeMissile(i);
        continue;
      }

      // 沿發射時朝向直線飛行
      missile.x += Math.sin(missile.heading) * CONFIG.MISSILE_SPEED * dt;
      missile.z += Math.cos(missile.heading) * CONFIG.MISSILE_SPEED * dt;

      // 撞牆檢查（超出賽道路肩邊界立即消失）
      const proj = this.track.project(missile.x, missile.z);
      const maxLat = this.track.width / 2 + this.track.shoulder;
      if (Math.abs(proj.lateral) > maxLat) {
        this._removeMissile(i);
        continue;
      }

      // 車輛碰撞檢查
      let hit = false;
      for (const racer of racers) {
        const car = racer.car;
        if (!car) continue;
        if (racer.id === missile.ownerPlayerId) continue; // 不會打到自己

        const dx = car.x - missile.x;
        const dz = car.z - missile.z;
        if (dx * dx + dz * dz <= 2.2 * 2.2) {
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

  // 玩家使用道具
  useItem(racer) {
    if (!racer || !racer.car || racer.item == null || racer.rolling) return;
    const item = racer.item;
    racer.item = null;

    if (this.game) {
      this.game.emit('itemChanged', { player: racer, item: null });
    }

    const car = racer.car;
    switch (item) {
      case 'nitro':
        car.applyBoost(CONFIG.NITRO_TIME);
        if (this.game) this.game.emit('sound', 'boost');
        break;
      case 'shield':
        car.applyShield(CONFIG.SHIELD_TIME);
        if (this.game) this.game.emit('sound', 'shield');
        break;
      case 'banana':
        this._spawnBanana(racer);
        if (this.game) this.game.emit('sound', 'drop');
        break;
      case 'missile':
        this._spawnMissile(racer);
        if (this.game) this.game.emit('sound', 'missile');
        break;
    }
  }

  // 在車後方放置香蕉皮
  _spawnBanana(racer) {
    const car = racer.car;
    // 丟在車身後方 3 單位
    const bx = car.x - Math.sin(car.heading) * 3;
    const bz = car.z - Math.cos(car.heading) * 3;

    // 若場上香蕉超過上限，移除最舊的一顆
    if (this.bananas.length >= CONFIG.MAX_BANANAS) {
      this._removeBanana(0);
    }

    const banana = {
      id: this.nextEntityId++,
      x: bx,
      z: bz,
      ownerPlayerId: racer.id,
      ownerImmunityTimer: 0.5, // 0.5 秒內不踩自己的香蕉
    };
    this.bananas.push(banana);
  }

  // 從車頭發射導彈
  _spawnMissile(racer) {
    const car = racer.car;
    // 從車頭前方 2.5 單位出發
    const mx = car.x + Math.sin(car.heading) * 2.5;
    const mz = car.z + Math.cos(car.heading) * 2.5;

    const missile = {
      id: this.nextEntityId++,
      x: mx,
      z: mz,
      heading: car.heading,
      ownerPlayerId: racer.id,
      life: CONFIG.MISSILE_LIFE,
    };
    this.missiles.push(missile);
  }

  _removeBanana(index) {
    const banana = this.bananas[index];
    if (!banana) return;
    if (this.bananaMeshes.has(banana.id)) {
      const mesh = this.bananaMeshes.get(banana.id);
      if (mesh.parent) mesh.parent.remove(mesh);
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
      this.missileMeshes.delete(missile.id);
    }
    this.missiles.splice(index, 1);
  }

  // 重設道具系統（清空香蕉、導彈，道具箱全部重設為可用）
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
      mesh.position.set(box.x, 0.8, box.z);
      mesh.castShadow = true;
      this.viewGroup.add(mesh);
      this.boxMeshes.set(box.id, mesh);
    }

    // 建立加速板 3D 網格（黃橙色條紋地面）
    const padGeo = new THREE.PlaneGeometry(3.6, 5.0);
    const padMat = new THREE.MeshBasicMaterial({
      color: 0xf1c40f,
      side: THREE.DoubleSide,
    });
    for (const pad of this.pads) {
      const padMesh = new THREE.Mesh(padGeo, padMat);
      padMesh.rotation.x = -Math.PI / 2;
      padMesh.rotation.z = -pad.heading;
      padMesh.position.set(pad.x, 0.02, pad.z);
      this.viewGroup.add(padMesh);
    }

    scene.add(this.viewGroup);
  }

  // 每幀視覺同步（道具箱旋轉與顯示隱藏、香蕉/導彈網格增刪與位移）
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
        const bGeo = new THREE.CylinderGeometry(0.3, 0.5, 0.3, 8);
        const bMat = new THREE.MeshStandardMaterial({ color: 0xf1c40f, roughness: 0.4 });
        mesh = new THREE.Mesh(bGeo, bMat);
        mesh.castShadow = true;
        this.viewGroup.add(mesh);
        this.bananaMeshes.set(banana.id, mesh);
      }
      mesh.position.set(banana.x, 0.2, banana.z);
    }

    // 導彈 3D 視覺
    for (const missile of this.missiles) {
      let mesh = this.missileMeshes.get(missile.id);
      if (!mesh) {
        const mGeo = new THREE.ConeGeometry(0.3, 1.2, 8);
        const mMat = new THREE.MeshStandardMaterial({ color: 0xe74c3c, roughness: 0.3 });
        mesh = new THREE.Mesh(mGeo, mMat);
        mesh.rotation.x = Math.PI / 2; // 車頭方向
        mesh.castShadow = true;
        this.viewGroup.add(mesh);
        this.missileMeshes.set(missile.id, mesh);
      }
      mesh.position.set(missile.x, 0.5, missile.z);
      mesh.rotation.y = missile.heading;
    }
  }

  // 清除 3D 物件
  detachView() {
    if (this.viewGroup && this.viewGroup.parent) {
      this.viewGroup.parent.remove(this.viewGroup);
      this.viewGroup = null;
    }
    this.boxMeshes.clear();
    this.bananaMeshes.clear();
    this.missileMeshes.clear();
  }
}
