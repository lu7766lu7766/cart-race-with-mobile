// ============================================================
//  track.test.js — 賽道幾何與投影演算法單元測試
//  測試賽道總長、幾何不自我重疊、project 投影精確度與發車格位。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { Track } from '../public/js/track.js';
import { CONFIG } from '../public/js/config.js';

test('賽道總長度介於 800 ~ 1000 單位之間', () => {
  const track = new Track();
  assert.ok(
    track.length >= 800 && track.length <= 1000,
    `賽道長度應介於 800~1000，實際為 ${track.length.toFixed(2)}`
  );
});

test('賽道幾何不自我重疊：沿賽道距離 > 60 的任兩取樣點，平面距離必須大於路面安全淨空', () => {
  const track = new Track();
  const minClearance = CONFIG.TRACK_WIDTH + 2 * CONFIG.SHOULDER + 4; // 16 + 8 + 4 = 28
  const N = track.N;
  const totalLength = track.length;

  // 抽樣檢查取樣點之間的賽道距離與歐幾里得距離
  const step = 4; // 間隔取樣以加速測試
  for (let i = 0; i < N; i += step) {
    const pi = track.points[i];
    const distI = track.dist[i];

    for (let j = i + step; j < N; j += step) {
      const pj = track.points[j];
      const distJ = track.dist[j];

      // 計算沿著封閉迴圈的最短賽道距離
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

test('project 投影演算法能以 hint 與全域搜尋精準找回 index 與 lateral', () => {
  const track = new Track();
  const testLaterals = [-6, 0, 6];

  // 每 20 個取樣點驗證一次
  for (let i = 0; i < track.N; i += 20) {
    for (const lat of testLaterals) {
      const targetPos = track.pointAtLateral(i, lat);

      // 1. 使用 hintIndex 進行局部搜尋
      const hintResult = track.project(targetPos.x, targetPos.z, i);
      let idxDiffHint = Math.abs(hintResult.index - i);
      if (idxDiffHint > track.N / 2) idxDiffHint = track.N - idxDiffHint;
      assert.ok(idxDiffHint <= 2, `hint 投影索引誤差過大：預期 ${i}，得到 ${hintResult.index}`);
      assert.ok(
        Math.abs(hintResult.lateral - lat) <= 0.5,
        `hint 投影 lateral 誤差過大：預期 ${lat}，得到 ${hintResult.lateral.toFixed(2)}`
      );

      // 2. 不帶 hint 進行全域搜尋
      const globalResult = track.project(targetPos.x, targetPos.z);
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

test('startGrid 四個發車格均在路面上且位於起跑線後方', () => {
  const track = new Track();
  const halfRoadWidth = CONFIG.TRACK_WIDTH / 2; // 8

  for (let slot = 0; slot < 4; slot++) {
    const grid = track.startGrid(slot);

    // 發車格位必須在路面範圍內
    assert.ok(
      Math.abs(grid.lateral) < halfRoadWidth,
      `發車格 ${slot} 側向距離 ${grid.lateral} 應在路面內 (< ${halfRoadWidth})`
    );

    // 發車格位索引應在起點線 0 後方（靠近 N-1 側）
    // 且進度 progress = index - N 應小於 0
    const progress = grid.index - track.N;
    assert.ok(
      progress < 0,
      `發車格 ${slot} 進度應為負數（在起點後方），實際為 ${progress}`
    );
  }
});
