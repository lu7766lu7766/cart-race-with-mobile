// ============================================================
//  track.test.js — 賽道幾何、起伏坡度、高程連續性與跳台間距單元測試
//  涵蓋：
//  1. 賽道加長至 1200 ~ 1500 單位。
//  2. 賽道幾何在 xz 平面不自我重疊。
//  3. 6.0 修正右手邊法線方向投影精度（point + normal * 5 -> lateral ≈ +5）。
//  4. groundHeight 在取樣點精確等於 height[i]。
//  5. t 參數連續性：沿賽道每 0.3 單位取樣，groundHeight 前後差 < 0.1（無跳階抖動）。
//  6. 任兩相鄰取樣點坡度 <= 0.2。
//  7. 跳台不與道具箱、固定加速板重疊（沿賽道間距 > 15 單位）。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { Track } from '../public/js/track.js';
import { CONFIG } from '../public/js/config.js';
import { ItemSystem } from '../public/js/items.js';

test('賽道總長度介於 1200 ~ 1500 單位之間', () => {
  const track = new Track();
  assert.ok(
    track.length >= 1200 && track.length <= 1500,
    `賽道長度應介於 1200~1500，實際為 ${track.length.toFixed(2)}`
  );
});

test('賽道幾何不自我重疊：沿賽道距離 > 60 的任兩取樣點，平面距離必須大於路面安全淨空', () => {
  const track = new Track();
  const minClearance = CONFIG.TRACK_WIDTH + 2 * CONFIG.SHOULDER + 4; // 16 + 8 + 4 = 28
  const N = track.N;
  const totalLength = track.length;

  const step = 6;
  for (let i = 0; i < N; i += step) {
    const pi = track.points[i];
    const distI = track.dist[i];

    for (let j = i + step; j < N; j += step) {
      const pj = track.points[j];
      const distJ = track.dist[j];

      const rawDist = Math.abs(distI - distJ);
      const trackDist = Math.min(rawDist, totalLength - rawDist);

      if (trackDist > 60) {
        const dx = pi.x - pj.x;
        const dz = pi.z - pj.z;
        const euclideanDist = Math.hypot(dx, dz);

        assert.ok(
          euclideanDist > minClearance,
          `取樣點 ${i} 與 ${j} 賽道距離為 ${trackDist.toFixed(1)} > 60，但平面距離 ${euclideanDist.toFixed(1)} <= ${minClearance}`
        );
      }
    }
  }
});

test('6.0 法線方向與 project 投影精度：point + normal * 5 回傳 lateral ≈ +5', () => {
  const track = new Track();
  const testLaterals = [-6, 0, 5, 6];

  for (let i = 0; i < track.N; i += 25) {
    const s = track.sampleAt(i);
    for (const lat of testLaterals) {
      const targetX = s.point.x + lat * s.normal.x;
      const targetZ = s.point.z + lat * s.normal.z;

      // 局部搜尋
      const hintResult = track.project(targetX, targetZ, i);
      let idxDiffHint = Math.abs(hintResult.index - i);
      if (idxDiffHint > track.N / 2) idxDiffHint = track.N - idxDiffHint;
      assert.ok(idxDiffHint <= 2, `hint 投影索引誤差過大：預期 ${i}，得到 ${hintResult.index}`);
      assert.ok(
        Math.abs(hintResult.lateral - lat) <= 0.5,
        `hint 投影 lateral 誤差過大：預期 ${lat}，得到 ${hintResult.lateral.toFixed(2)}`
      );

      // 全域搜尋
      const globalResult = track.project(targetX, targetZ);
      let idxDiffGlobal = Math.abs(globalResult.index - i);
      if (idxDiffGlobal > track.N / 2) idxDiffGlobal = track.N - idxDiffGlobal;
      assert.ok(idxDiffGlobal <= 2, `全域投影索引誤差過大：預期 ${i}，得到 ${globalResult.index}`);
      assert.ok(
        Math.abs(globalResult.lateral - lat) <= 0.5,
        `全域投影 lateral 誤差過大：預期 ${lat}，得到 ${globalResult.lateral.toFixed(2)}`
      );
    }
  }
});

test('groundHeight 在取樣點精確等於 height[i]，且任兩相鄰取樣點坡度 <= 0.2', () => {
  const track = new Track();
  for (let i = 0; i < track.N; i++) {
    const gh = track.groundHeight(i, 0);
    assert.equal(gh, track.height[i], `取樣點 ${i} 之 groundHeight(i, 0) 應等於 height[i]`);

    // 檢查坡度
    const nextI = (i + 1) % track.N;
    const dy = Math.abs(track.height[nextI] - track.height[i]);
    const dx = track.points[nextI].x - track.points[i].x;
    const dz = track.points[nextI].z - track.points[i].z;
    const distStep = Math.hypot(dx, dz);
    const slope = distStep > 0 ? dy / distStep : 0;
    assert.ok(
      slope <= 0.2,
      `取樣點 ${i} 與 ${nextI} 之間坡度過陡：${slope.toFixed(3)} > 0.2`
    );
  }
});

