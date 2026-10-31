// ============================================================
//  customize.test.js — 地圖選擇、造型選擇與音效純函式測試
//  涵蓋：
//  1. 每張地圖都能讓 4 台電腦在時限內跑完比賽（賽道 AI 可行駛）。
//  2. setMap 只能在大廳切換，切換後賽道、道具箱、發車位都改用新地圖。
//  3. setPlayerLook：角色決定被動能力、烤漆不能和其他真人重複、非法值會被忽略、比賽中不能換。
//  4. cyclePlayerPaint 會跳過被選走的顏色；電腦補位的顏色避開真人選的顏色。
//  5. getStatus 帶出造型與地圖資訊（給手機的造型面板）。
//  6. 音效純函式：引擎轉速換檔、頻率範圍、每張地圖的配樂小節資料合法。
//  7. 地圖差異：路寬、流沙／結冰路面物理、峽谷岩壁與地形高度。
//  8. 車手造型：換角色時車手跟著換、可單獨換車手、8 位車手都能組出模型。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../public/js/game.js';
import { Car } from '../public/js/car.js';
import { Track } from '../public/js/track.js';
import * as THREE from 'three';
import { CONFIG, KARTS, PAINTS, DRIVERS } from '../public/js/config.js';
import { buildDriver, buildKartLook } from '../public/js/kartLook.js';
import { MAPS, getMap, DEFAULT_MAP_ID } from '../public/js/maps.js';
import { mulberry32 } from '../public/js/utils.js';
import { engineRpm, engineFrequency, buildMusicBar, degreeToSemitone, noteToFreq } from '../public/js/audio.js';

for (const map of MAPS) {
  test(`[${map.name}] 4 台電腦在 400 秒內完賽，每圈 5 ~ 70 秒`, () => {
    const game = new Game({ headless: true, rng: mulberry32(3), mapId: map.id });
    assert.equal(game.track.mapId, map.id);
    game.startRace();

    const dt = 1 / 60;
    for (let t = 0; t < 400 && game.state !== 'results'; t += dt) {
      game.step(dt);
    }

    assert.equal(game.state, 'results', `${map.name}：比賽應在 400 秒內結束`);
    for (const racer of game.racers) {
      assert.ok(racer.car.finished, `${map.name}：${racer.name} 應完賽`);
      for (const lapTime of racer.car.lapTimes) {
        assert.ok(lapTime > 5 && lapTime < 70, `${map.name}：${racer.name} 單圈 ${lapTime.toFixed(1)} 秒不合理`);
      }
    }
  });
}

test('setMap：大廳可切換地圖，賽道與道具箱改用新地圖並發出 mapChanged；比賽中不能切換', () => {
  const game = new Game({ headless: true });
  assert.equal(game.mapId, DEFAULT_MAP_ID);

  const events = [];
  game.on('mapChanged', (e) => events.push(e.mapId));

  const target = MAPS[1];
  assert.equal(game.setMap(target.id), true);
  assert.equal(game.mapId, target.id);
  assert.equal(game.track.mapId, target.id);
  assert.equal(game.itemSystem.track, game.track, '道具系統要改用新賽道');
  for (const box of game.itemSystem.boxes) {
    const pos = game.track.pointAtLateral(box.index, box.lateral);
    assert.ok(Math.abs(pos.x - box.x) < 1e-6 && Math.abs(pos.z - box.z) < 1e-6, '道具箱要擺在新賽道上');
  }
  assert.deepEqual(events, [target.id]);

  // 同一張地圖、不存在的地圖：不變
  assert.equal(game.setMap(target.id), false);
  assert.equal(game.setMap('no-such-map'), false);
  assert.equal(game.mapId, target.id);

  // cycleMap 循環
  game.cycleMap(1);
  assert.equal(game.mapId, MAPS[2 % MAPS.length].id);
  game.cycleMap(-1);
  assert.equal(game.mapId, target.id);

  // 比賽中不能換地圖，車輛發車位在目前地圖上
  game.startRace();
  const grid = game.track.startGrid(0);
  assert.ok(Math.abs(game.racers.find((r) => r.slot === 0).car.x - grid.x) < 1e-6);
  assert.equal(game.setMap(MAPS[0].id), false);
  assert.equal(game.mapId, target.id);
});

