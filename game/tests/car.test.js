// ============================================================
//  car.test.js — 車輛基礎物理、轉向左右方向、被動能力與起跑衝刺測試
//  涵蓋：
//  1. 直線全油門限速封頂保護（重置在直道中心線對齊切線）。
//  2. 6.0 左右方向定義（steer=+1 往右轉，位移與 initial right 內積 > 0）。
//  3. 6.6 角色能力（Slot 1 極速 > Slot 0，Slot 0 起步加速度 > Slot 1）。
//  4. 6.3 起跑衝刺判定（固定油門無衝刺、最後1秒按下獲得衝刺、太早按搶跑空轉懲罰）。
//  5. 貼牆行駛不黏死與雙車重疊互推。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../public/js/game.js';
import { Track } from '../public/js/track.js';
import { Car } from '../public/js/car.js';
import { CONFIG } from '../public/js/config.js';
import { mulberry32 } from '../public/js/utils.js';

test('直線持續全油門開 5 秒限速保護：每步重置在直道中心線對齊切線，speed <= MAX_SPEED；加速期間 <= BOOST_SPEED', () => {
  const track = new Track();
  const car = new Car({ slot: 0, track });
  const dt = 1 / 60;
  const s0 = track.sampleAt(0);

  // 6.8: 每一步都把車子放回直道中心線並把車頭對齊切線（只測速度上限，不測路線）
  for (let i = 0; i < 300; i++) {
    car.trackIndex = 0;
    car.lateral = 0;
    car.x = s0.point.x;
    car.z = s0.point.z;
    car.y = s0.height;
    car.heading = Math.atan2(s0.tangent.x, s0.tangent.z);
    car.update(dt, { steer: 0, throttle: 1, brake: 0 }, track);

    const maxAllowed = CONFIG.MAX_SPEED * car.stats.maxSpeedMult;
    assert.ok(
      car.speed <= maxAllowed + 0.01,
      `車速應 <= ${maxAllowed}，實際為 ${car.speed.toFixed(2)}`
    );
  }
  assert.ok(
    car.speed >= (CONFIG.MAX_SPEED * car.stats.maxSpeedMult) - 0.2,
    `車速應能達到接近最高速，實際為 ${car.speed.toFixed(2)}`
  );

  // 啟用氮氣加速
  car.applyBoost(3.0);
  for (let i = 0; i < 120; i++) {
    car.trackIndex = 0;
    car.lateral = 0;
    car.x = s0.point.x;
    car.z = s0.point.z;
    car.y = s0.height;
    car.heading = Math.atan2(s0.tangent.x, s0.tangent.z);
    car.update(dt, { steer: 0, throttle: 1, brake: 0 }, track);

    const boostAllowed = CONFIG.BOOST_SPEED * car.stats.boostSpeedMult;
    assert.ok(
      car.speed <= boostAllowed + 0.01,
      `加速時車速應 <= ${boostAllowed}，實際為 ${car.speed.toFixed(2)}`
    );
  }
  assert.ok(
    car.speed > (CONFIG.MAX_SPEED * car.stats.maxSpeedMult),
    `加速時車速應能超越平時最高速，實際為 ${car.speed.toFixed(2)}`
  );
});

test('6.0 左右方向定義：在直道上 steer=+1 開 0.5 秒，位移與 right(初始 heading) 的內積 > 0', () => {
  const track = new Track();
  const car = new Car({ slot: 0, track });
  const dt = 1 / 60;
  const s0 = track.sampleAt(0);

  // 初始放置於起點直道，速度設為 25
  car.x = s0.point.x;
  car.z = s0.point.z;
  car.y = s0.height;
  car.heading = Math.atan2(s0.tangent.x, s0.tangent.z);
  car.speed = 25;

  const startX = car.x;
  const startZ = car.z;
  // 6.0: 車頭為 (sin h, cos h)，右手邊向量 right = (-cos h, sin h)
  const initialRightX = -Math.cos(car.heading);
  const initialRightZ = Math.sin(car.heading);

  // steer = +1 往右行駛 0.5 秒（30 步）
  for (let i = 0; i < 30; i++) {
    car.update(dt, { steer: 1.0, throttle: 1, brake: 0 }, track);
  }

  const dispX = car.x - startX;
  const dispZ = car.z - startZ;
  const dotRight = dispX * initialRightX + dispZ * initialRightZ;

  assert.ok(
    dotRight > 0,
    `steer=+1 往右轉，位移與初始 right 向量內積應 > 0，實際為 ${dotRight.toFixed(3)}`
  );
});