test('t 參數連續性：沿賽道每 0.3 單位移動一次，groundHeight(index, t) 前後差 < 0.1（無跳階抖動）', () => {
  const track = new Track();
  const N = track.N;

  let prevH = null;
  // 抽樣驗證前 300 個取樣點區間，沿賽道每 0.3 單位步進
  const checkSamples = 300;
  for (let i = 0; i < checkSamples; i++) {
    const pA = track.points[i];
    const pB = track.points[(i + 1) % N];
    const segLen = Math.hypot(pB.x - pA.x, pB.z - pA.z);
    const stepsInSeg = Math.max(1, Math.floor(segLen / 0.3));

    for (let s = 0; s < stepsInSeg; s++) {
      const t = s / stepsInSeg;
      const x = pA.x + t * (pB.x - pA.x);
      const z = pA.z + t * (pB.z - pA.z);

      const proj = track.project(x, z, i);
      const currentH = track.groundHeight(proj.index, proj.t);

      if (prevH !== null) {
        const diff = Math.abs(currentH - prevH);
        assert.ok(
          diff < 0.1,
          `groundHeight 沿賽道步進出現過大跳階：前後差 ${diff.toFixed(3)} >= 0.1 (取樣點 ${i}, t=${t.toFixed(2)})`
        );
      }
      prevH = currentH;
    }
  }
});

test('跳台不和道具箱/加速板重疊（沿賽道距離 > 15 單位）', () => {
  const track = new Track();
  const itemSystem = new ItemSystem({ track });

  assert.ok(track.jumps && track.jumps.length > 0, '賽道應至少設有 1 個跳台');

  for (const jump of track.jumps) {
    const jumpDist = track.dist[jump.index];

    // 檢查道具箱
    for (const box of itemSystem.boxes) {
      const boxDist = track.dist[box.index];
      const rawD = Math.abs(jumpDist - boxDist);
      const d = Math.min(rawD, track.length - rawD);
      assert.ok(
        d > 15,
        `跳台 (index ${jump.index}) 與道具箱 (index ${box.index}) 賽道間距 ${d.toFixed(1)} 應 > 15`
      );
    }

    // 檢查加速板
    for (const pad of itemSystem.pads) {
      const padDist = track.dist[pad.index];
      const rawD = Math.abs(jumpDist - padDist);
      const d = Math.min(rawD, track.length - rawD);
      assert.ok(
        d > 15,
        `跳台 (index ${jump.index}) 與加速板 (index ${pad.index}) 賽道間距 ${d.toFixed(1)} 應 > 15`
      );
    }
  }
});

test('startGrid 四個發車格均在路面上且位於起跑線後方', () => {
  const track = new Track();
  const halfRoadWidth = CONFIG.TRACK_WIDTH / 2; // 8

  for (let slot = 0; slot < 4; slot++) {
    const grid = track.startGrid(slot);

    assert.ok(
      Math.abs(grid.lateral) < halfRoadWidth,
      `發車格 ${slot} 側向距離 ${grid.lateral} 應在路面內 (< ${halfRoadWidth})`
    );

    const progress = grid.index - track.N;
    assert.ok(
      progress < 0,
      `發車格 ${slot} 進度應為負數（在起點後方），實際為 ${progress}`
    );
  }
});

test('所有取樣點 height 均大於等於 0（無負值高度）', () => {
  const track = new Track();
  assert.ok(
    track.height.every((h) => h >= 0),
    '賽道所有取樣點高度必須大於等於 0'
  );
});

test('路面、路肩、草地帶、裙邊網格的所有三角形面法線 y > 0（頂點繞向正確向上）', () => {
  const track = new Track();
  const fakeScene = { add() {}, remove() {} };
  track.buildMeshes(fakeScene, null);

  const targets = [
    { name: '路面', mesh: track.meshesGroup.getObjectByName('roadMesh') },
    { name: '路肩', mesh: track.meshesGroup.getObjectByName('curbMesh') },
    { name: '草地帶', mesh: track.meshesGroup.getObjectByName('shoulderMesh') },
    { name: '裙邊', mesh: track.meshesGroup.getObjectByName('skirtMesh') },
  ];

  for (const { name, mesh } of targets) {
    assert.ok(mesh, `應找到 ${name} 網格`);
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position');
    const index = geo.getIndex();
    assert.ok(pos && index, `${name} 幾何體應具備 position 與 index`);

    for (let i = 0; i < index.count; i += 3) {
      const iA = index.getX(i);
      const iB = index.getX(i + 1);
      const iC = index.getX(i + 2);

      const ax = pos.getX(iA), ay = pos.getY(iA), az = pos.getZ(iA);
      const bx = pos.getX(iB), by = pos.getY(iB), bz = pos.getZ(iB);
      const cx = pos.getX(iC), cy = pos.getY(iC), cz = pos.getZ(iC);

      const abx = bx - ax, aby = by - ay, abz = bz - az;
      const acx = cx - ax, acy = cy - ay, acz = cz - az;

      const ny = abz * acx - abx * acz;
      assert.ok(
        ny > 0,
        `${name} 第 ${i / 3} 個三角形面法線 y 應 > 0（實際為 ${ny}），頂點繞向相反被剔除`
      );
    }
  }
});

