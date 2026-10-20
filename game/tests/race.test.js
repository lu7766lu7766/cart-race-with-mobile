// ============================================================
//  race.test.js — 核心遊戲模擬與比賽流程單元測試
//  測試無頭模式下的完整 AI 比賽流程、圈數判定（防倒開刷圈）、
//  玩家加入/退出 API、錯誤輸入保護與狀態機轉換。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../public/js/game.js';
import { CONFIG } from '../public/js/config.js';
import { mulberry32 } from '../public/js/utils.js';
import { AIInput } from '../public/js/ai.js';

test('只有 AI 的完整比賽流程：4 台 AI 跑滿 3 圈並依序完賽結算', () => {
  const game = new Game({ headless: true, rng: mulberry32(1) });
  const finishedEvents = [];

  game.on('playerFinished', (data) => {
    finishedEvents.push(data);
  });

  game.startRace();
  assert.equal(game.state, 'countdown');
  assert.equal(game.racers.length, 4);

  // 模擬比賽推進（每步 1/60 秒，最多模擬 400 秒 = 24000 步）
  const dt = 1 / 60;
  let simulatedTime = 0;
  const maxTime = 400;

  let reachedRacing = false;

  while (simulatedTime < maxTime) {
    game.step(dt);
    simulatedTime += dt;

    if (game.state === 'racing') {
      reachedRacing = true;
    }

    if (game.state === 'results') {
      break;
    }
  }

  assert.ok(reachedRacing, '狀態機應順利進入 racing 狀態');
  assert.equal(game.state, 'results', '比賽應於時間內完賽並進入 results 結算狀態');
  assert.equal(finishedEvents.length, 4, '4 台 AI 都應觸發 playerFinished 事件');

  const ranks = finishedEvents.map((e) => e.rank);
  ranks.sort((a, b) => a - b);
  assert.deepEqual(ranks, [1, 2, 3, 4], '完賽名次應為 1 到 4 且不重複');

  for (const racer of game.racers) {
    assert.equal(racer.car.lapTimes.length, CONFIG.LAPS, '每台完賽車應有 3 筆單圈成績');
    for (const lapTime of racer.car.lapTimes) {
      assert.ok(lapTime > 5.0, `單圈時間應大於 5 秒，實際為 ${lapTime}`);
    }
  }
});

test('防倒開刷圈：沿賽道倒車一整圈 lap 不增加，在起點線前後來回最多觸發 1 次 lapChanged', () => {
  const game = new Game({ headless: true, rng: mulberry32(42) });
  game.startRace();

  // 跳過 countdown 進入 racing
  for (let i = 0; i < 190; i++) game.step(1 / 60);
  assert.equal(game.state, 'racing');

  const car = game.racers[0].car;
  const initialLap = car.lap; // 應為 1

  // 將車輛沿賽道反向大幅移動（模擬倒車一整圈）
  const N = game.track.N;
  for (let step = 0; step < N; step++) {
    // 每次倒退 1 個取樣點
    const targetIdx = (car.trackIndex - 1 + N) % N;
    const pos = game.track.sampleAt(targetIdx).point;
    car.x = pos.x;
    car.z = pos.z;
    // 呼叫 car.update 讓其重新投影並累加 delta
    car.update(1 / 60, { steer: 0, throttle: 0, brake: 0 }, game.track);
  }

  assert.ok(car.lap <= initialLap, '倒車行駛一整圈 lap 絕不可增加');
  assert.ok(car.progress < 0, '倒車後進度應為負數');

  // 測試在起點線前後來回穿梭 10 次
  let lapChangedCount = 0;
  game.on('lapChanged', ({ player }) => {
    if (player.id === game.racers[0].id) {
      lapChangedCount++;
    }
  });

  // 在 index = 5 與 index = N - 5 之間來回穿梭 10 次
  for (let k = 0; k < 10; k++) {
    // 往前跨線
    const pForward = game.track.sampleAt(5).point;
    car.x = pForward.x;
    car.z = pForward.z;
    car.update(1 / 60, { steer: 0, throttle: 1, brake: 0 }, game.track);
    game.step(1 / 60);

    // 往後退回線後
    const pBackward = game.track.sampleAt(N - 5).point;
    car.x = pBackward.x;
    car.z = pBackward.z;
    car.update(1 / 60, { steer: 0, throttle: 0, brake: 1 }, game.track);
    game.step(1 / 60);
  }

  assert.ok(lapChangedCount <= 1, `起點線前後來回穿梭，lapChanged 最多觸發 1 次，實際觸發 ${lapChangedCount} 次`);
});