test('setPlayerLook：角色決定被動能力、烤漆不可與他人重複、非法值忽略、比賽中不能換', () => {
  const game = new Game({ headless: true });
  const p1 = game.addPlayer({ name: 'A' });
  const p2 = game.addPlayer({ name: 'B' });

  // 預設：角色 = 欄位，烤漆 = 角色預設色
  assert.equal(p1.kart, 0);
  assert.equal(p2.kart, 1);
  assert.equal(p1.color, PAINTS[p1.paint].hex);
  assert.notEqual(p1.paint, p2.paint);

  const looks = [];
  game.on('playerLookChanged', ({ player }) => looks.push(player.id));

  // p1 改成重戰車（索引 3）＋藍色（索引 4）
  assert.equal(game.setPlayerLook(p1.id, { kart: 3, paint: 4 }), true);
  assert.equal(p1.kart, 3);
  assert.equal(p1.paint, 4);
  assert.equal(p1.color, PAINTS[4].hex);
  assert.deepEqual(looks, [p1.id]);

  // p2 想選 p1 的藍色：不允許
  assert.equal(game.setPlayerLook(p2.id, { paint: 4 }), false);
  assert.notEqual(p2.paint, 4);

  // 非法值：忽略
  assert.equal(game.setPlayerLook(p2.id, { kart: 99, paint: -1 }), false);
  assert.equal(game.setPlayerLook(p2.id, { kart: 1.5, paint: '3' }), false);
  assert.equal(game.setPlayerLook('p_missing', { kart: 0 }), false);

  // 開賽：p1 的車使用重戰車能力，slot 不變（發車位與號碼）
  game.startRace();
  const racer1 = game.racers.find((r) => r.id === p1.id);
  assert.equal(racer1.car.slot, p1.slot);
  assert.equal(racer1.car.kart, 3);
  assert.deepEqual(racer1.car.stats, KARTS[3].stats);

  // 電腦的顏色不和真人重複，4 台車顏色都不同
  const paints = game.racers.map((r) => r.paint);
  assert.equal(new Set(paints).size, 4, `4 台車的烤漆應各不相同：${paints}`);

  // 比賽中不能換造型
  assert.equal(game.setPlayerLook(p1.id, { kart: 0 }), false);
  assert.equal(p1.kart, 3);
});

test('cyclePlayerPaint 跳過已被選走的顏色；cyclePlayerKart 循環切換', () => {
  const game = new Game({ headless: true });
  const p1 = game.addPlayer({ name: 'A' }); // 預設烤漆 0
  const p2 = game.addPlayer({ name: 'B' }); // 預設烤漆 1

  assert.equal(p1.paint, 0);
  assert.equal(p2.paint, 1);
  game.cyclePlayerPaint(p1.id, 1);
  assert.equal(p1.paint, 2, '烤漆 1 被 p2 選走，應跳到 2');

  game.cyclePlayerKart(p1.id, -1);
  assert.equal(p1.kart, KARTS.length - 1, '從第 0 個往前應循環到最後一個');
  game.cyclePlayerKart(p1.id, 1);
  assert.equal(p1.kart, 0);

  // 新加入的玩家預設色若已被選走，自動挑下一個空的
  game.setPlayerLook(p1.id, { paint: 3 }); // 搶走第 4 位的預設色
  game.addPlayer({ name: 'C' });
  const p4 = game.addPlayer({ name: 'D' });
  assert.notEqual(p4.paint, 3);
  const all = game.getPlayers().map((p) => p.paint);
  assert.equal(new Set(all).size, all.length, `真人烤漆不可重複：${all}`);
});

test('getStatus 帶出造型與地圖資訊，takenPaints 不含自己', () => {
  const game = new Game({ headless: true, mapId: MAPS[2].id });
  const p1 = game.addPlayer({ name: 'A' });
  const p2 = game.addPlayer({ name: 'B' });
  game.setPlayerLook(p2.id, { kart: 2, paint: 6 });

  const st = game.getStatus(p1.id);
  assert.equal(st.kart, p1.kart);
  assert.equal(st.paint, p1.paint);
  assert.deepEqual(st.takenPaints, [6]);
  assert.equal(st.mapId, MAPS[2].id);
  assert.equal(st.mapName, MAPS[2].name);
  assert.equal(st.color, PAINTS[p1.paint].hex);
});

test('getLobbyRoster 與開賽後的電腦造型一致', () => {
  const game = new Game({ headless: true });
  const p1 = game.addPlayer({ name: 'A' });
  game.setPlayerLook(p1.id, { paint: 1 }); // 搶走第 2 位電腦的預設紫色

  const roster = game.getLobbyRoster();
  assert.equal(roster.length, CONFIG.MAX_PLAYERS);
  game.startRace();
  for (const entry of roster) {
    const racer = game.racers.find((r) => r.slot === entry.slot);
    assert.equal(racer.kart, entry.kart);
    assert.equal(racer.paint, entry.paint);
    assert.equal(racer.color, entry.color);
  }
});