test('6.6 角色被動能力：直道全油門 6 秒後 slot 1 (極速王) 速度 > slot 0；開跑 1 秒後 slot 0 (衝刺手) 速度 > slot 1', () => {
  const track = new Track();
  const car0 = new Car({ slot: 0, track }); // 衝刺手：accel x 1.25
  const car1 = new Car({ slot: 1, track }); // 極速王：maxSpeed x 1.05, accel x 0.9
  const dt = 1 / 60;
  const s0 = track.sampleAt(0);
  const trackHeading0 = Math.atan2(s0.tangent.x, s0.tangent.z);

  // 1 秒加速測試（60 步）
  for (let i = 0; i < 60; i++) {
    // 保持在直道上
    car0.trackIndex = 0; car0.lateral = 0;
    car1.trackIndex = 0; car1.lateral = 0;
    car0.x = s0.point.x; car0.z = s0.point.z; car0.heading = trackHeading0;
    car1.x = s0.point.x; car1.z = s0.point.z; car1.heading = trackHeading0;
    car0.update(dt, { steer: 0, throttle: 1, brake: 0 }, track);
    car1.update(dt, { steer: 0, throttle: 1, brake: 0 }, track);
  }

  assert.ok(
    car0.speed > car1.speed,
    `開跑 1 秒後 slot 0 速度 (${car0.speed.toFixed(2)}) 應高於 slot 1 (${car1.speed.toFixed(2)})`
  );

  // 繼續跑至 6 秒（共 360 步）
  for (let i = 60; i < 360; i++) {
    car0.trackIndex = 0; car0.lateral = 0;
    car1.trackIndex = 0; car1.lateral = 0;
    car0.x = s0.point.x; car0.z = s0.point.z; car0.heading = trackHeading0;
    car1.x = s0.point.x; car1.z = s0.point.z; car1.heading = trackHeading0;
    car0.update(dt, { steer: 0, throttle: 1, brake: 0 }, track);
    car1.update(dt, { steer: 0, throttle: 1, brake: 0 }, track);
  }

  assert.ok(
    car1.speed > car0.speed,
    `極速巡航 6 秒後 slot 1 速度 (${car1.speed.toFixed(2)}) 應高於 slot 0 (${car0.speed.toFixed(2)})`
  );
});

