// ============================================================
//  track.js — 賽道幾何計算、物理邊界與 3D 渲染
//  負責賽道曲線取樣、最近點投影（project）、發車格位與場景物件生成。
//  本模組可於 Node.js 進行幾何與物理投影計算（無 DOM 依賴）。
// ============================================================

import * as THREE from 'three';
import { CONFIG } from './config.js';

export class Track {
  constructor() {
    this.width = CONFIG.TRACK_WIDTH;       // 路面寬度（16）
    this.shoulder = CONFIG.SHOULDER;       // 路肩草地寬度（4）
    this.N = CONFIG.TRACK_SAMPLES;         // 取樣點數量（600）

    // 設計 13 個賽道控制點（封閉平滑迴圈，包含高速直道、S 彎與髮夾急彎）
    // 幾何設計確保任兩段賽道直線間距充足，避免賽道自我重疊
    const controlPoints = [
      new THREE.Vector3(0, 0, 75),       // 0: 起終點大直道
      new THREE.Vector3(70, 0, 75),      // 1: 直道加速段
      new THREE.Vector3(135, 0, 60),     // 2: 第 1 彎進彎
      new THREE.Vector3(165, 0, 15),     // 3: 高速弧形右彎
      new THREE.Vector3(150, 0, -45),    // 4: 彎道出彎
      new THREE.Vector3(100, 0, -85),    // 5: 下坡 S 彎入口
      new THREE.Vector3(35, 0, -65),     // 6: S 彎切換向內切
      new THREE.Vector3(-30, 0, -100),   // 7: 下方後直道
      new THREE.Vector3(-95, 0, -95),    // 8: 髮夾彎前置區
      new THREE.Vector3(-145, 0, -50),   // 9: 髮夾彎前煞車點
      new THREE.Vector3(-165, 0, 5),     // 10: 髮夾彎頂點（180 度急彎）
      new THREE.Vector3(-120, 0, 50),    // 11: 髮夾彎出彎加速
      new THREE.Vector3(-60, 0, 75),     // 12: 接回起終點直道
    ];

    // 建立 3D 封閉曲線（Y 固定為 0）
    this.curve = new THREE.CatmullRomCurve3(controlPoints, true, 'centripetal');

    // 預先計算 N 個均勻取樣點
    this.points = [];    // 取樣點平面座標 { x, z }
    this.tangents = [];  // 前進方向單位切線 { x, z }
    this.normals = [];   // 車輛右手邊單位法線 { x, z }
    this.dist = [];      // 沿賽道累積距離

    this._precompute();
  }

  // 預先計算取樣點的幾何資料（點、切線、右手邊法線、累積長度）
  _precompute() {
    let accumulated = 0;
    this.dist.push(0);

    // 取樣點位置與切線
    for (let i = 0; i < this.N; i++) {
      const u = i / this.N;
      const pt3 = this.curve.getPointAt(u);
      const tan3 = this.curve.getTangentAt(u).normalize();

      this.points.push({ x: pt3.x, z: pt3.z });
      this.tangents.push({ x: tan3.x, z: tan3.z });

      // 車頭前進切線為 (tx, tz)，朝向右手邊的法線為 (tz, -tx)
      // 如此一來，點若在車輛右手側，lateral 為正；左手側 lateral 為負
      this.normals.push({ x: tan3.z, z: -tan3.x });

      if (i > 0) {
        const prev = this.points[i - 1];
        const dx = pt3.x - prev.x;
        const dz = pt3.z - prev.z;
        accumulated += Math.hypot(dx, dz);
        this.dist.push(accumulated);
      }
    }

    // 計算最後一點封閉接回第 0 點的總長度
    const pLast = this.points[this.N - 1];
    const pFirst = this.points[0];
    this.length = accumulated + Math.hypot(pFirst.x - pLast.x, pFirst.z - pLast.z);
  }

