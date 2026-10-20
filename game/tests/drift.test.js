// ============================================================
//  drift.test.js — 甩尾判定、集氣等級、迷你加速釋放與角速度測試
//  涵蓋：
//  1. 按住甩尾+轉向 2.0 秒後放開獲得橘色加速（boostTimer ≈ 1.0）與 miniTurbo 事件。
//  2. 甩尾 0.5 秒未達門檻放開無加速。
//  3. 甩尾中離地（grounded=false）中斷甩尾。
//  4. 甩尾中開上草地不中斷甩尾。
//  5. slot 2 (甩尾高手) 達到 DRIFT_T3 時間比 slot 0 短。
//  6. throttle=1, brake=1 且無 drift 欄位視為甩尾。
//  7. 甩尾中往外打時角速度 = 0.2 * TURN_RATE。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { Track } from '../public/js/track.js';
import { Car } from '../public/js/car.js';
import { CONFIG } from '../public/js/config.js';

test('按住甩尾＋steer=+1 行駛 2.0 秒後放開：boostTimer ≈ 1.0 (橘) 並收到 miniTurbo {level:2}；0.5 秒放開無加速', () => {
  const track = new Track();
  const events = [];
  const car = new Car({
    slot: 0,
    track,
    onEvent: (name, data) => events.push({ name, data }),
  });
  const dt = 1 / 60;
  const s0 = track.sampleAt(0);

  // 1. 甩尾 2.0 秒（120 步）
  for (let i = 0; i < 120; i++) {
    car.x = s0.point.x;
    car.z = s0.point.z;
    car.y = s0.height;
    car.heading = Math.atan2(s0.tangent.x, s0.tangent.z);
    car.speed = 30; // 維持車速 30
    car.update(dt, { steer: 1.0, throttle: 1, brake: 0, drift: true }, track);
  }

  assert.ok(car.isDrifting, '車輛應處於甩尾中');
  assert.equal(car.driftLevel, 2, '2 秒集氣應達到 Level 2 (橘色)');

  // 放開甩尾（drift: false）
  car.update(dt, { steer: 0, throttle: 1, brake: 0, drift: false }, track);
  assert.equal(car.isDrifting, false, '放開後應結束甩尾');
  assert.ok(
    Math.abs(car.boostTimer - CONFIG.DRIFT_BOOST_T2) < 0.1,
    `boostTimer 應接近 ${CONFIG.DRIFT_BOOST_T2}，實際為 ${car.boostTimer.toFixed(2)}`
  );

  const turboEvt = events.find((e) => e.name === 'miniTurbo');
  assert.ok(turboEvt, '應觸發 miniTurbo 事件');
  assert.equal(turboEvt.data.level, 2, 'miniTurbo 事件 level 應為 2');

  // 2. 甩尾 0.5 秒（30 步，未達 0.8 秒門檻）放開無加速
  car.boostTimer = 0;
  events.length = 0;
  for (let i = 0; i < 30; i++) {
    car.x = s0.point.x;
    car.z = s0.point.z;
    car.y = s0.height;
    car.heading = Math.atan2(s0.tangent.x, s0.tangent.z);
    car.speed = 30;
    car.update(dt, { steer: 1.0, throttle: 1, brake: 0, drift: true }, track);
  }
  assert.equal(car.driftLevel, 0, '0.5 秒集氣未達藍色等級 (Level 0)');
  car.update(dt, { steer: 0, throttle: 1, brake: 0, drift: false }, track);
  assert.equal(car.boostTimer, 0, '未達門檻放開不給予加速');
  assert.equal(events.filter((e) => e.name === 'miniTurbo').length, 0);
});

test('甩尾中斷與草地持續性：離地 (grounded=false) 中斷甩尾；開上草地不中斷甩尾', () => {
  const track = new Track();
  const car = new Car({ slot: 0, track });
  const dt = 1 / 60;
  const s0 = track.sampleAt(0);
  const trackHeading0 = Math.atan2(s0.tangent.x, s0.tangent.z);

  // 進入甩尾
  for (let i = 0; i < 30; i++) {
    car.trackIndex = 0;
    car.x = s0.point.x; car.z = s0.point.z; car.y = s0.height;
    car.heading = trackHeading0; car.speed = 30;
    car.update(dt, { steer: 1.0, throttle: 1, brake: 0, drift: true }, track);
  }
  assert.ok(car.isDrifting);

  // 設為離地
  car.grounded = false;
  car.y = s0.height + 2.0;
  car.update(dt, { steer: 1.0, throttle: 1, brake: 0, drift: true }, track);
  assert.equal(car.isDrifting, false, '離地應中斷甩尾');
  assert.equal(car.driftCharge, 0, '中斷甩尾後 driftCharge 應歸零');

  // 重新進入甩尾並行駛在草地上
  car.grounded = true;
  for (let i = 0; i < 30; i++) {
    car.trackIndex = 0;
    car.x = s0.point.x; car.z = s0.point.z; car.y = s0.height;
    car.heading = trackHeading0; car.speed = 30;
    car.update(dt, { steer: 1.0, throttle: 1, brake: 0, drift: true }, track);
  }
  assert.ok(car.isDrifting);

  // 依主持人指示：放在 lateral = 半路寬 + 1，heading 對齊切線，並且只測一步
  car.trackIndex = 0;
  car.lateral = (track.width / 2) + 1.0;
  const grassPos = track.pointAtLateral(car.trackIndex, car.lateral);
  car.x = grassPos.x;
  car.z = grassPos.z;
  car.heading = trackHeading0;
  car.speed = 30;
  car.update(dt, { steer: 0, throttle: 1, brake: 0, drift: true }, track);

  assert.ok(car.isDrifting, '在草地上行駛甩尾不應被中斷');
});