test('Car：kart 參數決定能力，未提供時沿用 slot（相容舊行為）', () => {
  const track = new Track();
  const legacy = new Car({ slot: 2, track });
  assert.equal(legacy.kart, 2);
  assert.deepEqual(legacy.stats, KARTS[2].stats);

  const custom = new Car({ slot: 0, kart: 1, track });
  assert.equal(custom.slot, 0);
  assert.deepEqual(custom.stats, KARTS[1].stats);

  const invalid = new Car({ slot: 1, kart: 42, track });
  assert.equal(invalid.kart, 1);
});

test('getMap 找不到地圖時回傳預設地圖', () => {
  assert.equal(getMap('nope').id, DEFAULT_MAP_ID);
  assert.equal(new Track('nope').mapId, DEFAULT_MAP_ID);
});

test('音效：引擎轉速模擬換檔（換檔瞬間轉速下降），頻率在合理範圍', () => {
  assert.equal(engineRpm(0), 0);
  // 1 檔內轉速隨速度上升
  assert.ok(engineRpm(0.2) > engineRpm(0.1));
  // 跨過換檔點（0.25）轉速會掉下來
  assert.ok(engineRpm(0.26) < engineRpm(0.24), '換檔後轉速應下降');
  // 全程不超過上限
  for (let r = 0; r <= 1.3; r += 0.01) {
    const rpm = engineRpm(r);
    assert.ok(rpm >= 0 && rpm <= 1.15, `speedRatio ${r.toFixed(2)} 的轉速 ${rpm} 超出範圍`);
    const f = engineFrequency(rpm);
    assert.ok(f >= 45 && f <= 200, `引擎頻率 ${f} 超出範圍`);
  }
  assert.ok(Math.abs(noteToFreq(69) - 440) < 1e-9);
  assert.equal(degreeToSemitone([0, 2, 4, 5, 7, 9, 11], 7), 12);
  assert.equal(degreeToSemitone([0, 2, 4, 5, 7, 9, 11], -1), -1);
});

test('音效：每張地圖的配樂在每種模式都產生合法的音符事件', () => {
  const voices = new Set(['pad', 'bass', 'lead', 'kick', 'snare', 'hat']);
  for (const map of MAPS) {
    assert.ok(map.music && map.music.bpm > 60, `${map.name} 應有配樂設定`);
    assert.equal(map.music.lead.length, 16, `${map.name} 主旋律應為 16 格`);
    for (const mode of ['lobby', 'race', 'final']) {
      for (let bar = 0; bar < 8; bar++) {
        const events = buildMusicBar(map.music, bar, mode);
        assert.ok(events.length > 0);
        for (const ev of events) {
          assert.ok(voices.has(ev.voice), `未知聲部 ${ev.voice}`);
          assert.ok(Number.isInteger(ev.step) && ev.step >= 0 && ev.step < 16);
          if (ev.midi != null) {
            assert.ok(Number.isFinite(ev.midi) && ev.midi >= 24 && ev.midi <= 108, `${map.name} 音高 ${ev.midi} 超出範圍`);
          }
        }
        if (mode === 'lobby') {
          assert.ok(!events.some((e) => e.voice === 'kick'), '大廳版本不應有大鼓');
        } else {
          assert.ok(events.some((e) => e.voice === 'kick'), '比賽版本應有大鼓');
        }
      }
    }
  }
});

test('三張地圖的地形各不相同：路寬、高低落差與特殊路段', () => {
  const widths = new Set();
  const drops = [];
  for (const map of MAPS) {
    const track = new Track(map.id);
    widths.add(track.width);
    drops.push(Math.max(...track.height) - Math.min(...track.height));
  }
  assert.equal(widths.size, MAPS.length, '每張地圖路寬應不同');
  assert.ok(Math.max(...drops) >= 14, '至少一張地圖落差 >= 14 米');

  const desert = new Track('desert');
  const snow = new Track('snow');
  assert.ok(desert.surface.includes('sand'), '沙漠應有流沙路段');
  assert.ok(snow.surface.includes('ice'), '雪地應有結冰路段');
  assert.ok(new Track('meadow').surface.every((x) => x === null), '草原沒有特殊路面');
});