test('6.3 起跑衝刺測試：固定油門無衝刺無懲罰；倒數 1 之後按下獲衝刺；太早按下空轉懲罰', () => {
  // 1. countdown 開始前就一直按著 throttle:1（固定輸入）：無空轉也無衝刺
  const game1 = new Game({ headless: true, rng: mulberry32(10) });
  const p1 = game1.addPlayer({
    name: '老手',
    kind: 'remote',
    input: { getState: () => ({ steer: 0, throttle: 1, brake: 0, useItem: false }) },
  });
  game1.startRace();
  // 推進至 GO 那一步（3 秒 = 180 步）
  for (let i = 0; i < 185; i++) game1.step(1 / 60);
  assert.equal(game1.state, 'racing');
  const racer1 = game1.racers.find((r) => r.id === p1.id);
  assert.equal(racer1.car.boostTimer, 0, '固定按住油門不應獲得起跑衝刺');
  assert.equal(racer1.car.spinOutTimer, 0, '固定按住油門不應受到空轉懲罰');

  // 2. 倒數顯示 1 之後（countdownTimer >= 2.0）才按下並持續按住：獲得起跑衝刺
  const game2 = new Game({ headless: true, rng: mulberry32(20) });
  let pressed = false;
  const p2 = game2.addPlayer({
    name: '時機高手',
    kind: 'remote',
    input: { getState: () => ({ steer: 0, throttle: pressed ? 1 : 0, brake: 0, useItem: false }) },
  });
  game2.startRace();
  // 模擬至 2.2 秒（顯示 1 時）
  for (let i = 0; i < 132; i++) game2.step(1 / 60);
  pressed = true; // 此時按下
  // 跑完剩餘倒數進入 racing
  for (let i = 132; i < 185; i++) game2.step(1 / 60);
  assert.equal(game2.state, 'racing');
  const racer2 = game2.racers.find((r) => r.id === p2.id);
  assert.ok(racer2.car.boostTimer > 0, '最後 1 秒按下應成功獲得起跑衝刺');

  // 3. 在 3 時按下（太早搶跑）並一直按住：GO 時受到 0.5 秒空轉懲罰
  const game3 = new Game({ headless: true, rng: mulberry32(30) });
  let p3Throttle = 0;
  const p3 = game3.addPlayer({
    name: '心急玩家',
    kind: 'remote',
    input: { getState: () => ({ steer: 0, throttle: p3Throttle, brake: 0, useItem: false }) },
  });
  game3.startRace();
  // 在 0.3 秒時按下
  for (let i = 0; i < 18; i++) game3.step(1 / 60);
  p3Throttle = 1;
  for (let i = 18; i < 185; i++) game3.step(1 / 60);
  assert.equal(game3.state, 'racing');
  const racer3 = game3.racers.find((r) => r.id === p3.id);
  assert.ok(racer3.car.spinOutTimer > 0, '太早搶跑應觸發空轉計時器');
  assert.equal(racer3.car.speed, 0, '空轉期間速度應為 0');
});

test('以 30 速度貼牆行駛 2 秒不會黏牆停住：速度仍 > 10', () => {
  const track = new Track();
  const car = new Car({ slot: 0, track });
  car.speed = 30;

  const maxLat = track.width / 2 + track.shoulder - CONFIG.CAR_RADIUS;
  car.lateral = maxLat;
  const pos = track.pointAtLateral(car.trackIndex, car.lateral);
  car.x = pos.x;
  car.z = pos.z;

  const s = track.sampleAt(car.trackIndex);
  const trackHeading = Math.atan2(s.tangent.x, s.tangent.z);
  car.heading = trackHeading + 0.15;

  const dt = 1 / 60;
  for (let i = 0; i < 120; i++) {
    car.update(dt, { steer: 0, throttle: 1, brake: 0 }, track);
  }

  assert.ok(
    car.speed > 10,
    `貼牆行駛 2 秒後速度應仍 > 10，實際為 ${car.speed.toFixed(2)}`
  );
});

test('兩台車重疊放置並全油門前進 2 秒不會卡死：兩台均前進 > 30 單位', () => {
  const game = new Game({ headless: true, rng: mulberry32(1) });
  const p1 = game.addPlayer({
    name: '車A',
    kind: 'remote',
    input: { getState: () => ({ steer: 0, throttle: 1, brake: 0, useItem: false }) },
  });
  const p2 = game.addPlayer({
    name: '車B',
    kind: 'remote',
    input: { getState: () => ({ steer: 0, throttle: 1, brake: 0, useItem: false }) },
  });

  game.startRace();
  for (let i = 0; i < 185; i++) game.step(1 / 60);
  assert.equal(game.state, 'racing');

  const carA = game.racers.find((r) => r.id === p1.id).car;
  const carB = game.racers.find((r) => r.id === p2.id).car;

  carB.x = carA.x;
  carB.z = carA.z;
  carB.heading = carA.heading;
  carB.speed = carA.speed;

  const initProgressA = carA.progress;
  const initProgressB = carB.progress;

  for (let i = 0; i < 120; i++) {
    game.step(1 / 60);
  }

  const deltaProgressA = carA.progress - initProgressA;
  const deltaProgressB = carB.progress - initProgressB;

  assert.ok(
    deltaProgressA > 30,
    `車A 應前進 > 30 單位，實際前進 ${deltaProgressA.toFixed(1)}`
  );
  assert.ok(
    deltaProgressB > 30,
    `車B 應前進 > 30 單位，實際前進 ${deltaProgressB.toFixed(1)}`
  );
});