test('角色能力差異：slot 2 (甩尾高手) 達到 DRIFT_T3 所需時間比 slot 0 短', () => {
  const track = new Track();
  const car0 = new Car({ slot: 0, track });
  const car2 = new Car({ slot: 2, track });
  const dt = 1 / 60;
  const s0 = track.sampleAt(0);

  let steps0 = 0;
  let steps2 = 0;
  const trackHeading0 = Math.atan2(s0.tangent.x, s0.tangent.z);

  // slot 2
  while (car2.driftLevel < 3 && steps2 < 600) {
    car2.trackIndex = 0; car2.lateral = 0;
    car2.x = s0.point.x; car2.z = s0.point.z; car2.y = s0.height; car2.speed = 30;
    car2.heading = trackHeading0;
    car2.update(dt, { steer: 1.0, throttle: 1, brake: 0, drift: true }, track);
    steps2++;
  }

  // slot 0
  while (car0.driftLevel < 3 && steps0 < 600) {
    car0.trackIndex = 0; car0.lateral = 0;
    car0.x = s0.point.x; car0.z = s0.point.z; car0.y = s0.height; car0.speed = 30;
    car0.heading = trackHeading0;
    car0.update(dt, { steer: 1.0, throttle: 1, brake: 0, drift: true }, track);
    steps0++;
  }

  assert.equal(car2.driftLevel, 3);
  assert.equal(car0.driftLevel, 3);
  assert.ok(
    steps2 < steps0,
    `slot 2 達到 Level 3 步數 (${steps2}) 應少於 slot 0 (${steps0})`
  );
});

test('向下相容：throttle=1 且 brake=1 在無 drift 欄位時自動視為按住甩尾', () => {
  const track = new Track();
  const car = new Car({ slot: 0, track });
  const dt = 1 / 60;
  const s0 = track.sampleAt(0);
  const trackHeading0 = Math.atan2(s0.tangent.x, s0.tangent.z);

  for (let i = 0; i < 40; i++) {
    car.trackIndex = 0; car.lateral = 0;
    car.x = s0.point.x; car.z = s0.point.z; car.y = s0.height; car.heading = trackHeading0; car.speed = 30;
    // 不傳 drift 欄位，同時按油門與煞車
    car.update(dt, { steer: 1.0, throttle: 1.0, brake: 1.0 }, track);
  }

  assert.ok(car.isDrifting, 'throttle=1 與 brake=1 應自動觸發甩尾');
});

test('單元斷言：甩尾中往外打 (into = -1) 時角速度 = 0.2 * TURN_RATE', () => {
  const track = new Track();
  const car = new Car({ slot: 0, track });
  const dt = 1 / 60;
  const s0 = track.sampleAt(0);
  const trackHeading0 = Math.atan2(s0.tangent.x, s0.tangent.z);

  // 進入向右甩尾（driftDir = +1）
  car.trackIndex = 0; car.lateral = 0;
  car.x = s0.point.x; car.z = s0.point.z; car.y = s0.height; car.heading = trackHeading0; car.speed = 30;
  car.update(dt, { steer: 1.0, throttle: 1, brake: 0, drift: true }, track);
  assert.ok(car.isDrifting);
  assert.equal(car.driftDir, 1);

  // 此時往反方向（外側 steer = -1.0）打方向盤
  // into = steer * driftDir = -1 * 1 = -1
  // turnMultiplier = 0.6 + 0.4 * (-1) = 0.2
  // 角速度 = CONFIG.TURN_RATE * 0.2
  const headingBefore = car.heading;
  car.update(dt, { steer: -1.0, throttle: 1, brake: 0, drift: true }, track);
  const headingDelta = Math.abs(car.heading - headingBefore);

  const speedRatio = 1.0; // speed 30 > 8
  const expectedDelta = CONFIG.TURN_RATE * 0.2 * speedRatio * dt;

  assert.ok(
    Math.abs(headingDelta - expectedDelta) < 1e-4,
    `往外打時角速度變化應為 ${expectedDelta}，實際為 ${headingDelta}`
  );
});