test('地形高度：路面旁在路面下方；峽谷路段兩側是高聳岩壁、一般路段沒有', () => {
  const desert = new Track('desert');
  const canyonZone = desert.zones.find((z) => z.type === 'canyon');
  const mid = Math.floor((canyonZone.start + canyonZone.end) / 2);
  const open = desert.zones.find((z) => z.type === 'sand').start;

  const sideHeight = (track, idx, lat) => {
    const p = track.pointAtLateral(idx, lat);
    return track.terrainHeight(p.x, p.z);
  };
  // 路面正下方的地形低於路面
  for (const idx of [0, mid, open]) {
    assert.ok(sideHeight(desert, idx, 0) < desert.height[idx], '地形不可穿出路面');
  }
  // 峽谷：離路面 40 單位處的岩壁比路面高出 20 以上
  const canyonWall = sideHeight(desert, mid, 40) - desert.height[mid];
  assert.ok(canyonWall > 20, `峽谷岩壁應高聳，實際高出 ${canyonWall.toFixed(1)}`);
  const openSide = sideHeight(desert, open, 40) - desert.height[open];
  assert.ok(openSide < 10, `一般沙漠路段兩側不應有岩壁，實際高出 ${openSide.toFixed(1)}`);
});

// 在指定路面上直線全速開一段時間，回傳最終速度與轉過的角度
function driveOn(track, index, { steer = 0, seconds = 3 } = {}) {
  const car = new Car({ slot: 0, track });
  const s = track.sampleAt(index);
  car.x = s.point.x; car.z = s.point.z; car.y = s.height;
  car.heading = Math.atan2(s.tangent.x, s.tangent.z);
  car.trackIndex = index;
  car.lateral = 0;
  car.speed = 20;
  const h0 = car.heading;
  // 只模擬很短的距離，維持在同一種路面上
  for (let t = 0; t < seconds; t += 1 / 60) {
    car.trackIndex = index; car.lateral = 0;
    car.x = s.point.x; car.z = s.point.z;
    car.update(1 / 60, { steer, throttle: 1, brake: 0, drift: false }, track);
  }
  return { speed: car.speed, turned: Math.abs(car.heading - h0), surface: car.surface };
}

test('流沙路段最高速變慢；結冰路段轉向變遲鈍', () => {
  const desert = new Track('desert');
  const sandIdx = desert.surface.indexOf('sand');
  const roadIdx = desert.surface.indexOf(null);
  const sand = driveOn(desert, sandIdx);
  const normal = driveOn(desert, roadIdx);
  assert.equal(sand.surface, 'sand');
  assert.ok(sand.speed < normal.speed * 0.8, `流沙速度 ${sand.speed.toFixed(1)} 應明顯低於一般路面 ${normal.speed.toFixed(1)}`);

  const snow = new Track('snow');
  const iceIdx = snow.surface.indexOf('ice');
  const dryIdx = snow.surface.indexOf(null);
  const ice = driveOn(snow, iceIdx, { steer: 1, seconds: 0.5 });
  const dry = driveOn(snow, dryIdx, { steer: 1, seconds: 0.5 });
  assert.equal(ice.surface, 'ice');
  assert.ok(ice.turned < dry.turned * 0.7, `冰面轉向 ${ice.turned.toFixed(2)} 應明顯小於乾燥路面 ${dry.turned.toFixed(2)}`);
});

test('車手造型：換角色時車手跟著換成預設車手；也可以單獨換車手；非法值忽略', () => {
  const game = new Game({ headless: true });
  const p = game.addPlayer({ name: 'A' });
  assert.equal(p.driver, KARTS[p.kart].driver);

  game.setPlayerLook(p.id, { kart: 2 });
  assert.equal(p.driver, KARTS[2].driver, '換角色時車手跟著換');

  assert.equal(game.setPlayerLook(p.id, { driver: 6 }), true);
  assert.equal(p.driver, 6);
  assert.equal(p.kart, 2, '只換車手不影響角色');

  game.setPlayerLook(p.id, { kart: 3, driver: 7 });
  assert.equal(p.driver, 7, '同時指定角色與車手時以指定的車手為準');

  assert.equal(game.setPlayerLook(p.id, { driver: DRIVERS.length }), false);
  game.cyclePlayerDriver(p.id, 1);
  assert.equal(p.driver, 0, '最後一位往後循環到第一位');

  assert.equal(game.getStatus(p.id).driver, 0);
  game.startRace();
  const racer = game.racers.find((r) => r.id === p.id);
  assert.equal(racer.car.driver, 0);
  for (const ai of game.racers.filter((r) => r.kind === 'ai')) {
    assert.equal(ai.car.driver, KARTS[ai.kart].driver, '電腦使用角色預設車手');
  }
});

