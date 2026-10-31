// ============================================================
//  track.js — 賽道幾何計算、高低起伏、物理投影與 3D 渲染
//  負責賽道 3D 曲線取樣、高度計算（groundHeight）、連續投影（project 回傳 t）、
//  起跑發車格位（startGrid）、跳台（jumps）以及路面、路肩、裙邊、矮牆網格生成。
//  本模組可於 Node.js 進行幾何與物理投影計算（無 DOM 依賴）。
// ============================================================

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, lerp } from './utils.js';
import { getMap, DEFAULT_MAP_ID } from './maps.js';

export class Track {
  // mapId：地圖代號（見 maps.js），不給時使用預設地圖「陽光草原」
  constructor(mapId = DEFAULT_MAP_ID) {
    this.map = getMap(mapId);
    this.mapId = this.map.id;
    this.theme = this.map.theme;
    this.width = this.map.width || CONFIG.TRACK_WIDTH; // 路面寬度（每張地圖不同）
    this.shoulder = CONFIG.SHOULDER;       // 路肩草地寬度（4）
    this.N = CONFIG.TRACK_SAMPLES || 900;  // 取樣點數量（加長賽道至 900 點）

    // 由地圖資料建立賽道控制點（x、z 乘上 scale 放大，y 為路面高度）
    // 座標經過幾何安排，確保任兩段賽道直線間距充足，避免賽道自我重疊
    const S = this.map.scale || 1;
    const controlPoints = this.map.points.map(([x, y, z]) => new THREE.Vector3(x * S, y, z * S));

    // 建立 3D 封閉曲線
    this.curve = new THREE.CatmullRomCurve3(controlPoints, true, 'centripetal');

    // 預先計算 N 個均勻取樣點
    this.points = [];    // 取樣點平面座標 { x, z }
    this.height = [];    // 取樣點高度 y
    this.tangents = [];  // 前進方向單位切線 { x, z }
    this.normals = [];   // 車輛右手邊單位法線 { x, z }（新定義：(-tz, tx)）
    this.dist = [];      // 沿賽道累積距離

    this._precompute();

    // 跳台設置：由地圖資料指定取樣點索引（遠離道具箱與加速板 > 15 單位）
    this.jumps = (this.map.jumps || []).map((index) => ({ index }));

    // 天氣粒子（例如飄雪），buildMeshes 時建立
    this.weatherPoints = null;

    // 特殊路段：把地圖的 zones（比例）換算成每個取樣點的路面種類
    // surface[i] 為 'sand' / 'ice' / null，影響車輛物理（見 car.js）
    this.zones = (this.map.zones || []).map((z) => ({
      type: z.type,
      start: Math.floor(z.from * this.N),
      end: Math.floor(z.to * this.N),
    }));
    this.surface = new Array(this.N).fill(null);
    for (const zone of this.zones) {
      if (zone.type !== 'sand' && zone.type !== 'ice') continue;
      for (const i of this._zoneIndices(zone)) this.surface[i] = zone.type;
    }
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

    // 每個取樣點的彎道半徑與彎內側（+1 右側 / -1 左側），
    // 讓急彎內側的裙邊縮短，避免網格摺疊穿面（髮夾彎很重要）
    const N = this.N;
    const k = 2; // 用很短的弦長量曲率，才抓得到 Catmull-Rom 曲線上局部變急的地方
    const rawR = [];
    this.innerSide = [];
    for (let i = 0; i < N; i++) {
      const a = this.points[(i - k + N) % N];
      const b = this.points[i];
      const c = this.points[(i + k) % N];
      const ab = Math.hypot(b.x - a.x, b.z - a.z);
      const bc = Math.hypot(c.x - b.x, c.z - b.z);
      const ca = Math.hypot(a.x - c.x, a.z - c.z);
      const cross = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
      rawR.push(cross > 1e-6 ? (ab * bc * ca) / (2 * cross) : 1e6);
      const mx = (a.x + c.x) / 2 - b.x;
      const mz = (a.z + c.z) / 2 - b.z;
      this.innerSide.push(mx * this.normals[i].x + mz * this.normals[i].z >= 0 ? 1 : -1);
    }
    // 取前後 10 個取樣點中最小的半徑（讓裙邊寬度平順變化）
    this.radius = rawR.map((_, i) => {
      let m = Infinity;
      for (let o = -10; o <= 10; o++) m = Math.min(m, rawR[(i + o + N) % N]);
      return m;
    });
  }

