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

test('只有 AI 的比賽（seeds 1, 2, 7）：400 秒內完賽，每圈 < 70 秒，三場合計至少發生過一次道具升級 (level >= 2)', () => {
  const testSeeds = [1, 2, 7];
  let totalUpgrades = 0;

  for (const seed of testSeeds) {
    const game = new Game({ headless: true, rng: mulberry32(seed) });
    const finishedEvents = [];

    game.on('playerFinished', (data) => {
      finishedEvents.push(data);
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

test('防倒開刷圈：沿賽道倒車一整圈 lap 不增加，在起點線前後來回最多觸發 1 次 lapChanged', () => {
  const game = new Game({ headless: true, rng: mulberry32(42) });
  game.startRace();

  for (let i = 0; i < 190; i++) game.step(1 / 60);
  assert.equal(game.state, 'racing');

  const car = game.racers[0].car;
  const initialLap = car.lap;

  const N = game.track.N;
  for (let step = 0; step < N; step++) {
    const targetIdx = (car.trackIndex - 1 + N) % N;
    const pos = game.track.sampleAt(targetIdx).point;
    car.x = pos.x;
    car.z = pos.z;
    car.update(1 / 60, { steer: 0, throttle: 0, brake: 0 }, game.track);
  }

  assert.ok(car.lap <= initialLap, '倒車行駛一整圈 lap 絕不可增加');
  assert.ok(car.progress < 0, '倒車後進度應為負數');

  let lapChangedCount = 0;
  game.on('lapChanged', ({ player }) => {
    if (player.id === game.racers[0].id) {
      lapChangedCount++;
    }
  });

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

  assert.ok(lapChangedCount <= 1, `起點線前後來回穿梭，lapChanged 最多觸發 1 次，實際觸發 ${lapChangedCount} 次`);
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
