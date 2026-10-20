// ============================================================
//  items.test.js — 道具升級（魔石）、追蹤導彈導引、扇形香蕉與護盾防禦測試
//  涵蓋：
//  1. 拿著 Lv1 香蕉再吃箱子升級為 Lv2（itemChanged 帶 level: 2）。
//  2. Lv3 再吃箱子維持 Lv3 不變。
//  3. 抽獎中吃箱子不變。
//  4. Lv2 香蕉一次放出 3 個。
//  5. Lv2 追蹤導彈：射手在直道中心朝外偏 30 度，目標前方 40 單位，3 秒內精準命中。
//  6. Lv3 導彈數量 = 前方車輛數（最多 3 枚）。
//  7. Lv3 護盾阻擋兩次攻擊依然保持啟動。
//  8. 往前丟的香蕉 1.0 秒內不打中發射者自身。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../public/js/game.js';
import { mulberry32 } from '../public/js/utils.js';

test('道具升級與抽獎狀態：Lv1 吃到箱子升為 Lv2；Lv3 再吃維持 Lv3；抽獎中吃箱子不變', () => {
  const game = new Game({ headless: true, rng: mulberry32(1) });
  const p1 = game.addPlayer({ name: '玩家A', kind: 'remote' });
  game.startRace();

  // 跑過 countdown
  for (let i = 0; i < 185; i++) game.step(1 / 60);
  assert.equal(game.state, 'racing');

  const racer = game.racers.find((r) => r.id === p1.id);
  const itemEvents = [];
  game.on('itemChanged', (e) => {
    if (e.player.id === racer.id) itemEvents.push(e);
  });

  // 1. 手持 Lv1 香蕉，移動到道具箱位置拾取
  racer.item = 'banana';
  racer.itemLevel = 1;
  racer.rolling = false;

  const box0 = game.itemSystem.boxes[0];
  box0.active = true;
  const sBox0 = game.track.sampleAt(box0.index);
  racer.car.trackIndex = box0.index;
  racer.car.x = box0.x;
  racer.car.z = box0.z;
  racer.car.y = box0.y;
  racer.car.lateral = 0;
  racer.car.speed = 0;
  racer.car.heading = Math.atan2(sBox0.tangent.x, sBox0.tangent.z);

  game.step(1 / 60);

  assert.equal(racer.item, 'banana');
  assert.equal(racer.itemLevel, 2, '吃箱子後道具應升級為 Level 2');
  const upgradeEvt = itemEvents.find((e) => e.level === 2);
  assert.ok(upgradeEvt, '應發出 level: 2 之 itemChanged 事件');

  // 2. 升至 Lv3 後再吃箱子：保持 Lv3
  racer.itemLevel = 3;
  const box1 = game.itemSystem.boxes[1];
  box1.active = true;
  const sBox1 = game.track.sampleAt(box1.index);
  racer.car.trackIndex = box1.index;
  racer.car.x = box1.x;
  racer.car.z = box1.z;
  racer.car.y = box1.y;
  racer.car.lateral = 0;
  racer.car.speed = 0;
  racer.car.heading = Math.atan2(sBox1.tangent.x, sBox1.tangent.z);

  game.step(1 / 60);
  assert.equal(racer.itemLevel, 3, 'Lv3 吃箱子等級應維持為 3');

  // 3. 抽獎中 (rolling=true) 吃箱子：無效果
  racer.item = null;
  racer.itemLevel = 0;
  racer.rolling = true;
  racer.rollingTimer = 0.5;

  const box2 = game.itemSystem.boxes[2];
  box2.active = true;
  const sBox2 = game.track.sampleAt(box2.index);
  racer.car.trackIndex = box2.index;
  racer.car.x = box2.x;
  racer.car.z = box2.z;
  racer.car.y = box2.y;
  racer.car.lateral = 0;
  racer.car.speed = 0;
  racer.car.heading = Math.atan2(sBox2.tangent.x, sBox2.tangent.z);

  game.step(1 / 60);
  assert.equal(racer.item, null, '抽獎中吃到箱子不應直接給予或改變道具');
  assert.equal(racer.rolling, true);
});

