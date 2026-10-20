// ============================================================
//  track.js — 賽道幾何計算、高低起伏、物理投影與 3D 渲染
//  負責賽道 3D 曲線取樣、高度計算（groundHeight）、連續投影（project 回傳 t）、
//  起跑發車格位（startGrid）、跳台（jumps）以及路面、路肩、裙邊、矮牆網格生成。
//  本模組可於 Node.js 進行幾何與物理投影計算（無 DOM 依賴）。
// ============================================================

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, lerp } from './utils.js';

export class Track {
  constructor() {
    this.width = CONFIG.TRACK_WIDTH;       // 路面寬度（16）
    this.shoulder = CONFIG.SHOULDER;       // 路肩草地寬度（4）
    this.N = CONFIG.TRACK_SAMPLES || 900;  // 取樣點數量（加長賽道至 900 點）

    // 設計 18 個賽道控制點（總長 1200 ~ 1500，具備長上坡、高點跳台、下坡、S彎與髮夾急彎）
    // 座標經過嚴格幾何安排，確保任兩段賽道直線間距充足，避免賽道自我重疊
    const S = 1.15; // 尺度放大係數以確保長度介於 1200 ~ 1500
    const controlPoints = [
      new THREE.Vector3(0 * S, 0, 110 * S),         // 0: 起終點大直道（平坦 y=0）
      new THREE.Vector3(80 * S, 0, 110 * S),        // 1: 直道加速段
      new THREE.Vector3(160 * S, 2.0, 100 * S),     // 2: 第 1 彎進彎，開始緩上坡
      new THREE.Vector3(210 * S, 5.0, 60 * S),      // 3: 高速弧形右彎長上坡
      new THREE.Vector3(230 * S, 8.5, 0 * S),       // 4: 接近坡頂
      new THREE.Vector3(210 * S, 9.5, -60 * S),     // 5: 坡頂至高點（高度 ~9.5）
      new THREE.Vector3(160 * S, 7.5, -100 * S),    // 6: 坡頂下坡直道（跳台設置處）
      new THREE.Vector3(90 * S, 4.0, -115 * S),     // 7: 快速下坡衝刺
      new THREE.Vector3(20 * S, 2.0, -100 * S),     // 8: 緩衝平緩彎道
      new THREE.Vector3(-40 * S, 1.0, -125 * S),    // 9: S 彎入口
      new THREE.Vector3(-100 * S, 3.0, -145 * S),   // 10: S 彎中段切換
      new THREE.Vector3(-165 * S, 5.0, -130 * S),   // 11: 髮夾彎前置坡道
      new THREE.Vector3(-215 * S, 4.0, -80 * S),    // 12: 髮夾急彎煞車點
      new THREE.Vector3(-230 * S, 2.0, -20 * S),    // 13: 髮夾急彎頂點（180度）
      new THREE.Vector3(-210 * S, 0.5, 40 * S),     // 14: 髮夾彎出彎下坡
      new THREE.Vector3(-160 * S, 0, 80 * S),       // 15: 接回低處平原直道
      new THREE.Vector3(-110 * S, 0, 105 * S),      // 16: 回歸大直道前 S 緩彎
      new THREE.Vector3(-50 * S, 0, 110 * S),       // 17: 接回起終點直道
    ];

    // 建立 3D 封閉曲線
    this.curve = new THREE.CatmullRomCurve3(controlPoints, true, 'centripetal');

    // 預先計算 N 個均勻取樣點
    this.points = [];    // 取樣點平面座標 { x, z }
    this.height = [];    // 取樣點高度 y
    this.tangents = [];  // 前進方向單位切線 { x, z }
    this.normals = [];   // 車輛右手邊單位法線 { x, z }（新定義：(-tz, tx)）
    this.dist = [];      // 沿賽道累積距離

    this._precompute();

    // 跳台設置：坡頂下坡處（索引約 340 處，遠離道具箱與加速板 > 15 單位）
    this.jumps = [
      { index: 340 },
    ];
  }