test('8 位車手都能組出模型，大小合理，衣服顏色跟著烤漆', () => {
  for (let i = 0; i < DRIVERS.length; i++) {
    const materials = [];
    const group = buildDriver(i, '#ff0000', materials);
    const box = new THREE.Box3().setFromObject(group);
    assert.ok(group.children.length >= 6, `${DRIVERS[i].name} 應由多個零件組成`);
    assert.ok(box.max.y > 0.9 && box.max.y < 1.6, `${DRIVERS[i].name} 高度 ${box.max.y.toFixed(2)} 不合理`);
    assert.ok(box.max.x < 0.6 && box.min.x > -0.6, `${DRIVERS[i].name} 寬度超出車身`);
    assert.ok(materials.length > 0);
  }
  // 賽車手的安全帽是烤漆色
  const mats = [];
  buildDriver(0, '#00ff00', mats);
  assert.ok(mats.some((m) => m.color.g > 0.9 && m.color.r < 0.1), '賽車手應有烤漆色零件');

  // buildKartLook：移除原本共用的人物，換上指定車手
  const template = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 0.3, 1.5), new THREE.MeshStandardMaterial());
  template.add(body);
  const character = new THREE.Mesh(new THREE.SphereGeometry(0.4), new THREE.MeshStandardMaterial());
  character.name = 'character';
  character.position.set(0, 0.28, -0.07);
  body.add(character);
  const look = buildKartLook(template, { driver: 5, color: '#3498db' });
  assert.equal(look.model.getObjectByName('character'), undefined, '原本的人物應被移除');
  const person = look.model.getObjectByName('driver');
  assert.ok(person, '應換上新車手');
  assert.ok(Math.abs(person.position.y - 0.28) < 1e-6, '車手放在原本人物的位置');
});

test('難度：只能在大廳切換；電腦速度係數依難度落在對應範圍；困難模式落後時會追趕', async () => {
  const { DIFFICULTIES } = await import('../public/js/config.js');
  const game = new Game({ headless: true });
  assert.equal(game.difficulty, 'normal');
  const events = [];
  game.on('difficultyChanged', (e) => events.push(e.difficulty));

  assert.equal(game.setDifficulty('hard'), true);
  assert.equal(game.setDifficulty('hard'), false, '相同難度不重複觸發');
  assert.equal(game.setDifficulty('nightmare'), false, '不存在的難度忽略');
  game.cycleDifficulty(1);
  assert.equal(game.difficulty, 'easy', '困難之後循環回簡單');
  assert.deepEqual(events, ['hard', 'easy']);

  for (const diff of DIFFICULTIES) {
    const g = new Game({ headless: true, rng: mulberry32(9), difficulty: diff.id });
    const human = g.addPlayer({ name: 'H' });
    g.startRace();
    assert.equal(g.getStatus(human.id).difficulty, diff.id);
    for (const ai of g.racers.filter((r) => r.kind === 'ai')) {
      const f = ai.input.speedFactor;
      const [lo, hi] = diff.id === 'normal' ? [CONFIG.AI_SPEED_MIN, CONFIG.AI_SPEED_MAX] : diff.aiSpeed;
      assert.ok(f >= lo && f <= hi, `${diff.name}：電腦速度係數 ${f.toFixed(3)} 應在 ${lo} ~ ${hi}`);
    }
    // 比賽中不能換難度
    assert.equal(g.setDifficulty(diff.id === 'easy' ? 'hard' : 'easy'), false);

    // 追趕：把真人放到電腦前方 1/4 圈
    const ai = g.racers.find((r) => r.kind === 'ai');
    human.car.progress = ai.car.progress + g.track.N / 4;
    const bonus = ai.input._catchUpBonus(ai.car);
    if (diff.id === 'hard') assert.ok(bonus > 0, '困難模式落後時應追趕');
    else assert.equal(bonus, 0, `${diff.name} 不追趕`);
  }
});

test('難度影響比賽結果：同一張地圖，困難的電腦平均單圈比簡單快', () => {
  const avgLap = (difficulty) => {
    const g = new Game({ headless: true, rng: mulberry32(11), mapId: 'desert', difficulty });
    g.startRace();
    for (let t = 0; t < 400 && g.state !== 'results'; t += 1 / 60) g.step(1 / 60);
    const laps = g.racers.flatMap((r) => r.car.lapTimes);
    return laps.reduce((a, b) => a + b, 0) / laps.length;
  };
  const easy = avgLap('easy');
  const hard = avgLap('hard');
  assert.ok(hard < easy - 1, `困難平均單圈 ${hard.toFixed(1)} 秒應比簡單 ${easy.toFixed(1)} 秒快`);
});
