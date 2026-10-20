// ============================================================
//  race.test.js — 核心遊戲模擬與比賽流程單元測試
//  測試無頭模式下的完整 AI 比賽流程（seeds 1, 2, 7 完賽、單圈 < 70 秒、道具升級發生）、
//  圈數判定（防倒開刷圈）、玩家加入/退出 API、異常輸入防護與狀態機轉換。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../public/js/game.js';
import { CONFIG } from '../public/js/config.js';
import { mulberry32 } from '../public/js/utils.js';
import { AIInput } from '../public/js/ai.js';

test('只有 AI 的比賽（seeds 1, 2, 7）：400 秒內完賽，每圈 < 70 秒，每台車觸發 lapChanged 恰為 LAPS - 1 次，三場合計至少發生過一次道具升級 (level >= 2)', () => {
  const testSeeds = [1, 2, 7];
  let totalUpgrades = 0;

  for (const seed of testSeeds) {
    const game = new Game({ headless: true, rng: mulberry32(seed) });
    const finishedEvents = [];
    const lapChangedCounts = new Map();

    game.on('playerFinished', (data) => {
      finishedEvents.push(data);
    });

    game.on('lapChanged', ({ player }) => {
      lapChangedCounts.set(player.id, (lapChangedCounts.get(player.id) || 0) + 1);
    });

    game.on('itemChanged', (e) => {
      if (e.level >= 2) {
        totalUpgrades++;
      }
    });

    game.startRace();
    assert.equal(game.state, 'countdown');
    assert.equal(game.racers.length, 4);

    const dt = 1 / 60;
    let simulatedTime = 0;
    const maxTime = 400;

    while (simulatedTime < maxTime) {
      game.step(dt);
      simulatedTime += dt;

      if (game.state === 'results') {
        break;
      }
    }

    assert.equal(game.state, 'results', `seed ${seed} 比賽應於 400 秒內完賽進入 results 結算狀態`);
    assert.equal(finishedEvents.length, 4, `seed ${seed} 的 4 台 AI 都應完賽`);

    const ranks = finishedEvents.map((e) => e.rank);
    ranks.sort((a, b) => a - b);
    assert.deepEqual(ranks, [1, 2, 3, 4]);

    for (const racer of game.racers) {
      assert.equal(racer.car.lapTimes.length, CONFIG.LAPS);
      const lapsCount = lapChangedCounts.get(racer.id) || 0;
      assert.equal(
        lapsCount,
        CONFIG.LAPS - 1,
        `完賽車輛 ${racer.name} 觸發 lapChanged 次數應恰為 CONFIG.LAPS - 1 (${CONFIG.LAPS - 1})，實際為 ${lapsCount}`
      );
      for (const lapTime of racer.car.lapTimes) {
        assert.ok(
          lapTime > 5.0 && lapTime < 70.0,
          `seed ${seed} 玩家 ${racer.name} 單圈時間應介於 5 ~ 70 秒，實際為 ${lapTime.toFixed(2)}`
        );
      }
    }
  }

  assert.ok(
    totalUpgrades >= 1,
    `三場 AI 比賽中合計應至少發生過一次道具升級 (level >= 2)，實際發生 ${totalUpgrades} 次`
  );
});