  // 列出某個特殊路段涵蓋的取樣點索引（支援跨過起點的路段）
  _zoneIndices(zone) {
    const list = [];
    const len = (zone.end - zone.start + this.N) % this.N;
    for (let k = 0; k <= len; k++) list.push((zone.start + k) % this.N);
    return list;
  }

  // 取得取樣點的路面種類：'sand'（流沙）、'ice'（結冰）或 null（一般路面）
  surfaceAt(index) {
    const i = ((Math.floor(index) % this.N) + this.N) % this.N;
    return this.surface[i];
  }

  // 某種外觀路段（canyon / tunnel）在 index 處的強度 0 ~ 1，兩端 15 個取樣點平滑過渡
  zoneFactor(index, type) {
    let best = 0;
    for (const zone of this.zones) {
      if (zone.type !== type) continue;
      const len = (zone.end - zone.start + this.N) % this.N;
      const k = (index - zone.start + this.N) % this.N;
      if (k > len) continue;
      const edge = Math.min(k, len - k);
      best = Math.max(best, clamp(edge / 15, 0, 1));
    }
    return best;
  }

  // ------------------------------------------------------------
  // 地形高度（只影響外觀，車輛只在路面上跑）
  // 靠近賽道的地面在路面下方；往外逐漸變成每張地圖自己的地形：
  //   hills 山丘、dunes 沙丘（峽谷路段兩側變成岩壁）、mountains 越往外越高的雪山谷地
  // ------------------------------------------------------------

  // 平滑的假雜訊（多個正弦波疊加），回傳約 -1 ~ 1
  _noise(x, z) {
    return (
      Math.sin(x * 0.021 + 1.7) * Math.cos(z * 0.018 - 0.6) +
      0.6 * Math.sin((x + z) * 0.043 + 2.1) +
      0.35 * Math.cos((x - 2 * z) * 0.07)
    ) / 1.95;
  }