test('玩家管理 API：滿額限制、比賽中加入/退出與輸入驅動', () => {
  const game = new Game({ headless: true, rng: mulberry32(10) });

  // 1. 加入 4 位 remote 玩家，第 5 位回傳 null
  const p1 = game.addPlayer({ name: '遠端1', kind: 'remote' });
  const p2 = game.addPlayer({ name: '遠端2', kind: 'remote' });
  const p3 = game.addPlayer({ name: '遠端3', kind: 'remote' });
  const p4 = game.addPlayer({ name: '遠端4', kind: 'remote' });
  const p5 = game.addPlayer({ name: '遠端5', kind: 'remote' });

  assert.ok(p1 && p2 && p3 && p4);
  assert.equal(p5, null, '第 5 位真人玩家應回傳 null（已滿額）');
  assert.equal(game.getPlayers().length, 4);

  // 2. 測試 getStatus
  const statusLobby = game.getStatus(p1.id);
  assert.equal(statusLobby.inRace, false);
  assert.equal(statusLobby.state, 'lobby');
  assert.equal(statusLobby.lap, 0);

  const notFoundStatus = game.getStatus('non_existent_id');
  assert.equal(notFoundStatus, null, '不存在的 playerId 應回傳 null');

  // 3. 測試退出一位真人後開賽
  game.removePlayer(p4.id);
  assert.equal(game.getPlayers().length, 3);

  // 為 p1 配置全油門輸入
  p1.input = {
    getState: () => ({ steer: 0, throttle: 1, brake: 0, useItem: false }),
  };

  game.startRace();
  // 渡過 countdown（3 秒 = 180 步）
  for (let i = 0; i < 185; i++) game.step(1 / 60);
  assert.equal(game.state, 'racing');

  const p1Car = game.racers.find((r) => r.id === p1.id).car;
  const initialProgress = p1Car.progress;

  // 比賽進行 3 秒（180 步）
  for (let i = 0; i < 180; i++) game.step(1 / 60);

  assert.ok(
    p1Car.progress > initialProgress + 50,
    `送 throttle: 1 的玩家 3 秒後 progress 應明顯增加（起點 ${initialProgress} -> 目前 ${p1Car.progress}）`
  );

  // 4. 比賽中加入玩家：inRace 應為 false
  const midRacePlayer = game.addPlayer({ name: '中途加入', kind: 'remote' });
  assert.ok(midRacePlayer);
  assert.equal(midRacePlayer.inRace, false);
  const midStatus = game.getStatus(midRacePlayer.id);
  assert.equal(midStatus.inRace, false);
  assert.equal(midStatus.state, 'racing');

  // 5. 比賽中移除真人玩家：車輛保留在場上且由 AI 接手
  const p2Id = p2.id;
  game.removePlayer(p2Id);
  const p2RacerInRace = game.racers.find((r) => r.id === p2Id);
  assert.ok(p2RacerInRace, '中途離開的玩家車輛仍應存在於本場 racers 列表中');
  assert.equal(p2RacerInRace.kind, 'ai');
  assert.ok(p2RacerInRace.input instanceof AIInput, '中途離開的車輛 input 應改由 AIInput 接手');
});

test('異常輸入防護：傳入 NaN 或極端數值不會引發例外，車速保持有限數', () => {
  const game = new Game({ headless: true, rng: mulberry32(7) });
  const player = game.addPlayer({
    name: '作弊玩家',
    kind: 'remote',
    input: {
      getState: () => ({ steer: 9999, throttle: NaN, brake: -5, useItem: 'yes' }),
    },
  });

  game.startRace();
  for (let i = 0; i < 200; i++) {
    assert.doesNotThrow(() => {
      game.step(1 / 60);
    }, '極端或非法輸入不應造成 step 拋出例外');
  }

  const car = game.racers.find((r) => r.id === player.id).car;
  assert.ok(Number.isFinite(car.speed), '車輛速度應保持為有限數值');
  assert.ok(Number.isFinite(car.x), '車輛 X 座標應保持為有限數值');
  assert.ok(Number.isFinite(car.z), '車輛 Z 座標應保持唯一有限數值');
});

test('空真人陣列不提前結束比賽：AI 比賽在 racing 第 1 秒狀態依然是 racing', () => {
  const game = new Game({ headless: true, rng: mulberry32(99) });
  // 沒有任何真人加入
  game.startRace();
  // 渡過 countdown
  for (let i = 0; i < 185; i++) game.step(1 / 60);
  assert.equal(game.state, 'racing');

  // 進入 racing 後跑 1 秒（60 步）
  for (let i = 0; i < 60; i++) game.step(1 / 60);

  // 驗證未被誤判為全體完賽
  assert.equal(game.state, 'racing', 'AI 比賽開跑第 1 秒狀態應保持為 racing');
});

test('重回大廳後再開一場：racers 數量維持 4 台無殘留', () => {
  const game = new Game({ headless: true, rng: mulberry32(3) });
  game.addPlayer({ name: '玩家A' });
  game.startRace();
  assert.equal(game.racers.length, 4);

  game.backToLobby();
  assert.equal(game.state, 'lobby');
  assert.equal(game.racers.length, 0);

  game.startRace();
  assert.equal(game.racers.length, 4, '再次開賽時參賽者數量應剛好為 4 台');
});
