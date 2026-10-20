// ============================================================
//  car.test.js — 車輛限速、貼牆防卡死、雙車重疊互推與 AI 圈速回歸測試
//  驗證第 1 輪修復問題：
//  1. 油門直線開限速封頂保護（MAX_SPEED 與 BOOST_SPEED）。
//  2. 貼牆行駛不黏牆停死（速度保持 > 10）。
//  3. 雙車重疊起步互推不卡死（前進 > 30 單位）。
//  4. 只有 AI 的比賽在 seeds 1, 2, 7 每一圈單圈時間均 < 45 秒。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../public/js/game.js';
import { Track } from '../public/js/track.js';
import { Car } from '../public/js/car.js';
import { CONFIG } from '../public/js/config.js';
import { mulberry32 } from '../public/js/utils.js';

test('直線持續全油門開 5 秒限速保護：speed <= MAX_SPEED；加速期間 <= BOOST_SPEED', () => {
  const track = new Track();
  const car = new Car({ slot: 0, track });
  const dt = 1 / 60;

  // 在直道全油門行駛 5 秒（300 步）
  for (let i = 0; i < 300; i++) {
    car.update(dt, { steer: 0, throttle: 1, brake: 0 }, track);
    assert.ok(
      car.speed <= CONFIG.MAX_SPEED + 0.01,
      `車速應 <= ${CONFIG.MAX_SPEED}，實際為 ${car.speed.toFixed(2)}`
    );
  }
  assert.ok(
    car.speed >= CONFIG.MAX_SPEED - 0.1,
    `車速應能達到接近最高速，實際為 ${car.speed.toFixed(2)}`
  );

  // 啟用氮氣加速 3 秒
  car.applyBoost(3.0);
  for (let i = 0; i < 120; i++) {
    car.update(dt, { steer: 0, throttle: 1, brake: 0 }, track);
    assert.ok(
      car.speed <= CONFIG.BOOST_SPEED + 0.01,
      `加速時車速應 <= ${CONFIG.BOOST_SPEED}，實際為 ${car.speed.toFixed(2)}`
    );
  }
  assert.ok(
    car.speed > CONFIG.MAX_SPEED,
    `加速時車速應能超越原本最高速，實際為 ${car.speed.toFixed(2)}`
  );
});

test('以 30 速度貼牆行駛 2 秒不會黏牆停住：速度仍 > 10', () => {
  const track = new Track();
  const car = new Car({ slot: 0, track });
  car.speed = 30;

  // 將車輛放置於外側邊界貼牆處，朝向稍微朝外側傾斜
  const maxLat = track.width / 2 + track.shoulder - CONFIG.CAR_RADIUS;
  car.lateral = maxLat;
  const pos = track.pointAtLateral(car.trackIndex, car.lateral);
  car.x = pos.x;
  car.z = pos.z;

  const tangent = track.sampleAt(car.trackIndex).tangent;
  const trackHeading = Math.atan2(tangent.x, tangent.z);
  // 朝向略微朝向外牆（+0.15 弧度）
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
  // 渡過 countdown
  for (let i = 0; i < 185; i++) game.step(1 / 60);
  assert.equal(game.state, 'racing');

  const carA = game.racers.find((r) => r.id === p1.id).car;
  const carB = game.racers.find((r) => r.id === p2.id).car;

  // 強制將兩車重疊放置在同一座標
  carB.x = carA.x;
  carB.z = carA.z;
  carB.heading = carA.heading;
  carB.speed = carA.speed;

  const initProgressA = carA.progress;
  const initProgressB = carB.progress;

  // 全油門跑 2 秒（120 步）
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

test('只有 AI 的比賽（seeds 1, 2, 7）：每台 AI 每一圈單圈時間均 < 45 秒', () => {
  const testSeeds = [1, 2, 7];

  for (const seed of testSeeds) {
    const game = new Game({ headless: true, rng: mulberry32(seed) });
    game.startRace();

    const dt = 1 / 60;
    let time = 0;
    while (game.state !== 'results' && time < 400) {
      game.step(dt);
      time += dt;
    }

    assert.equal(game.state, 'results', `seed ${seed} 應順利在時限內完賽`);
    assert.equal(game.racers.length, 4);

    for (const racer of game.racers) {
      assert.equal(
        racer.car.lapTimes.length,
        CONFIG.LAPS,
        `seed ${seed} 玩家 ${racer.name} 應有 ${CONFIG.LAPS} 筆單圈成績`
      );
      for (let lap = 0; lap < racer.car.lapTimes.length; lap++) {
        const lapTime = racer.car.lapTimes[lap];
        assert.ok(
          lapTime < 45,
          `seed ${seed} 玩家 ${racer.name} 第 ${lap + 1} 圈單圈時間應 < 45 秒，實際為 ${lapTime.toFixed(2)}`
        );
      }
    }
  }
});