  // 快速找出最接近 (x, z) 的路段：先每 6 個取樣點粗找，再用 project 局部精算
  _nearest(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.N; i += 6) {
      const p = this.points[i];
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < bestD) { bestD = d; best = i; }
    }
    return this.project(x, z, best);
  }

  // 世界座標 (x, z) 的地形高度
  terrainHeight(x, z) {
    const proj = this._nearest(x, z);
    const d = Math.abs(proj.lateral);
    const h = this.groundHeight(proj.index, proj.t);
    const edge = this.width / 2 + this.shoulder + 12; // 裙邊外緣
    const base = Math.max(-0.1, h - 1.5);              // 路面旁的地面高度（藏在裙邊下）
    if (d <= edge) return base;

    const terrain = this.theme.terrain || { type: 'flat' };
    const n = this._noise(x, z);
    const out = d - edge;
    let far = 0;
    let blend = 40;

    if (terrain.type === 'hills') {
      far = terrain.amp * (0.5 + 0.5 * n);
    } else if (terrain.type === 'dunes') {
      const dunes = terrain.amp * (0.5 + 0.5 * n);
      const canyon = this.zoneFactor(proj.index, 'canyon');
      far = dunes + canyon * (terrain.cliff + 6 * n - dunes);
      blend = 40 - 28 * canyon; // 峽谷：岩壁緊貼路邊
    } else if (terrain.type === 'mountains') {
      far = base + Math.min(terrain.max, out * terrain.rise) + terrain.amp * (0.5 + 0.5 * n);
    }

    // 高架路段下方的地面形成自然緩坡（不會變成細細的山脊）
    far = Math.max(far, base - out * 0.25);

    const w = clamp(out / blend, 0, 1);
    const smooth = w * w * (3 - 2 * w);
    return lerp(base, far, smooth);
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

    // 1. 地形（山丘 / 沙丘與峽谷 / 雪山谷地）＋ 遠處大平面
    const theme = this.theme;
    this._buildTerrain();

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
    const curbColorA = new THREE.Color(theme.curb[0]);
    const curbColorB = new THREE.Color(theme.curb[1]);

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

      // 路肩兩色交替（每 6 個取樣點切換一次，顏色由地圖主題決定）
      const isRed = (Math.floor(idx / 6) % 2) === 0;
      const curbCol = isRed ? curbColorA : curbColorB;
      const cr = curbCol.r;
      const cg = curbCol.g;
      const cb = curbCol.b;
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

      // 牆外裙邊（斜坡延伸 ~12 單位到地面）；急彎內側縮短到不超過彎道半徑的 85%，避免摺疊
      const skirtW = 12.0;
      const innerW = clamp(this.radius[idx] * 0.85 - totalHalfW, 0.5, skirtW);
      const skirtL = this.innerSide[idx] < 0 ? innerW : skirtW;
      const skirtR = this.innerSide[idx] > 0 ? innerW : skirtW;
      const slx = s.point.x - (totalHalfW + skirtL) * s.normal.x;
      const slz = s.point.z - (totalHalfW + skirtL) * s.normal.z;
      const srx = s.point.x + (totalHalfW + skirtR) * s.normal.x;
      const srz = s.point.z + (totalHalfW + skirtR) * s.normal.z;

      const skirtV = skirtPositions.length / 3;
      // 左裙邊：路肩外側(olx, h, olz) 到 地面(slx, -0.05, slz)
      // 裙邊外緣接到地形高度（與 terrainHeight 在裙邊外緣的值相同）
      const skirtBottom = Math.max(-0.1, h - 1.5);
      skirtPositions.push(olx, h, olz);
      skirtPositions.push(slx, skirtBottom, slz);
      // 右裙邊：路肩外側(orx, h, orz) 到 地面(srx, -0.05, srz)
      skirtPositions.push(orx, h, orz);
      skirtPositions.push(srx, skirtBottom, srz);

      if (i < this.N) {
        // 左裙邊（朝 +Y）
        skirtIndices.push(skirtV, skirtV + 4, skirtV + 1);
        skirtIndices.push(skirtV + 1, skirtV + 4, skirtV + 5);
        // 右裙邊（朝 +Y）
        skirtIndices.push(skirtV + 2, skirtV + 3, skirtV + 6);
        skirtIndices.push(skirtV + 3, skirtV + 7, skirtV + 6);
      }
    }

    // 建立路面網格
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPositions, 3));
    roadGeo.setIndex(roadIndices);
    roadGeo.computeVertexNormals();

    const roadMat = new THREE.MeshStandardMaterial({
      color: theme.road,
      roughness: 0.8,
    });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.name = 'roadMesh';
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
    curbMesh.name = 'curbMesh';
    curbMesh.receiveShadow = true;
    this.meshesGroup.add(curbMesh);

    // 建立 3 單位深綠色草皮減速帶網格
    const shoulderGeo = new THREE.BufferGeometry();
    shoulderGeo.setAttribute('position', new THREE.Float32BufferAttribute(shoulderPositions, 3));
    shoulderGeo.setIndex(shoulderIndices);
    shoulderGeo.computeVertexNormals();

    const shoulderMat = new THREE.MeshStandardMaterial({
      color: theme.shoulder,
      roughness: 0.9,
    });
    const shoulderMesh = new THREE.Mesh(shoulderGeo, shoulderMat);
    shoulderMesh.name = 'shoulderMesh';
    shoulderMesh.receiveShadow = true;
    this.meshesGroup.add(shoulderMesh);

    // 建立裙邊斜坡網格
    const skirtGeo = new THREE.BufferGeometry();
    skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(skirtPositions, 3));
    skirtGeo.setIndex(skirtIndices);
    skirtGeo.computeVertexNormals();

    const skirtMat = new THREE.MeshStandardMaterial({
      color: theme.shoulder,
      roughness: 0.9,
    });
    const skirtMesh = new THREE.Mesh(skirtGeo, skirtMat);
    skirtMesh.name = 'skirtMesh';
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
      color: theme.roadLine,
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

    // 5-1. 特殊路段：流沙、結冰路面與隧道
    this._buildZoneOverlays();

    // 6. Kenney 場景裝飾（門架、看台、帳篷、樹木、路燈）
    if (assets) {
      this._buildDecorations(assets);
    }

    // 7. 地圖專屬遠景（沙漠岩柱、雪地松樹）與天氣粒子（飄雪）
    if (theme.scenery === 'mesas') this._buildMesas();
    if (theme.scenery === 'pines') this._buildPines();
    if (theme.weather === 'snow') this._buildSnowfall();

    scene.add(this.meshesGroup);
  }

  // 沿賽道兩側建立隨高度起伏之紅白矮牆
  _buildWalls() {
    const wallHalfW = this.width / 2 + this.shoulder + 0.3;
    const wallHeight = 1.2;
    const positions = [];
    const colors = [];
    const indices = [];
    const wallColorA = new THREE.Color(this.theme.wall[0]);
    const wallColorB = new THREE.Color(this.theme.wall[1]);

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
        const c = isRed ? wallColorA : wallColorB;
        colors.push(c.r, c.g, c.b, c.r, c.g, c.b);

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
      color: this.theme.ramp,
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
      lights.userData.fromAsset = true;
      lights.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
        }
      });
      this.meshesGroup.add(lights);
    }

    // 沿賽道兩側間距擺放裝飾物
    const propTypes = this.theme.props;
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
          // 擺放在地形表面上
          prop.position.set(px, this.terrainHeight(px, pz), pz);
          const pScale = propName.startsWith('tree') ? scale * 1.2 : scale;
          prop.scale.set(pScale, pScale, pScale);
          prop.rotation.y = Math.atan2(s.tangent.x, s.tangent.z) + (side > 0 ? Math.PI : 0);
          prop.userData.fromAsset = true;

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

  // 建立地形網格：依 terrainHeight 抬高頂點，並依高度上色（低處 colorLow → 高處 colorHigh）
  _buildTerrain() {
    const terrain = this.theme.terrain || {};
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of this.points) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const margin = 260;
    const sizeX = maxX - minX + margin * 2;
    const sizeZ = maxZ - minZ + margin * 2;
    const segX = Math.ceil(sizeX / 6);
    const segZ = Math.ceil(sizeZ / 6);
    const geo = new THREE.PlaneGeometry(sizeX, sizeZ, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    geo.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const low = new THREE.Color(terrain.colorLow ?? this.theme.ground);
    const high = new THREE.Color(terrain.colorHigh ?? this.theme.ground);
    const peak = new THREE.Color(0xffffff);
    const top = terrain.type === 'dunes' ? terrain.cliff : (terrain.type === 'mountains' ? terrain.max : (terrain.amp || 1));
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = this.terrainHeight(x, z);
      pos.setY(i, y);
      const k = clamp(y / (top || 1), 0, 1);
      c.copy(low).lerp(high, k);
      if (terrain.type === 'mountains' && k > 0.65) c.lerp(peak, (k - 0.65) / 0.35); // 雪山頂積雪
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'terrainMesh';
    mesh.receiveShadow = true;
    this.meshesGroup.add(mesh);

    // 地形範圍外的大平面（遠景，被霧遮住）
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshStandardMaterial({ color: this.theme.ground, roughness: 1 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.3;
    this.meshesGroup.add(floor);
  }

  // 特殊路段外觀：流沙（沙色路面＋路邊沙堆）、結冰（半透明亮藍冰面＋路邊雪堆）、隧道
  _buildZoneOverlays() {
    const halfW = this.width / 2;
    const styles = {
      sand: { color: 0xd8a25e, opacity: 0.9, roughness: 1, metalness: 0, pile: 0xe2b26c },
      ice: { color: 0xbfe9ff, opacity: 0.72, roughness: 0.08, metalness: 0.35, pile: 0xf4f8ff },
    };

    for (const zone of this.zones) {
      if (zone.type === 'tunnel') {
        this._buildTunnel(zone);
        continue;
      }
      const style = styles[zone.type];
      if (!style) continue;

      // 路面覆蓋層（比路面高一點點，低於中線）
      const positions = [];
      const indices = [];
      const idxList = this._zoneIndices(zone);
      idxList.forEach((idx, k) => {
        const sm = this.sampleAt(idx);
        // 邊緣做成鋸齒狀，看起來像沙堆 / 冰面自然蔓延到路上
        const jag = 0.85 + 0.15 * Math.sin(idx * 1.7);
        const y = sm.height + 0.012;
        positions.push(sm.point.x - halfW * jag * sm.normal.x, y, sm.point.z - halfW * jag * sm.normal.z);
        positions.push(sm.point.x + halfW * jag * sm.normal.x, y, sm.point.z + halfW * jag * sm.normal.z);
        if (k < idxList.length - 1) {
          const v = k * 2;
          indices.push(v, v + 1, v + 2);
          indices.push(v + 1, v + 3, v + 2);
        }
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        color: style.color,
        transparent: true,
        opacity: style.opacity,
        roughness: style.roughness,
        metalness: style.metalness,
      });
      const overlay = new THREE.Mesh(geo, mat);
      overlay.name = `${zone.type}Overlay`;
      overlay.receiveShadow = true;
      this.meshesGroup.add(overlay);

      // 路肩上的沙堆 / 雪堆
      const pileMat = new THREE.MeshStandardMaterial({ color: style.pile, roughness: 1, flatShading: true });
      const pileGeo = new THREE.SphereGeometry(1.6, 7, 5);
      for (let k = 0; k < idxList.length; k += 5) {
        const sm = this.sampleAt(idxList[k]);
        for (const side of [-1, 1]) {
          const lat = side * (halfW + 1.2 + (k % 3));
          const pile = new THREE.Mesh(pileGeo, pileMat);
          pile.position.set(sm.point.x + lat * sm.normal.x, sm.height - 0.4, sm.point.z + lat * sm.normal.z);
          pile.scale.set(1 + (k % 4) * 0.2, 0.45, 1.3);
          this.meshesGroup.add(pile);
        }
      }
    }
  }

  // 隧道：沿賽道建立半圓拱頂（雙面材質）、出入口石框與天花板燈
  _buildTunnel(zone) {
    const idxList = this._zoneIndices(zone);
    const R = this.width / 2 + this.shoulder + 0.8;
    const squash = 0.72;
    const K = 12;
    const positions = [];
    const indices = [];
    idxList.forEach((idx, k) => {
      const sm = this.sampleAt(idx);
      for (let j = 0; j <= K; j++) {
        const a = (j / K) * Math.PI;
        positions.push(
          sm.point.x + Math.cos(a) * R * sm.normal.x,
          sm.height + Math.sin(a) * R * squash,
          sm.point.z + Math.cos(a) * R * sm.normal.z
        );
      }
      if (k < idxList.length - 1) {
        for (let j = 0; j < K; j++) {
          const v = k * (K + 1) + j;
          indices.push(v, v + K + 1, v + 1);
          indices.push(v + 1, v + K + 1, v + K + 2);
        }
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const tunnel = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0x6f7480, roughness: 0.95, flatShading: true, side: THREE.DoubleSide,
    }));
    tunnel.name = 'tunnelMesh';
    tunnel.castShadow = true;
    tunnel.receiveShadow = true;
    this.meshesGroup.add(tunnel);

    // 出入口石框（半圓環）
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x4b4f58, roughness: 1, flatShading: true });
    for (const idx of [idxList[0], idxList[idxList.length - 1]]) {
      const sm = this.sampleAt(idx);
      const frame = new THREE.Mesh(new THREE.TorusGeometry(R, 1.4, 6, 14, Math.PI), frameMat);
      frame.scale.set(1, squash, 1);
      frame.position.set(sm.point.x, sm.height, sm.point.z);
      frame.rotation.y = Math.atan2(sm.tangent.x, sm.tangent.z) + Math.PI / 2;
      frame.castShadow = true;
      this.meshesGroup.add(frame);
    }

    // 天花板燈（自發光小燈條）
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
    const lampGeo = new THREE.BoxGeometry(0.6, 0.15, 2.4);
    for (let k = 4; k < idxList.length - 4; k += 8) {
      const sm = this.sampleAt(idxList[k]);
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(sm.point.x, sm.height + R * squash - 0.3, sm.point.z);
      lamp.rotation.y = Math.atan2(sm.tangent.x, sm.tangent.z);
      this.meshesGroup.add(lamp);
    }
  }

  // 在賽道外的空地上找擺放點（離任何路段都夠遠），回傳 { x, z } 陣列
  // 使用固定種子的亂數，讓每次載入同一張地圖的景物位置都一樣
  _scatterPoints(count, minClear, spread) {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const result = [];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of this.points) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    for (let tries = 0; tries < count * 8 && result.length < count; tries++) {
      const x = lerp(minX - spread, maxX + spread, rand());
      const z = lerp(minZ - spread, maxZ + spread, rand());
      const proj = this.project(x, z);
      if (Math.abs(proj.lateral) < minClear) continue;
      result.push({ x, z, r: rand() });
    }
    return result;
  }

  // 沙漠地圖：程式生成紅色岩柱（台地）與仙人掌
  _buildMesas() {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0xb5562b, roughness: 1, flatShading: true });
    const rockTopMat = new THREE.MeshStandardMaterial({ color: 0xd9824a, roughness: 1, flatShading: true });
    for (const p of this._scatterPoints(26, 45, 140)) {
      const radius = 10 + p.r * 22;
      const height = 18 + p.r * 40;
      const geo = new THREE.CylinderGeometry(radius * 0.75, radius, height, 7);
      const mesa = new THREE.Mesh(geo, p.r > 0.5 ? rockMat : rockTopMat);
      mesa.position.set(p.x, this.terrainHeight(p.x, p.z) + height / 2 - 2, p.z);
      mesa.rotation.y = p.r * Math.PI * 2;
      mesa.castShadow = height > 40;
      this.meshesGroup.add(mesa);
    }

    const cactusMat = new THREE.MeshStandardMaterial({ color: 0x3c8d2f, roughness: 0.8 });
    const trunkGeo = new THREE.CylinderGeometry(0.6, 0.7, 6, 8);
    const armGeo = new THREE.CylinderGeometry(0.4, 0.45, 2.6, 8);
    for (const p of this._scatterPoints(60, 18, 40)) {
      const cactus = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, cactusMat);
      trunk.position.y = 3;
      cactus.add(trunk);
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(armGeo, cactusMat);
        arm.position.set(side * 1.1, 3 + p.r * 1.5 + (side > 0 ? 0.6 : 0), 0);
        cactus.add(arm);
      }
      const s = 0.8 + p.r * 0.8;
      cactus.scale.set(s, s, s);
      cactus.position.set(p.x, this.terrainHeight(p.x, p.z) - 0.2, p.z);
      cactus.rotation.y = p.r * Math.PI * 2;
      this.meshesGroup.add(cactus);
    }
  }

  // 雪地地圖：程式生成積雪松樹（雪山由地形負責）
  _buildPines() {
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x1f5e45, roughness: 0.9, flatShading: true });
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xf4f8ff, roughness: 0.9, flatShading: true });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3d2b, roughness: 1 });
    const trunkGeo = new THREE.CylinderGeometry(0.5, 0.6, 2.4, 6);
    const coneGeos = [
      new THREE.ConeGeometry(4.2, 5.5, 7),
      new THREE.ConeGeometry(3.2, 4.5, 7),
      new THREE.ConeGeometry(2.0, 3.6, 7),
    ];
    const capGeo = new THREE.ConeGeometry(1.3, 2.2, 7);

    for (const p of this._scatterPoints(90, 17, 50)) {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 1.2;
      tree.add(trunk);
      coneGeos.forEach((geo, k) => {
        const cone = new THREE.Mesh(geo, leafMat);
        cone.position.y = 3.8 + k * 2.6;
        tree.add(cone);
      });
      const cap = new THREE.Mesh(capGeo, snowMat);
      cap.position.y = 10.6;
      tree.add(cap);
      const s = 1.0 + p.r * 0.9;
      tree.scale.set(s, s, s);
      tree.position.set(p.x, this.terrainHeight(p.x, p.z) - 0.2, p.z);
      tree.traverse((node) => { if (node.isMesh) node.castShadow = p.r > 0.6; });
      this.meshesGroup.add(tree);
    }
  }

  // 飄雪粒子：在賽道範圍內隨機散布雪花，updateWeather 每幀讓它們往下飄
  _buildSnowfall() {
    const count = 6000;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of this.points) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = lerp(minX - 40, maxX + 40, Math.random());
      positions[i * 3 + 1] = Math.random() * 60;
      positions[i * 3 + 2] = lerp(minZ - 40, maxZ + 40, Math.random());
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.45,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.weatherPoints = new THREE.Points(geo, mat);
    this.weatherPoints.frustumCulled = false;
    this.weatherTime = 0;
    this.meshesGroup.add(this.weatherPoints);
  }

  // 每幀更新天氣粒子（雪花往下飄、左右搖擺，掉到地面就回到上方）
  updateWeather(dt) {
    if (!this.weatherPoints) return;
    this.weatherTime += dt;
    const attr = this.weatherPoints.geometry.attributes.position;
    const arr = attr.array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] -= (5 + (i % 7)) * dt;
      arr[i] += Math.sin(this.weatherTime * 0.8 + i) * 1.2 * dt;
      if (arr[i + 1] < 0) arr[i + 1] += 60;
    }
    attr.needsUpdate = true;
  }

  // 清除 3D 物件並釋放這條賽道建立的幾何體與材質（換地圖時呼叫）
  detachView() {
    if (this.meshesGroup && this.meshesGroup.parent) {
      this.meshesGroup.parent.remove(this.meshesGroup);
    }
    if (this.meshesGroup) {
      // Kenney 模型是從 assets 範本複製出來的（共用幾何體與材質），標記 fromAsset 的不可釋放
      for (const child of this.meshesGroup.children) {
        if (child.userData.fromAsset) continue;
        child.traverse((node) => {
          node.geometry?.dispose?.();
          const mats = Array.isArray(node.material) ? node.material : (node.material ? [node.material] : []);
          for (const mat of mats) {
            mat.map?.dispose?.();
            mat.dispose?.();
          }
        });
      }
    }
    this.meshesGroup = null;
    this.weatherPoints = null;
  }
}