test('Lv2 香蕉一次生成 3 個香蕉皮', () => {
  const game = new Game({ headless: true, rng: mulberry32(2) });
  const p1 = game.addPlayer({ name: '香蕉王', kind: 'remote' });
  game.startRace();
  for (let i = 0; i < 185; i++) game.step(1 / 60);

  const racer = game.racers.find((r) => r.id === p1.id);
  racer.item = 'banana';
  racer.itemLevel = 2;

  assert.equal(game.itemSystem.bananas.length, 0);

  // 使用道具
  game.itemSystem.useItem(racer);

  assert.equal(
    game.itemSystem.bananas.length,
    3,
    `Lv2 香蕉施放後應產生 3 個香蕉皮，實際為 ${game.itemSystem.bananas.length}`
  );
});

test('Lv2 追蹤導彈：車頭偏 30 度發射，前方 40 單位目標在 3 秒內精準命中', () => {
  const game = new Game({ headless: true, rng: mulberry32(3) });
  const pShooter = game.addPlayer({ name: '射手', kind: 'remote' });
  const pTarget = game.addPlayer({ name: '目標', kind: 'remote' });
  game.startRace();
  for (let i = 0; i < 185; i++) game.step(1 / 60);

  // 先 step 一次確保賽道 progress 計算生效
  game.step(1 / 60);

  const rShooter = game.racers.find((r) => r.id === pShooter.id);
  const rTarget = game.racers.find((r) => r.id === pTarget.id);

  // 設置在直道中心：起點線索引 0
  const s0 = game.track.sampleAt(0);
  rShooter.car.trackIndex = 0;
  rShooter.car.lateral = 0;
  rShooter.car.x = s0.point.x;
  rShooter.car.z = s0.point.z;
  rShooter.car.y = s0.height;
  // 車頭向外偏 30 度（約 0.52 弧度）
  const straightHeading = Math.atan2(s0.tangent.x, s0.tangent.z);
  rShooter.car.heading = straightHeading + (30 * Math.PI / 180);
  rShooter.car.speed = 0;

  // 目標在直道前方約 40 單位（取樣點步進約 40/1.5 ≈ 27）
  const targetIdx = 27;
  const sTarget = game.track.sampleAt(targetIdx);
  rTarget.car.trackIndex = targetIdx;
  rTarget.car.lateral = 0;
  rTarget.car.x = sTarget.point.x;
  rTarget.car.z = sTarget.point.z;
  rTarget.car.y = sTarget.height;
  rTarget.car.heading = straightHeading;
  rTarget.car.speed = 0;
  rTarget.car.progress = rShooter.car.progress + 27; // 確保 progress 在前方

  let targetHit = false;
  game.on('playerHit', (e) => {
    if (e.player.id === rTarget.id && e.by === rShooter.id) {
      targetHit = true;
    }
  });

  // 發射 Lv2 導彈
  rShooter.item = 'missile';
  rShooter.itemLevel = 2;
  game.itemSystem.useItem(rShooter);

  assert.equal(game.itemSystem.missiles.length, 1);
  assert.equal(game.itemSystem.missiles[0].homing, true);

  // 模擬最多 3 秒（180 步）
  for (let i = 0; i < 180; i++) {
    game.step(1 / 60);
    if (targetHit) break;
  }

  assert.ok(targetHit, 'Lv2 追蹤導彈應在 3 秒內成功導引並命中偏角目標');
});