  // 預先計算取樣點的幾何資料（點、高度、切線、右手邊法線、累積長度）
  _precompute() {
    let accumulated = 0;
    this.dist.push(0);

    for (let i = 0; i < this.N; i++) {
      const u = i / this.N;
      const pt3 = this.curve.getPointAt(u);
      const tan3 = this.curve.getTangentAt(u);

      this.points.push({ x: pt3.x, z: pt3.z });
      this.height.push(Math.max(0, pt3.y));

      // 平面切線單位化
      const tanLen = Math.hypot(tan3.x, tan3.z) || 1;
      const tx = tan3.x / tanLen;
      const tz = tan3.z / tanLen;
      this.tangents.push({ x: tx, z: tz });

      // 6.0 修正：右手邊法向量為 (-tz, tx)
      // 當 lateral > 0 時，代表位於車後方視角所見的車輛右側
      this.normals.push({ x: -tz, z: tx });

      if (i > 0) {
        const prev = this.points[i - 1];
        const dx = pt3.x - prev.x;
        const dz = pt3.z - prev.z;
        accumulated += Math.hypot(dx, dz);
        this.dist.push(accumulated);
      }
    }

    // 計算封閉環狀總長度
    const pLast = this.points[this.N - 1];
    const pFirst = this.points[0];
    this.length = accumulated + Math.hypot(pFirst.x - pLast.x, pFirst.z - pLast.z);
  }

  // 計算任意賽道片段與插值參數 t 之地面世界高度
  // t 為 0 ~ 1 之連續參數，保證取樣點之間高度完全連續無突變抖動
  groundHeight(index, t = 0) {
    const i = ((Math.floor(index) % this.N) + this.N) % this.N;
    const nextI = (i + 1) % this.N;
    const clampedT = clamp(t, 0, 1);
    return Math.max(0, lerp(this.height[i], this.height[nextI], clampedT));
  }

  // 投影任意世界座標 (x, z) 到賽道上，回傳最近線段起始取樣點 index、側向距離 lateral 與線段內插比率 t (0~1)
  // lateral > 0 代表在賽道切線右手邊，< 0 代表在左手邊
  // 若提供 hintIndex 則只搜尋前後 30 個線段（速度快），否則全域搜尋 0~N-1
  project(x, z, hintIndex = null) {
    const N = this.N;
    let bestSeg = 0;
    let bestDistSq = Infinity;
    let bestT = 0;
    let bestNormX = 0;
    let bestNormZ = 1;

    // 建立候選線段索引清單
    const candidates = [];
    if (hintIndex != null && hintIndex >= 0) {
      const range = 30;
      for (let offset = -range; offset <= range; offset++) {
        candidates.push((hintIndex + offset + N) % N);
      }
    } else {
      for (let i = 0; i < N; i++) {
        candidates.push(i);
      }
    }

    // 找出距離 (x, z) 最近的賽道線段 [points[i], points[(i+1)%N]]
    for (const i of candidates) {
      const A = this.points[i];
      const B = this.points[(i + 1) % N];
      const dx = B.x - A.x;
      const dz = B.z - A.z;
      const segLenSq = dx * dx + dz * dz;

      // 投影參數 u
      const u = segLenSq > 0 ? ((x - A.x) * dx + (z - A.z) * dz) / segLenSq : 0;
      const tClamped = clamp(u, 0, 1);

      const cx = A.x + tClamped * dx;
      const cz = A.z + tClamped * dz;
      const dSq = (x - cx) * (x - cx) + (z - cz) * (z - cz);

      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestSeg = i;
        bestT = tClamped;

        // 計算該線段的單位切線與右手邊法線
        const segLen = Math.sqrt(segLenSq) || 1;
        const tx = dx / segLen;
        const tz = dz / segLen;
        bestNormX = -tz;
        bestNormZ = tx;
      }
    }

    // 計算連續側向距離 lateral
    const pA = this.points[bestSeg];
    const pB = this.points[(bestSeg + 1) % N];
    const projX = pA.x + bestT * (pB.x - pA.x);
    const projZ = pA.z + bestT * (pB.z - pA.z);

    const lateral = (x - projX) * bestNormX + (z - projZ) * bestNormZ;