test('防倒開刷圈：沿賽道倒車一整圈 lap 不增加；正開一圈觸發恰好 1 次 lapChanged；起點線前後來回 10 次仍維持恰好 1 次', () => {
  const game = new Game({ headless: true, rng: mulberry32(42) });
  const lapChangedEvents = [];
  game.on('lapChanged', (e) => {
    lapChangedEvents.push(e);
  });

  game.startRace();

  for (let i = 0; i < 190; i++) game.step(1 / 60);
  assert.equal(game.state, 'racing');

  const car = game.racers[0].car;
  const initialLap = car.lap;
  const N = game.track.N;

  // 1. 倒車行駛一整圈：lap 不增加，progress < 0，未觸發 lapChanged
  for (let step = 0; step < N; step++) {
    const targetIdx = (car.trackIndex - 1 + N) % N;
    const pos = game.track.sampleAt(targetIdx).point;
    car.x = pos.x;
    car.z = pos.z;
    car.update(1 / 60, { steer: 0, throttle: 0, brake: 0 }, game.track);
  }
  game.step(1 / 60);

  assert.ok(car.lap <= initialLap, '倒車行駛一整圈 lap 絕不可增加');
  assert.ok(car.progress < 0, '倒車後進度應為負數');
  assert.equal(
    lapChangedEvents.filter((e) => e.player.id === game.racers[0].id).length,
    0,
    '倒車不應觸發 lapChanged'
  );

  // 將車輛重設回起點線正前方 (index 0) 並重置進度
  car.trackIndex = 0;
  car.progress = 0;
  car.lapsDone = 0;
  car.maxLapsDone = 0;
  const s0 = game.track.sampleAt(0).point;
  car.x = s0.x;
  car.z = s0.z;
  car.update(1 / 60, { steer: 0, throttle: 0, brake: 0 }, game.track);

  // 2. 正向行駛完整一圈 (0 -> N)
  for (let step = 1; step <= N; step++) {
    const targetIdx = step % N;
    const pos = game.track.sampleAt(targetIdx).point;
    car.x = pos.x;
    car.z = pos.z;
    car.update(1 / 60, { steer: 0, throttle: 1, brake: 0 }, game.track);
  }
  game.step(1 / 60);

  // 正開一整圈後，lapChanged 應恰好觸發 1 次（進入第 2 圈），car.lapsDone 為 1
  const countAfter1Lap = lapChangedEvents.filter((e) => e.player.id === game.racers[0].id).length;
  assert.equal(countAfter1Lap, 1, '正向行駛一整圈後應恰好觸發 1 次 lapChanged');
  assert.equal(car.lapsDone, 1, 'lapsDone 應為 1');

  // 3. 在起點線前後來回穿梭 10 次（例如 5 到 N-5）
  for (let k = 0; k < 10; k++) {
    const pForward = game.track.sampleAt(5).point;
    car.x = pForward.x;
    car.z = pForward.z;
    car.update(1 / 60, { steer: 0, throttle: 1, brake: 0 }, game.track);
    game.step(1 / 60);

    const pBackward = game.track.sampleAt(N - 5).point;
    car.x = pBackward.x;
    car.z = pBackward.z;
    car.update(1 / 60, { steer: 0, throttle: 0, brake: 1 }, game.track);
    game.step(1 / 60);
  }

  // 穿梭 10 次後，lapChanged 仍應維持恰好 1 次，不得被刷圈增加
  const countAfterOscillate = lapChangedEvents.filter((e) => e.player.id === game.racers[0].id).length;
  assert.equal(countAfterOscillate, 1, `起點線前後來回穿梭 10 次，lapChanged 應仍為 1 次，實際為 ${countAfterOscillate} 次`);
});

test('玩家管理 API：滿額限制、比賽中加入/退出與輸入驅動', () => {
  const game = new Game({ headless: true, rng: mulberry32(10) });

  const p1 = game.addPlayer({ name: '遠端1', kind: 'remote' });
  const p2 = game.addPlayer({ name: '遠端2', kind: 'remote' });
  const p3 = game.addPlayer({ name: '遠端3', kind: 'remote' });
  const p4 = game.addPlayer({ name: '遠端4', kind: 'remote' });
  const p5 = game.addPlayer({ name: '遠端5', kind: 'remote' });

  assert.ok(p1 && p2 && p3 && p4);
  assert.equal(p5, null, '第 5 位真人玩家應回傳 null');
  assert.equal(game.getPlayers().length, 4);

  const statusLobby = game.getStatus(p1.id);
  assert.equal(statusLobby.inRace, false);
  assert.equal(statusLobby.state, 'lobby');
  assert.equal(statusLobby.lap, 0);
  assert.equal(statusLobby.itemLevel, 0);

  const notFoundStatus = game.getStatus('non_existent_id');
  assert.equal(notFoundStatus, null);

  game.removePlayer(p4.id);
  assert.equal(game.getPlayers().length, 3);

  p1.input = {
    getState: () => ({ steer: 0, throttle: 1, brake: 0, useItem: false }),
  };

  game.startRace();
  for (let i = 0; i < 185; i++) game.step(1 / 60);
  assert.equal(game.state, 'racing');

  const p1Car = game.racers.find((r) => r.id === p1.id).car;
  const initialProgress = p1Car.progress;

  for (let i = 0; i < 180; i++) game.step(1 / 60);

  assert.ok(
    p1Car.progress > initialProgress + 50,
    `送 throttle: 1 的玩家 3 秒後 progress 應明顯增加（起點 ${initialProgress} -> 目前 ${p1Car.progress}）`
  );

  const midRacePlayer = game.addPlayer({ name: '中途加入', kind: 'remote' });
  assert.ok(midRacePlayer);
  assert.equal(midRacePlayer.inRace, false);
  const midStatus = game.getStatus(midRacePlayer.id);
  assert.equal(midStatus.inRace, false);
  assert.equal(midStatus.state, 'racing');

  const p2Id = p2.id;
  game.removePlayer(p2Id);
  const p2RacerInRace = game.racers.find((r) => r.id === p2Id);
  assert.ok(p2RacerInRace);
  assert.equal(p2RacerInRace.kind, 'ai');
  assert.ok(p2RacerInRace.input instanceof AIInput);
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
    });
  }

  const car = game.racers.find((r) => r.id === player.id).car;
  assert.ok(Number.isFinite(car.speed));
  assert.ok(Number.isFinite(car.x));
  assert.ok(Number.isFinite(car.z));
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
  assert.equal(game.racers.length, 4);
});