test('Lv3 導彈發射數量 = 前方車輛數（最多 3 枚）', () => {
  const game = new Game({ headless: true, rng: mulberry32(4) });
  game.startRace();
  for (let i = 0; i < 185; i++) game.step(1 / 60);

  // 4 台車沿賽道前後排開（不同的 progress），確保最後一名前方恰好有 3 台車
  game.racers.forEach((r, idx) => {
    r.car.progress = (idx + 1) * 30; // 30, 60, 90, 120
    const s = game.track.sampleAt(idx * 20);
    r.car.trackIndex = idx * 20;
    r.car.lateral = 0;
    r.car.x = s.point.x;
    r.car.z = s.point.z;
    r.car.y = s.height;
    r.car.speed = 0;
    r.car.heading = Math.atan2(s.tangent.x, s.tangent.z);
  });

  const sortedByProg = [...game.racers].sort((a, b) => b.car.progress - a.car.progress);
  const lastRacer = sortedByProg[sortedByProg.length - 1];

  lastRacer.item = 'missile';
  lastRacer.itemLevel = 3;

  assert.equal(game.itemSystem.missiles.length, 0);
  game.itemSystem.useItem(lastRacer);

  // 前方有 3 台車，應發射 3 枚導彈
  assert.equal(
    game.itemSystem.missiles.length,
    3,
    `Lv3 導彈前方有 3 台車應發射 3 枚，實際為 ${game.itemSystem.missiles.length}`
  );
});

test('Lv3 護盾可阻擋多次攻擊依然保持啟動', () => {
  const game = new Game({ headless: true, rng: mulberry32(5) });
  const p1 = game.addPlayer({ name: '盾牌王者', kind: 'remote' });
  game.startRace();
  for (let i = 0; i < 185; i++) game.step(1 / 60);

  const racer = game.racers.find((r) => r.id === p1.id);
  const car = racer.car;

  // 啟用 Lv3 護盾
  car.applyShield(8.0, 3);
  assert.equal(car.shieldLevel, 3);
  assert.ok(car.shieldTimer > 0);

  // 第 1 次遭受導彈擊中
  const hit1 = car.hitByMissile('other_player');
  assert.equal(hit1, false, '護盾應成功抵擋第 1 次攻擊');
  assert.ok(car.shieldTimer > 0, 'Lv3 護盾抵擋第 1 次後不應消失');

  // 第 2 次遭受香蕉打滑
  const hit2 = car.hitBanana();
  assert.equal(hit2, false, '護盾應成功抵擋第 2 次攻擊');
  assert.ok(car.shieldTimer > 0, 'Lv3 護盾抵擋第 2 次後依然保持啟動');
});

test('Lv3 往前丟的香蕉在 1.0 秒內不打中發射者自身', () => {
  const game = new Game({ headless: true, rng: mulberry32(6) });
  const p1 = game.addPlayer({ name: '投擲手', kind: 'remote' });
  game.startRace();
  for (let i = 0; i < 185; i++) game.step(1 / 60);

  const racer = game.racers.find((r) => r.id === p1.id);
  racer.item = 'banana';
  racer.itemLevel = 3;

  game.itemSystem.useItem(racer);

  // 前方丟出香蕉
  assert.equal(game.itemSystem.bananas.length, 2);
  const aheadBanana = game.itemSystem.bananas.find((b) => b.ownerImmunityTimer > 1.0);
  assert.ok(aheadBanana, '應存在前方香蕉且具備 > 1.0 秒免疫時間');

  // 車子全油門開過 1.0 秒（60 步）
  let selfHit = false;
  game.on('playerHit', (e) => {
    if (e.player.id === racer.id && e.by === racer.id) {
      selfHit = true;
    }
  });

  // 將車輛直接移至前方香蕉處
  const bananaProj = game.track.project(aheadBanana.x, aheadBanana.z);
  racer.car.trackIndex = bananaProj.index;
  racer.car.lateral = bananaProj.lateral;
  racer.car.x = aheadBanana.x;
  racer.car.z = aheadBanana.z;
  racer.car.y = aheadBanana.y;

  // 模擬 1 秒（60 步）
  for (let i = 0; i < 60; i++) {
    game.step(1 / 60);
    assert.equal(selfHit, false, '在 1.0 秒內絕不可踩中自己往前丟的香蕉');
  }
});