    return { index: bestSeg, lateral, t: bestT };
  }

  // 取得特定取樣點的資訊（位置、高度、切線、右手邊法線）
  sampleAt(index) {
    const i = ((Math.floor(index) % this.N) + this.N) % this.N;
    return {
      point: this.points[i],
      height: this.height[i],
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
      y: s.height,
      z: s.point.z + lateral * s.normal.z,
    };
  }

  // 取得起跑發車格位置（slot 0~3）
  // 4 台車在起跑線後方兩兩並排，朝向前方
  startGrid(slot) {
    // slot 0, 1 在第 1 排（索引 N - 12）；slot 2, 3 在第 2 排（索引 N - 24）
    const row = Math.floor(slot / 2);
    const col = slot % 2; // 0 為左車位，1 為右車位
    const idx = (this.N - 12 - row * 12 + this.N) % this.N;
    // 依據新法線定義：左車位 lateral 為 -3.5，右車位 lateral 為 +3.5
    const lateral = col === 0 ? -3.5 : 3.5;

    const pos = this.pointAtLateral(idx, lateral);
    const s = this.sampleAt(idx);
    const heading = Math.atan2(s.tangent.x, s.tangent.z);

    return {
      x: pos.x,
      y: s.height,
      z: pos.z,
      heading,
      index: idx,
      lateral,
    };
  }

  // 建立 3D 視覺模型（路面、路肩、裙邊、矮牆、起終點線與跳台斜坡）
  buildMeshes(scene, assets = null) {
    if (!scene) return;

    this.meshesGroup = new THREE.Group();
    this.meshesGroup.name = 'trackMeshes';

    // 1. 寬廣草地大平面（y = -0.08，維持在 -0.05 以下）
    const grassGeo = new THREE.PlaneGeometry(1600, 1600);
    const grassMat = new THREE.MeshStandardMaterial({
      color: 0x27ae60,
      roughness: 0.9,
    });
    const grass = new THREE.Mesh(grassGeo, grassMat);
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.08;
    grass.receiveShadow = true;
    this.meshesGroup.add(grass);

    // 2. 賽道路面、1單位紅白路肩、3單位草地路肩與裙邊
    const halfW = this.width / 2;
    const curbW = 1.0; // 紅白路肩寬 1 單位
    const curbHalfW = halfW + curbW; // 9
    const shoulderW = this.shoulder;
    const totalHalfW = halfW + shoulderW; // 12

    const roadPositions = [];
    const roadIndices = [];
    const curbPositions = [];
    const curbColors = [];
    const curbIndices = [];
    const shoulderPositions = [];
    const shoulderIndices = [];
    const skirtPositions = [];
    const skirtIndices = [];

    for (let i = 0; i <= this.N; i++) {
      const idx = i % this.N;
      const s = this.sampleAt(idx);
      const h = s.height;

      // 路面左右頂點（左：-halfW*normal，右：+halfW*normal）
      const lx = s.point.x - halfW * s.normal.x;
      const lz = s.point.z - halfW * s.normal.z;
      const rx = s.point.x + halfW * s.normal.x;
      const rz = s.point.z + halfW * s.normal.z;

      roadPositions.push(lx, h + 0.01, lz);
      roadPositions.push(rx, h + 0.01, rz);

      if (i < this.N) {
        const v = i * 2;
        // 繞向確保法線朝向 +Y 上方
        roadIndices.push(v, v + 1, v + 2);
        roadIndices.push(v + 1, v + 3, v + 2);
      }

      // 1 單位寬紅白路肩頂點
      const clx = s.point.x - curbHalfW * s.normal.x;
      const clz = s.point.z - curbHalfW * s.normal.z;
      const crx = s.point.x + curbHalfW * s.normal.x;
      const crz = s.point.z + curbHalfW * s.normal.z;

      const curbV = curbPositions.length / 3;
      // 左路肩（外側 cl 到 內側 l）
      curbPositions.push(clx, h + 0.007, clz);
      curbPositions.push(lx, h + 0.007, lz);
      // 右路肩（內側 r 到 外側 cr）
      curbPositions.push(rx, h + 0.007, rz);
      curbPositions.push(crx, h + 0.007, crz);

      // 紅白交替顏色（每 6 個取樣點切換一次）
      const isRed = (Math.floor(idx / 6) % 2) === 0;
      const cr = isRed ? 0.9 : 1.0;
      const cg = isRed ? 0.2 : 1.0;
      const cb = isRed ? 0.2 : 1.0;
      curbColors.push(cr, cg, cb, cr, cg, cb, cr, cg, cb, cr, cg, cb);

      if (i < this.N) {
        // 左路肩（朝 +Y）
        curbIndices.push(curbV, curbV + 1, curbV + 4);
        curbIndices.push(curbV + 1, curbV + 5, curbV + 4);
        // 右路肩（朝 +Y）
        curbIndices.push(curbV + 2, curbV + 3, curbV + 6);
        curbIndices.push(curbV + 3, curbV + 7, curbV + 6);
      }

      // 3 單位寬草皮路肩頂點（外側 ol 到 路肩外緣 cl）
      const olx = s.point.x - totalHalfW * s.normal.x;
      const olz = s.point.z - totalHalfW * s.normal.z;
      const orx = s.point.x + totalHalfW * s.normal.x;
      const orz = s.point.z + totalHalfW * s.normal.z;

      const shV = shoulderPositions.length / 3;
      // 左側綠色草地帶（外側 ol 到 內側 cl）
      shoulderPositions.push(olx, h + 0.004, olz);
      shoulderPositions.push(clx, h + 0.004, clz);
      // 右側綠色草地帶（內側 cr 到 外側 or）
      shoulderPositions.push(crx, h + 0.004, crz);
      shoulderPositions.push(orx, h + 0.004, orz);

      if (i < this.N) {
        // 左草皮肩（朝 +Y）
        shoulderIndices.push(shV, shV + 1, shV + 4);
        shoulderIndices.push(shV + 1, shV + 5, shV + 4);
        // 右草皮肩（朝 +Y）
        shoulderIndices.push(shV + 2, shV + 3, shV + 6);
        shoulderIndices.push(shV + 3, shV + 7, shV + 6);
      }

      // 牆外裙邊（斜坡延伸 ~12 單位至 y=-0.05 地面）
      const skirtW = 12.0;
      const slx = s.point.x - (totalHalfW + skirtW) * s.normal.x;
      const slz = s.point.z - (totalHalfW + skirtW) * s.normal.z;
      const srx = s.point.x + (totalHalfW + skirtW) * s.normal.x;
      const srz = s.point.z + (totalHalfW + skirtW) * s.normal.z;

      const skirtV = skirtPositions.length / 3;
      // 左裙邊：路肩外側(olx, h, olz) 到 地面(slx, -0.05, slz)
      skirtPositions.push(olx, h, olz);
      skirtPositions.push(slx, -0.05, slz);
      // 右裙邊：路肩外側(orx, h, orz) 到 地面(srx, -0.05, srz)
      skirtPositions.push(orx, h, orz);
      skirtPositions.push(srx, -0.05, srz);

      if (i < this.N) {
        // 左裙邊
        skirtIndices.push(skirtV, skirtV + 1, skirtV + 4);
        skirtIndices.push(skirtV + 1, skirtV + 5, skirtV + 4);
        // 右裙邊
        skirtIndices.push(skirtV + 2, skirtV + 6, skirtV + 3);
        skirtIndices.push(skirtV + 3, skirtV + 6, skirtV + 7);
      }
    }

    // 建立路面網格
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

    // 建立 1 單位紅白路肩網格
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

    // 建立 3 單位深綠色草皮減速帶網格
    const shoulderGeo = new THREE.BufferGeometry();
    shoulderGeo.setAttribute('position', new THREE.Float32BufferAttribute(shoulderPositions, 3));
    shoulderGeo.setIndex(shoulderIndices);
    shoulderGeo.computeVertexNormals();

    const shoulderMat = new THREE.MeshStandardMaterial({
      color: 0x1e824c,
      roughness: 0.9,
    });
    const shoulderMesh = new THREE.Mesh(shoulderGeo, shoulderMat);
    shoulderMesh.receiveShadow = true;
    this.meshesGroup.add(shoulderMesh);

    // 建立裙邊斜坡網格
    const skirtGeo = new THREE.BufferGeometry();
    skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(skirtPositions, 3));
    skirtGeo.setIndex(skirtIndices);
    skirtGeo.computeVertexNormals();

    const skirtMat = new THREE.MeshStandardMaterial({
      color: 0x1e824c,
      roughness: 0.9,
    });
    const skirtMesh = new THREE.Mesh(skirtGeo, skirtMat);
    skirtMesh.receiveShadow = true;
    this.meshesGroup.add(skirtMesh);

    // 2.5 路面中線白色短虛線
    const centerPositions = [];
    const centerIndices = [];
    for (let i = 0; i < this.N; i++) {
      if ((i % 6) < 3) {
        const sA = this.sampleAt(i);
        const sB = this.sampleAt(i + 1);
        const halfDashW = 0.2;

        const cV = centerPositions.length / 3;
        centerPositions.push(
          sA.point.x - halfDashW * sA.normal.x, sA.height + 0.015, sA.point.z - halfDashW * sA.normal.z,
          sA.point.x + halfDashW * sA.normal.x, sA.height + 0.015, sA.point.z + halfDashW * sA.normal.z,
          sB.point.x - halfDashW * sB.normal.x, sB.height + 0.015, sB.point.z - halfDashW * sB.normal.z,
          sB.point.x + halfDashW * sB.normal.x, sB.height + 0.015, sB.point.z + halfDashW * sB.normal.z
        );
        centerIndices.push(cV, cV + 1, cV + 2);
        centerIndices.push(cV + 1, cV + 3, cV + 2);
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

    // 3. 起終點黑白格紋線（索引 0 處）
    const s0 = this.sampleAt(0);
    const halfRoadW = this.width / 2;
    const halfThick = 1.5;
    const h0 = s0.height + 0.02;

    const fl_x0 = s0.point.x - halfRoadW * s0.normal.x - halfThick * s0.tangent.x;
    const fl_z0 = s0.point.z - halfRoadW * s0.normal.z - halfThick * s0.tangent.z;
    const fl_x1 = s0.point.x + halfRoadW * s0.normal.x - halfThick * s0.tangent.x;
    const fl_z1 = s0.point.z + halfRoadW * s0.normal.z - halfThick * s0.tangent.z;
    const fl_x2 = s0.point.x - halfRoadW * s0.normal.x + halfThick * s0.tangent.x;
    const fl_z2 = s0.point.z - halfRoadW * s0.normal.z + halfThick * s0.tangent.z;
    const fl_x3 = s0.point.x + halfRoadW * s0.normal.x + halfThick * s0.tangent.x;
    const fl_z3 = s0.point.z + halfRoadW * s0.normal.z + halfThick * s0.tangent.z;

    const finishPositions = [
      fl_x0, h0, fl_z0,
      fl_x1, h0, fl_z1,
      fl_x2, h0, fl_z2,
      fl_x3, h0, fl_z3,
    ];
    const finishUvs = [
      0, 0,
      1, 0,
      0, 1,
      1, 1,
    ];
    const finishIndices = [
      0, 1, 2,
      1, 3, 2,
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

    // 5. 跳台楔形斜坡 3D 網格（高 1.5、長 6、全路寬）
    this._buildJumpRamps();

    // 6. Kenney 場景裝飾（門架、看台、帳篷、樹木、路燈）
    if (assets) {
      this._buildDecorations(assets);
    }

    scene.add(this.meshesGroup);
  }

  // 沿賽道兩側建立隨高度起伏之紅白矮牆
  _buildWalls() {
    const wallHalfW = this.width / 2 + this.shoulder + 0.3;
    const wallHeight = 1.2;
    const positions = [];
    const colors = [];
    const indices = [];

    for (let side of [-1, 1]) {
      const baseIdx = positions.length / 3;
      for (let i = 0; i <= this.N; i++) {
        const idx = i % this.N;
        const s = this.sampleAt(idx);
        const wx = s.point.x + side * wallHalfW * s.normal.x;
        const wz = s.point.z + side * wallHalfW * s.normal.z;
        const baseY = s.height;
        const topY = s.height + wallHeight;

        positions.push(wx, baseY, wz);
        positions.push(wx, topY, wz);

        const isRed = (Math.floor(idx / 8) % 2) === 0;
        const r = isRed ? 0.85 : 0.95;
        const g = isRed ? 0.15 : 0.95;
        const b = isRed ? 0.15 : 0.95;
        colors.push(r, g, b, r, g, b);

        if (i < this.N) {
          const v = baseIdx + i * 2;
          if (side === 1) {
            indices.push(v, v + 2, v + 1);
            indices.push(v + 1, v + 2, v + 3);
          } else {
            indices.push(v, v + 1, v + 2);
            indices.push(v + 1, v + 3, v + 2);
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

  // 建立跳台 3D 楔形網格
  _buildJumpRamps() {
    const rampMat = new THREE.MeshStandardMaterial({
      color: 0xf39c12,
      roughness: 0.5,
    });

    const halfW = this.width / 2;
    const rampLen = 6.0;
    const rampHeight = 1.5;

    for (const jump of this.jumps) {
      const s = this.sampleAt(jump.index);
      const h = s.height;

      // 建立楔形斜坡幾何體（4 個底頂點與 2 個高起頂點）
      const pA_L = { x: s.point.x - halfW * s.normal.x, z: s.point.z - halfW * s.normal.z, y: h + 0.02 };
      const pA_R = { x: s.point.x + halfW * s.normal.x, z: s.point.z + halfW * s.normal.z, y: h + 0.02 };
      const pB_L = {
        x: s.point.x + rampLen * s.tangent.x - halfW * s.normal.x,
        z: s.point.z + rampLen * s.tangent.z - halfW * s.normal.z,
        y: h + rampHeight,
      };
      const pB_R = {
        x: s.point.x + rampLen * s.tangent.x + halfW * s.normal.x,
        z: s.point.z + rampLen * s.tangent.z + halfW * s.normal.z,
        y: h + rampHeight,
      };

      const rampPositions = [
        // 斜面（上表面）
        pA_L.x, pA_L.y, pA_L.z,
        pA_R.x, pA_R.y, pA_R.z,
        pB_L.x, pB_L.y, pB_L.z,
        pB_R.x, pB_R.y, pB_R.z,
        // 背面立面
        pB_L.x, h + 0.02, pB_L.z,
        pB_R.x, h + 0.02, pB_R.z,
      ];

      const rampIndices = [
        // 斜面
        0, 1, 2,
        1, 3, 2,
        // 後立面
        4, 2, 5,
        5, 2, 3,
      ];

      const rampGeo = new THREE.BufferGeometry();
      rampGeo.setAttribute('position', new THREE.Float32BufferAttribute(rampPositions, 3));
      rampGeo.setIndex(rampIndices);
      rampGeo.computeVertexNormals();

      const rampMesh = new THREE.Mesh(rampGeo, rampMat);
      rampMesh.castShadow = true;
      rampMesh.receiveShadow = true;
      this.meshesGroup.add(rampMesh);
    }
  }

  // 擺放場景裝飾物（樹木、帳篷、看台、起點跨門）
  // 6.7 效能優化：只給大型物件（看台、門架、大樹）開啟 castShadow
  _buildDecorations(assets) {
    const scale = CONFIG.PROP_SCALE || 8;
    const safeDist = this.width / 2 + this.shoulder + 6;

    // 起點拱門架（跨越起終點）
    const lights = assets.getProp ? assets.getProp('overheadLights') : null;
    if (lights) {
      const startS = this.sampleAt(0);
      lights.position.set(startS.point.x, startS.height, startS.point.z);
      const gantryWidth = this.width + 2 * this.shoulder + 2;
      const gantryScale = gantryWidth / 1.26;
      lights.scale.set(gantryScale, gantryScale * 0.7, gantryScale);
      lights.rotation.y = Math.atan2(startS.tangent.x, startS.tangent.z);
      lights.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
        }
      });
      this.meshesGroup.add(lights);
    }

    // 沿賽道兩側間距擺放裝飾物
    const propTypes = ['treeLarge', 'treeSmall', 'grandStand', 'grandStandCovered', 'tent', 'billboard', 'lightPostModern'];
    for (let i = 0; i < this.N; i += 30) {
      const s = this.sampleAt(i);
      for (const side of [-1, 1]) {
        const offset = safeDist + 6 + (Math.sin(i * 17 + side) * 0.5 + 0.5) * 16;
        const px = s.point.x + side * offset * s.normal.x;
        const pz = s.point.z + side * offset * s.normal.z;

        // 避免與其他賽道路段重疊過近
        const proj = this.project(px, pz);
        if (Math.abs(proj.lateral) < safeDist) continue;

        const propName = propTypes[(i + (side > 0 ? 1 : 0)) % propTypes.length];
        const prop = assets.getProp ? assets.getProp(propName) : null;
        if (prop) {
          // 擺放在外側平面草地上（y = 0，避免起伏山丘路段懸空）
          prop.position.set(px, 0, pz);
          const pScale = propName.startsWith('tree') ? scale * 1.2 : scale;
          prop.scale.set(pScale, pScale, pScale);
          prop.rotation.y = Math.atan2(s.tangent.x, s.tangent.z) + (side > 0 ? Math.PI : 0);

          // 效能優化：小型物件不投影
          const isHeavyProp = (propName === 'treeLarge' || propName.startsWith('grandStand'));
          prop.traverse((node) => {
            if (node.isMesh) {
              node.castShadow = isHeavyProp;
            }
          });

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