test('狀態機轉換序列：依序經歷 countdown -> racing -> results，且開賽 1 秒後狀態仍為 racing', () => {
  const game = new Game({ headless: true, rng: mulberry32(1) });
  const states = [];
  game.on('stateChanged', ({ state }) => {
    states.push(state);
  });

  game.startRace();
  assert.equal(game.state, 'countdown');

  // 推進至 racing 並再過 1 秒 (3.0s 倒數 + 1.0s 開賽 = 4.0s)
  const dt = 1 / 60;
  for (let t = 0; t < 4.0; t += dt) {
    game.step(dt);
  }
  assert.equal(game.state, 'racing', '開賽 1 秒後狀態應持續維持 racing，不提早結算');

  // 持續推進直到完賽
  let simTime = 4.0;
  while (simTime < 400 && game.state !== 'results') {
    game.step(dt);
    simTime += dt;
  }
  assert.equal(game.state, 'results');
  assert.deepEqual(states, ['countdown', 'racing', 'results'], '狀態機應依序發送 countdown -> racing -> results');
});

test('單人真人離線：viewRacers 維持快照不變，比賽等待所有電腦完賽', () => {
  const game = new Game({ headless: true, rng: mulberry32(5) });
  const p1 = game.addPlayer({ name: '單人玩家', kind: 'remote' });
  game.startRace();

  assert.equal(game.viewRacers.length, 1);
  assert.equal(game.viewRacers[0].id, p1.id);

  // 進入 racing
  for (let i = 0; i < 185; i++) game.step(1 / 60);
  assert.equal(game.state, 'racing');

  // 移除真人玩家（斷線）
  game.removePlayer(p1.id);

  // 斷線後 viewRacers 陣列長度與參照維持不變
  assert.equal(game.viewRacers.length, 1, 'viewRacers 長度應維持 1');
  assert.equal(game.viewRacers[0].id, p1.id, 'viewRacers 車輛參照應維持原玩家');

  // 開賽 1 秒後確認比賽仍在進行，並未立刻中斷或跳 results
  for (let i = 0; i < 60; i++) game.step(1 / 60);
  assert.equal(game.state, 'racing');

  // 持續推進直到比賽結算（等待所有 4 台 AI 跑完）
  let time = 0;
  while (time < 400 && game.state !== 'results') {
    game.step(1 / 60);
    time += 1 / 60;
  }

  assert.equal(game.state, 'results');
  assert.ok(game.racers.every((r) => r.car && r.car.finished), '所有 4 台車（含轉為 AI 的車）皆應完賽');
});

test('車碰車 Lv3 衝撞判定：護盾阻擋衝撞（不觸發 playerHit），重疊 1 秒只觸發一次 playerHit', () => {
  const game = new Game({ headless: true, rng: mulberry32(1) });
  game.startRace();
  // 跳過倒數進入 racing
  for (let i = 0; i < 185; i++) game.step(1 / 60);
  assert.equal(game.state, 'racing');

  const racerA = game.racers[0];
  const racerB = game.racers[1];
  const carA = racerA.car;
  const carB = racerB.car;

  // 靜止輸入避免 AI 自行轉向加速
  const stopInput = { getState: () => ({ steer: 0, throttle: 0, brake: 0, useItem: false }) };
  racerA.input = stopInput;
  racerB.input = stopInput;

  const p0 = game.track.sampleAt(0).point;

  // 1. 車 A 開啟 Lv3 氮氣，車 B 開啟護盾：應成功阻擋，不觸發 playerHit
  carA.nitroLevel = 3;
  carB.applyShield(5.0, 1);

  const hitEvents = [];
  game.on('playerHit', (e) => hitEvents.push(e));

  // 將車 A 與車 B 置於相同賽道位置（重疊碰撞）
  carA.x = p0.x;
  carA.z = p0.z;
  carA.y = 0;
  carA.speed = 0;
  carB.x = p0.x;
  carB.z = p0.z;
  carB.y = 0;
  carB.speed = 0;

  game.step(1 / 60);
  assert.equal(hitEvents.length, 0, '護盾應成功擋下 Lv3 衝撞，不觸發 playerHit');

  // 2. 車 B 護盾消失後，連續重疊 1 秒（60 步）：只觸發 1 次 playerHit
  carB.shieldTimer = 0;
  carB.shieldLevel = 0;

  for (let i = 0; i < 60; i++) {
    carA.x = p0.x;
    carA.z = p0.z;
    carA.y = 0;
    carA.speed = 0;
    carB.x = p0.x;
    carB.z = p0.z;
    carB.y = 0;
    carB.speed = 0;
    game.step(1 / 60);
  }

  assert.equal(hitEvents.length, 1, '連續重疊 1 秒期間，playerHit 應僅觸發一次');
  assert.equal(hitEvents[0].player.id, racerB.id);
  assert.equal(hitEvents[0].by, racerA.id);
});