  // 投影任意座標 (x, z) 到賽道上，回傳最近取樣點索引與側向距離 lateral
  // lateral > 0 代表在賽道切線右手邊，< 0 代表在左手邊
  // 若提供 hintIndex 則只搜尋前後 30 個點（速度快），否則全域搜尋 0~N-1
  project(x, z, hintIndex = null) {
    let bestIndex = 0;
    let bestDistSq = Infinity;
    const N = this.N;

    if (hintIndex != null && hintIndex >= 0) {
      const range = 30;
      for (let offset = -range; offset <= range; offset++) {
        const i = (hintIndex + offset + N) % N;
        const p = this.points[i];
        const dx = x - p.x;
        const dz = z - p.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIndex = i;
        }
      }
    } else {
      for (let i = 0; i < N; i++) {
        const p = this.points[i];
        const dx = x - p.x;
        const dz = z - p.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIndex = i;
        }
      }
    }

    const p = this.points[bestIndex];
    const t = this.tangents[bestIndex];
    // 右手法向量為 (t.z, -t.x)
    // 向量 (x - p.x, z - p.z) 在右手法向量上的內積即為 lateral
    const lateral = (x - p.x) * t.z - (z - p.z) * t.x;

    return { index: bestIndex, lateral };
  }

  // 取得特定取樣點的資訊（位置、切線、右手邊法線）
  sampleAt(index) {
    const i = ((Math.floor(index) % this.N) + this.N) % this.N;
    return {
      point: this.points[i],
      tangent: this.tangents[i],
      normal: this.normals[i],
      distance: this.dist[i],
    };
  }

  // 取得特定取樣點加上側向偏移後的世界座標
  pointAtLateral(index, lateral) {
    const s = this.sampleAt(index);
    return {
      x: s.point.x + lateral * s.normal.x,
      z: s.point.z + lateral * s.normal.z,
    };
  }

  // 取得起跑發車格位置（slot 0~3）
  // 4 台車在起跑線後方兩兩並排，朝向前方
  startGrid(slot) {
    // slot 0, 1 在第 1 排（索引 N - 8）；slot 2, 3 在第 2 排（索引 N - 16）
    const row = Math.floor(slot / 2);
    const col = slot % 2; // 0 為左車位，1 為右車位
    const idx = (this.N - 8 - row * 8 + this.N) % this.N;
    const lateral = col === 0 ? -3.5 : 3.5;

    const pos = this.pointAtLateral(idx, lateral);
    const tangent = this.sampleAt(idx).tangent;
    // 前進朝向角度：(sin(heading), cos(heading)) 對應 (tangent.x, tangent.z)
    const heading = Math.atan2(tangent.x, tangent.z);

    return {
      x: pos.x,
      y: 0,
      z: pos.z,
      heading,
      index: idx,
      lateral,
    };
  }

  // 建立 3D 視覺模型（僅在傳入 scene 時建立，Node.js 測試時不執行）
  buildMeshes(scene, assets = null) {
    if (!scene) return;

    this.meshesGroup = new THREE.Group();
    this.meshesGroup.name = 'trackMeshes';

    // 1. 寬廣草地大平面
    const grassGeo = new THREE.PlaneGeometry(1000, 1000);
    const grassMat = new THREE.MeshStandardMaterial({
      color: 0x27ae60,
      roughness: 0.9,
    });
    const grass = new THREE.Mesh(grassGeo, grassMat);
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.05;
    grass.receiveShadow = true;
    this.meshesGroup.add(grass);

    // 2. 賽道路面（沿取樣點生成的帶狀網格）
    const halfW = this.width / 2;
    const shoulderW = this.shoulder;
    const totalHalfW = halfW + shoulderW;

    const roadPositions = [];
    const roadIndices = [];
    const curbPositions = [];
    const curbColors = [];
    const curbIndices = [];

    for (let i = 0; i <= this.N; i++) {
      const idx = i % this.N;
      const s = this.sampleAt(idx);

      // 路面左右頂點
      const lx = s.point.x - halfW * s.normal.x;
      const lz = s.point.z - halfW * s.normal.z;
      const rx = s.point.x + halfW * s.normal.x;
      const rz = s.point.z + halfW * s.normal.z;

      roadPositions.push(lx, 0.01, lz);
      roadPositions.push(rx, 0.01, rz);

      if (i < this.N) {
        const v = i * 2;
        // 法線朝 +Y 繞向（v, v+2, v+1 與 v+1, v+2, v+3）
        roadIndices.push(v, v + 2, v + 1);
        roadIndices.push(v + 1, v + 2, v + 3);
      }

      // 紅白相間路肩（左側與右側）
      const olx = s.point.x - totalHalfW * s.normal.x;
      const olz = s.point.z - totalHalfW * s.normal.z;
      const orx = s.point.x + totalHalfW * s.normal.x;
      const orz = s.point.z + totalHalfW * s.normal.z;

      // 左路肩頂點（lx, lz 到 olx, olz）
      const curbV = curbPositions.length / 3;
      curbPositions.push(olx, 0.005, olz);
      curbPositions.push(lx, 0.005, lz);
      // 右路肩頂點（rx, rz 到 orx, orz）
      curbPositions.push(rx, 0.005, rz);
      curbPositions.push(orx, 0.005, orz);

      // 紅白交替顏色（每 6 個取樣點切換）
      const isRed = (Math.floor(idx / 6) % 2) === 0;
      const cr = isRed ? 0.9 : 1.0;
      const cg = isRed ? 0.2 : 1.0;
      const cb = isRed ? 0.2 : 1.0;
      curbColors.push(cr, cg, cb, cr, cg, cb, cr, cg, cb, cr, cg, cb);

      if (i < this.N) {
        // 左路肩三角形（法線朝 +Y）
        curbIndices.push(curbV, curbV + 4, curbV + 1);
        curbIndices.push(curbV + 1, curbV + 4, curbV + 5);
        // 右路肩三角形（法線朝 +Y）
        curbIndices.push(curbV + 2, curbV + 6, curbV + 3);
        curbIndices.push(curbV + 3, curbV + 6, curbV + 7);
      }
    }

    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPositions, 3));
    roadGeo.setIndex(roadIndices);
    roadGeo.computeVertexNormals();

    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x2c3e50,
      roughness: 0.8,
    });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = true;
    this.meshesGroup.add(roadMesh);

    // 路肩網格
    const curbGeo = new THREE.BufferGeometry();
    curbGeo.setAttribute('position', new THREE.Float32BufferAttribute(curbPositions, 3));
    curbGeo.setAttribute('color', new THREE.Float32BufferAttribute(curbColors, 3));
    curbGeo.setIndex(curbIndices);
    curbGeo.computeVertexNormals();

    const curbMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.8,
    });
    const curbMesh = new THREE.Mesh(curbGeo, curbMat);
    curbMesh.receiveShadow = true;
    this.meshesGroup.add(curbMesh);

    // 2.5 路面中線白色短虛線（沿取樣點每隔幾點畫一段，y=0.015 避免 z-fighting）
    const centerPositions = [];
    const centerIndices = [];
    for (let i = 0; i < this.N; i++) {
      // 每 6 個取樣點中前 3 點畫虛線，後 3 點留空
      if ((i % 6) < 3) {
        const sA = this.sampleAt(i);
        const sB = this.sampleAt(i + 1);
        const halfDashW = 0.2;

        const cV = centerPositions.length / 3;
        centerPositions.push(
          sA.point.x - halfDashW * sA.normal.x, 0.015, sA.point.z - halfDashW * sA.normal.z,
          sA.point.x + halfDashW * sA.normal.x, 0.015, sA.point.z + halfDashW * sA.normal.z,
          sB.point.x - halfDashW * sB.normal.x, 0.015, sB.point.z - halfDashW * sB.normal.z,
          sB.point.x + halfDashW * sB.normal.x, 0.015, sB.point.z + halfDashW * sB.normal.z
        );
        centerIndices.push(cV, cV + 2, cV + 1);
        centerIndices.push(cV + 1, cV + 2, cV + 3);
      }
    }
    const centerGeo = new THREE.BufferGeometry();
    centerGeo.setAttribute('position', new THREE.Float32BufferAttribute(centerPositions, 3));
    centerGeo.setIndex(centerIndices);
    centerGeo.computeVertexNormals();
    const centerMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.5,
    });
    const centerMesh = new THREE.Mesh(centerGeo, centerMat);
    this.meshesGroup.add(centerMesh);

    // 3. 起終點黑白格紋線（索引 0 處，以 sampleAt(0) 左右點精準建構 quad 覆蓋整條路面）
    const s0 = this.sampleAt(0);
    const halfRoadW = this.width / 2;
    const halfThick = 1.5;

    // 四個角頂點：左後、右後、左前、右前
    const fl_x0 = s0.point.x - halfRoadW * s0.normal.x - halfThick * s0.tangent.x;
    const fl_z0 = s0.point.z - halfRoadW * s0.normal.z - halfThick * s0.tangent.z;
    const fl_x1 = s0.point.x + halfRoadW * s0.normal.x - halfThick * s0.tangent.x;
    const fl_z1 = s0.point.z + halfRoadW * s0.normal.z - halfThick * s0.tangent.z;
    const fl_x2 = s0.point.x - halfRoadW * s0.normal.x + halfThick * s0.tangent.x;
    const fl_z2 = s0.point.z - halfRoadW * s0.normal.z + halfThick * s0.tangent.z;
    const fl_x3 = s0.point.x + halfRoadW * s0.normal.x + halfThick * s0.tangent.x;
    const fl_z3 = s0.point.z + halfRoadW * s0.normal.z + halfThick * s0.tangent.z;

    const finishPositions = [
      fl_x0, 0.02, fl_z0,
      fl_x1, 0.02, fl_z1,
      fl_x2, 0.02, fl_z2,
      fl_x3, 0.02, fl_z3,
    ];
    const finishUvs = [
      0, 0,
      1, 0,
      0, 1,
      1, 1,
    ];
    const finishIndices = [
      0, 2, 1,
      1, 2, 3,
    ];

    const finishLineGeo = new THREE.BufferGeometry();
    finishLineGeo.setAttribute('position', new THREE.Float32BufferAttribute(finishPositions, 3));
    finishLineGeo.setAttribute('uv', new THREE.Float32BufferAttribute(finishUvs, 2));
    finishLineGeo.setIndex(finishIndices);
    finishLineGeo.computeVertexNormals();

    const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    let finishTex = null;
    if (canvas) {
      canvas.width = 128;
      canvas.height = 32;
      const ctx = canvas.getContext('2d');
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 8; c++) {
          ctx.fillStyle = (r + c) % 2 === 0 ? '#ffffff' : '#111111';
          ctx.fillRect(c * 16, r * 16, 16, 16);
        }
      }
      finishTex = new THREE.CanvasTexture(canvas);
    }
    const finishMat = new THREE.MeshBasicMaterial({
      map: finishTex,
      color: finishTex ? 0xffffff : 0xdddddd,
    });
    const finishMesh = new THREE.Mesh(finishLineGeo, finishMat);
    finishMesh.receiveShadow = true;
    this.meshesGroup.add(finishMesh);

    // 4. 外側紅白條紋矮牆
    this._buildWalls();

    // 5. Kenney 場景裝飾（看台、樹木、路燈、帳篷）
    if (assets) {
      this._buildDecorations(assets);
    }

    scene.add(this.meshesGroup);
  }

  // 沿賽道兩側建立矮牆
  _buildWalls() {
    const wallHalfW = this.width / 2 + this.shoulder + 0.3;
    const wallHeight = 1.2;
    const positions = [];
    const colors = [];
    const indices = [];

    // 建立左側與右側牆面
    for (let side = -1; side <= 1; side += 2) {
      const baseIdx = positions.length / 3;
      for (let i = 0; i <= this.N; i++) {
        const idx = i % this.N;
        const s = this.sampleAt(idx);
        const wx = s.point.x + side * wallHalfW * s.normal.x;
        const wz = s.point.z + side * wallHalfW * s.normal.z;

        positions.push(wx, 0, wz);
        positions.push(wx, wallHeight, wz);

        const isRed = (Math.floor(idx / 8) % 2) === 0;
        const r = isRed ? 0.85 : 0.95;
        const g = isRed ? 0.15 : 0.95;
        const b = isRed ? 0.15 : 0.95;
        colors.push(r, g, b, r, g, b);

        if (i < this.N) {
          const v = baseIdx + i * 2;
          if (side === 1) {
            // 右側牆：面向賽道內側 (-normal)
            indices.push(v, v + 1, v + 2);
            indices.push(v + 1, v + 3, v + 2);
          } else {
            // 左側牆：面向賽道內側 (+normal)
            indices.push(v, v + 2, v + 1);
            indices.push(v + 1, v + 2, v + 3);
          }
        }
      }
    }

    const wallGeo = new THREE.BufferGeometry();
    wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    wallGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    wallGeo.setIndex(indices);
    wallGeo.computeVertexNormals();

    const wallMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.6,
      side: THREE.DoubleSide,
    });
    const wallMesh = new THREE.Mesh(wallGeo, wallMat);
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    this.meshesGroup.add(wallMesh);
  }

  // 擺放場景裝飾物（樹木、帳篷、看台、起點跨門）
  _buildDecorations(assets) {
    const scale = CONFIG.PROP_SCALE || 8;
    const safeDist = this.width / 2 + this.shoulder + 6;

    // 起點拱門架（跨越起終點）
    if (assets.getProp && assets.getProp('overheadLights')) {
      const lights = assets.getProp('overheadLights');
      const startS = this.sampleAt(0);
      lights.position.set(startS.point.x, 0, startS.point.z);
      // 門架寬度對齊賽道路面加兩側路肩：(16 + 8 + 2) ≈ 26
      const gantryWidth = this.width + 2 * this.shoulder + 2;
      const gantryScale = gantryWidth / 1.26;
      lights.scale.set(gantryScale, gantryScale * 0.7, gantryScale);
      lights.rotation.y = Math.atan2(startS.tangent.x, startS.tangent.z);
      this.meshesGroup.add(lights);
    }

    // 在賽道兩側合適間距擺放樹木與看台
    const propTypes = ['treeLarge', 'treeSmall', 'grandStand', 'tent', 'billboard', 'lightPostModern'];
    for (let i = 0; i < this.N; i += 25) {
      const s = this.sampleAt(i);
      for (const side of [-1, 1]) {
        const offset = safeDist + 6 + (Math.sin(i * 13 + side) * 0.5 + 0.5) * 15;
        const px = s.point.x + side * offset * s.normal.x;
        const pz = s.point.z + side * offset * s.normal.z;

        // 檢查該座標是否離其他段賽道太近
        const proj = this.project(px, pz);
        if (Math.abs(proj.lateral) < safeDist) continue;

        const propName = propTypes[(i + (side > 0 ? 1 : 0)) % propTypes.length];
        if (assets.getProp && assets.getProp(propName)) {
          const prop = assets.getProp(propName);
          prop.position.set(px, 0, pz);
          const pScale = propName.startsWith('tree') ? scale * 1.2 : scale;
          prop.scale.set(pScale, pScale, pScale);
          prop.rotation.y = Math.atan2(s.tangent.x, s.tangent.z) + (side > 0 ? Math.PI : 0);
          this.meshesGroup.add(prop);
        }
      }
    }
  }

  // 清除 3D 物件
  detachView() {
    if (this.meshesGroup && this.meshesGroup.parent) {
      this.meshesGroup.parent.remove(this.meshesGroup);
    }
  }
}
