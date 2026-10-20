// ============================================================
//  jump.test.js — 跳台起飛、滯空物理、落地衝刺與高低差避讓測試
//  涵蓋：
//  1. 速度 35 在路面中心通過跳台，0.2 秒內起飛離地（grounded === false 且 y > groundHeight + 1）。
//  2. 滯空後重力作用著地，若空中時間 > 0.4 秒著地獲得 boostTimer > 0。
//  3. 倒車經過跳台不觸發起飛。
//  4. 車身與香蕉高度差 > 2.5 單位時不判定碰撞（跳躍避開香蕉技巧）。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { Track } from '../public/js/track.js';
import { Car } from '../public/js/car.js';
import { ItemSystem } from '../public/js/items.js';

test('速度 35 通過跳台起飛離地、著地落地衝刺，倒車通過不觸發跳躍', () => {
  const track = new Track();
  assert.ok(track.jumps && track.jumps.length > 0);
  const jump = track.jumps[0];
  const jumpIndex = jump.index;

  const car = new Car({ slot: 0, track });
  const dt = 1 / 60;

  // 1. 正向通過跳台：將車輛放置於跳台前 2 個取樣點，速度 35
  const startIdx = (jumpIndex - 2 + track.N) % track.N;
  const sStart = track.sampleAt(startIdx);
  car.trackIndex = startIdx;
  car.x = sStart.point.x;
  car.z = sStart.point.z;
  car.y = sStart.height;
  car.lateral = 0; // 路面正中心
  car.heading = Math.atan2(sStart.tangent.x, sStart.tangent.z);
  car.speed = 35;
  car.grounded = true;

  // 行駛 0.2 秒（12 步）
  let tookOff = false;
  for (let i = 0; i < 12; i++) {
    car.update(dt, { steer: 0, throttle: 1, brake: 0 }, track);
    const gh = track.groundHeight(car.trackIndex, 0);
    if (!car.grounded && car.y > gh + 1.0) {
      tookOff = true;
      break;
    }
  }

  assert.ok(tookOff, '車輛通過跳台後 0.2 秒內應起飛離地且 y > groundHeight + 1');

  // 繼續模擬直到落地（最多 2 秒 = 120 步）
  let landed = false;
  for (let i = 0; i < 120; i++) {
    car.update(dt, { steer: 0, throttle: 1, brake: 0 }, track);
    if (car.grounded) {
      landed = true;
      break;
    }
  }

  assert.ok(landed, '跳躍後車輛應受重力牽引著地');
  assert.ok(car.boostTimer > 0, '滯空超過 0.4 秒著地應獲得落地加速');

  // 2. 倒車經過跳台：不觸發起飛
  const reverseStartIdx = (jumpIndex + 2) % track.N;
  const sRev = track.sampleAt(reverseStartIdx);
  car.trackIndex = reverseStartIdx;
  car.x = sRev.point.x;
  car.z = sRev.point.z;
  car.y = sRev.height;
  car.lateral = 0;
  car.heading = Math.atan2(sRev.tangent.x, sRev.tangent.z);
  car.speed = -10; // 倒車
  car.grounded = true;
  car.boostTimer = 0;

  for (let i = 0; i < 30; i++) {
    car.update(dt, { steer: 0, throttle: 0, brake: 1 }, track);
    assert.equal(car.grounded, true, '倒車穿過跳台不應觸發起飛');
  }
});

test('高度差 > 2.5 時香蕉不會判定命中（跳躍避讓香蕉）', () => {
  const track = new Track();
  const itemSystem = new ItemSystem({ track });
  const car = new Car({ slot: 0, track });
  const racer = { id: 'p1', car };

  const s0 = track.sampleAt(0);
  car.x = s0.point.x;
  car.z = s0.point.z;
  car.y = s0.height + 3.0; // 在空中高度比路面高 3.0 單位 (> 2.5)
  car.grounded = false;

  // 在路面上放置一顆香蕉皮
  itemSystem.bananas.push({
    id: 999,
    x: s0.point.x,
    y: s0.height,
    z: s0.point.z,
    radius: 1.8,
    ownerPlayerId: 'p2',
    ownerImmunityTimer: 0,
  });

  itemSystem.update(1 / 60, [racer]);

  // 香蕉應依然存在，且車輛未打滑
  assert.equal(itemSystem.bananas.length, 1, '高度差 > 2.5 不應碰撞香蕉');
  assert.equal(car.spinTimer, 0, '車輛在空中越過香蕉不應打滑');
});
