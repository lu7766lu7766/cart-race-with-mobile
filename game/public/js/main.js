// ============================================================
//  main.js — 遊戲主程式啟動與主迴圈
//  負責初始化 Three.js 場景、固定範圍全局日光陰影相機、
//  陸行鳥大賽車風格分割畫面追尾相機（ChaseCamera）與全場相機（OverviewCamera）、
//  資產載入進度、建立遊戲核心 Game 實例、掛載 HUD 與 WebAudio 音效（引擎、技能、配樂），
//  大廳地圖切換（換賽道、天空、燈光）與卡丁車造型 3D 預覽，
//  並以 requestAnimationFrame 驅動畫面渲染（setScissorTest / setViewport / setScissor）。
// ============================================================

import * as THREE from 'three';
import { CONFIG, KEYBOARD_LAYOUTS } from './config.js';
import { MAPS } from './maps.js';
import { Car } from './car.js';
import { Game } from './game.js';
import { AssetManager } from './assets.js';
import { ChaseCamera, OverviewCamera, getViewportRects } from './camera.js';
import { HUD } from './hud.js';
import { SoundSystem } from './audio.js';
import { KeyboardInput } from './input.js';
import { initNetwork } from './network.js';

async function bootstrap() {
  const container = document.getElementById('game-container') || document.body;
  const loadingScreen = document.getElementById('loading-screen');
  const progressBar = document.getElementById('loading-progress-bar');
  const progressText = document.getElementById('loading-progress-text');

  // 1. 初始化 Three.js 渲染器（6.7 效能優化：pixelRatio 上限 1.5，手動控制陰影更新）
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  container.appendChild(renderer.domElement);

  // 2. 初始化 3D 場景與天空背景
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  const defaultFog = new THREE.FogExp2(0x87ceeb, 0.0022);
  scene.fog = defaultFog;

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
  scene.add(ambientLight);

  // 3. 建立日光陰影系統（6.1: 固定框住整條賽道包圍盒，貼圖 4096）
  const sunLight = new THREE.DirectionalLight(0xffffff, 1.25);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 4096;
  sunLight.shadow.mapSize.height = 4096;
  scene.add(sunLight);
  scene.add(sunLight.target);

  // 4. 初始化遊戲核心
  const game = new Game();
  window.game = game;

  // 依地圖主題設定天空、霧、燈光，並依賽道包圍盒配置陰影相機（換地圖時會再呼叫一次）
  function applyMapTheme(track) {
    const theme = track.theme;
    scene.background = new THREE.Color(theme.sky);
    defaultFog.color.set(theme.sky);
    defaultFog.density = theme.fogDensity;
    ambientLight.color.set(theme.ambient.color);
    ambientLight.intensity = theme.ambient.intensity;
    sunLight.color.set(theme.sun.color);
    sunLight.intensity = theme.sun.intensity;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of track.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const midX = (minX + maxX) / 2;
    const midZ = (minZ + maxZ) / 2;
    const span = Math.max((maxX - minX) / 2, (maxZ - minZ) / 2) + 25;

    sunLight.position.set(midX + 60, 240, midZ + 60);
    sunLight.target.position.set(midX, 0, midZ);
    sunLight.target.updateMatrixWorld();
    sunLight.shadow.camera.left = -span;
    sunLight.shadow.camera.right = span;
    sunLight.shadow.camera.top = span;
    sunLight.shadow.camera.bottom = -span;
    sunLight.shadow.camera.near = 20;
    sunLight.shadow.camera.far = 500;
    sunLight.shadow.camera.updateProjectionMatrix();
  }
  applyMapTheme(game.track);

  // 5. 載入 3D 模型素材
  const assets = new AssetManager();
  await assets.loadAll((progress) => {
    const pct = Math.floor(progress * 100);
    if (progressBar) progressBar.style.width = `${pct}%`;
    if (progressText) progressText.textContent = `載入素材中... ${pct}%`;
  });

  if (loadingScreen) {
    loadingScreen.style.opacity = '0';
    setTimeout(() => {
      loadingScreen.style.display = 'none';
    }, 400);
  }

  // 建立賽道路面、跳台與裝飾網格
  let builtTrack = game.track;
  builtTrack.buildMeshes(scene, assets);
  game.itemSystem.attachView(scene, assets);

  // 素材載入完成，切換核心狀態至大廳
  game.enterLobby();

  // 6. 建立追尾鏡頭群與全場相機
  const chaseCameras = [
    new ChaseCamera(0, game.track),
    new ChaseCamera(1, game.track),
    new ChaseCamera(2, game.track),
    new ChaseCamera(3, game.track),
  ];
  const overviewCamera = new OverviewCamera(game.track);

  // 7. 初始化 HUD 介面與音效系統
  const hudContainer = document.getElementById('hud-container') || container;
  const hud = new HUD(hudContainer, game);
  hud.setOverviewCamera(overviewCamera.camera);
  const audio = new SoundSystem();
  window.sound = audio; // 方便在瀏覽器 Console 除錯（例如 sound.toggleMusic()）
  audio.setMusic('lobby', game.mapId);
  audio.onChange = () => hud.setAudioState({ muted: audio.muted, music: audio.musicEnabled });
  hud.setAudioState({ muted: audio.muted, music: audio.musicEnabled });

  // 依玩家在分割畫面的位置決定左右聲道（左邊畫面的玩家聲音偏左）
  function panForRacer(racer) {
    const viewRacers = game.viewRacers || [];
    const idx = viewRacers.indexOf(racer);
    if (idx < 0 || viewRacers.length < 2) return 0;
    const rects = getViewportRects(viewRacers.length, window.innerWidth, window.innerHeight);
    const rect = rects[idx];
    if (!rect) return 0;
    return ((rect.x + rect.w / 2) / window.innerWidth - 0.5) * 1.2;
  }

  // 只和個人有關的音效：電腦觸發時不播放（避免一直聽到別人的圈數、抽道具聲）
  const PERSONAL_SOUNDS = new Set(['lap', 'final_lap', 'finished', 'box', 'upgrade', 'pad']);

  game.on('sound', (event) => {
    if (typeof event === 'string') {
      audio.play(event);
      return;
    }
    if (!event || !event.type) return;

    let volume = 1;
    let pan = 0;
    const involved = event.players || (event.player ? [event.player] : []);
    if (involved.length > 0) {
      const human = involved.find((r) => r && r.kind !== 'ai');
      if (human) {
        pan = panForRacer(human);
      } else {
        if (PERSONAL_SOUNDS.has(event.type)) return;
        volume = 0.3; // 電腦玩家的技能與碰撞聲小聲一點
      }
    }
    audio.play(event.type, { ...event, volume, pan });
  });

  // 逆向行駛警告音（只對真人）
  game.on('wrongWay', ({ player }) => {
    if (player && player.kind !== 'ai') audio.play('wrong_way', { pan: panForRacer(player) });
  });

  // 真人進入最後一圈：背景音樂加速
  game.on('lapChanged', ({ player, lap }) => {
    if (player && player.kind !== 'ai' && lap === CONFIG.LAPS && game.state === 'racing') {
      audio.setMusic('final', game.mapId);
    }
  });

  // ------------------------------------------------------------
  // 大廳卡丁車造型預覽：在起跑格擺出 4 台車（真人選的造型＋電腦補位造型）
  // ------------------------------------------------------------
  let lobbyPreviewCars = [];
  let lobbyPreviewKey = '';

  function clearLobbyPreview() {
    for (const car of lobbyPreviewCars) car.detachView();
    lobbyPreviewCars = [];
    lobbyPreviewKey = '';
  }

  function refreshLobbyPreview() {
    if (game.state !== 'lobby') {
      clearLobbyPreview();
      return;
    }
    const roster = game.getLobbyRoster();
    const key = game.mapId + '|' + roster.map((r) => `${r.slot}:${r.kart}:${r.driver}:${r.color}:${r.name}`).join(',');
    if (key === lobbyPreviewKey) return;
    clearLobbyPreview();
    lobbyPreviewKey = key;
    for (const entry of roster) {
      const car = new Car({
        slot: entry.slot,
        kart: entry.kart,
        driver: entry.driver,
        track: game.track,
        player: { name: entry.human ? entry.name : `🤖 ${entry.name}` },
      });
      car.attachView(scene, assets, entry.color);
      car.syncView(0);
      lobbyPreviewCars.push(car);
    }
  }

  // 大廳鏡頭焦點：換地圖後高空環繞預覽整張地圖 7 秒；換造型後特寫那台車 4 秒
  let lobbyFocus = null;
  function lobbyFocusTarget() {
    if (!lobbyFocus || performance.now() > lobbyFocus.until) {
      lobbyFocus = null;
      return null;
    }
    if (lobbyFocus.type === 'tour') return { type: 'tour' };
    const car = lobbyPreviewCars.find((c) => c.slot === lobbyFocus.slot);
    return car ? { type: 'kart', x: car.x, y: car.y, z: car.z, heading: car.heading } : null;
  }

  // 特寫時暫時隱藏那台車的號碼旗與名牌，避免擋住車手
  function updatePreviewLabels(focus) {
    for (const car of lobbyPreviewCars) {
      const hide = Boolean(focus && focus.type === 'kart' && lobbyFocus && car.slot === lobbyFocus.slot);
      if (car.flagGroup) car.flagGroup.visible = !hide;
      if (car.nameSprite) car.nameSprite.visible = !hide;
    }
  }

  // 換地圖：拆掉舊賽道、建立新賽道與主題、相機與小地圖改用新賽道、配樂換成新地圖
  game.on('mapChanged', () => {
    builtTrack.detachView();
    builtTrack = game.track;
    builtTrack.buildMeshes(scene, assets);
    applyMapTheme(builtTrack);
    chaseCameras.forEach((c) => { c.track = builtTrack; });
    overviewCamera.setTrack(builtTrack);
    hud.onMapChanged();
    refreshLobbyPreview();
    lobbyFocus = { type: 'tour', until: performance.now() + 7000 };
    audio.setMusic('lobby', game.mapId);
    audio.play('select');
  });

  game.on('playerJoined', refreshLobbyPreview);
  game.on('playerLeft', refreshLobbyPreview);
  game.on('playerLookChanged', ({ player }) => {
    refreshLobbyPreview();
    lobbyFocus = { type: 'kart', slot: player.slot, until: performance.now() + 4000 };
    audio.play('select');
  });

  // HUD 大廳上的滑鼠點選（地圖卡片、造型切換按鈕）
  hud.onMapSelect = (mapId) => game.setMap(mapId);
  hud.onDifficultySelect = (id) => game.setDifficulty(id);
  game.on('difficultyChanged', () => audio.play('select'));
  hud.onLookAction = (playerId, action) => {
    if (action === 'kartPrev') game.cyclePlayerKart(playerId, -1);
    else if (action === 'kartNext') game.cyclePlayerKart(playerId, 1);
    else if (action === 'paintNext') game.cyclePlayerPaint(playerId, 1);
    else if (action === 'driverPrev') game.cyclePlayerDriver(playerId, -1);
    else if (action === 'driverNext') game.cyclePlayerDriver(playerId, 1);
  };

  // 8. 狀態切換時動態掛載/卸載車輛 3D 視覺
  game.on('stateChanged', ({ state }) => {
    // 配樂：大廳輕鬆版 → 倒數靜音（只聽引擎催油門）→ 比賽 → 結算停止
    if (state === 'lobby') audio.setMusic('lobby', game.mapId);
    else if (state === 'racing') audio.setMusic('race', game.mapId);
    else audio.setMusic('off', game.mapId);
    if (state !== 'countdown' && state !== 'racing') audio.stopVehicles();

    if (state === 'countdown') {
      clearLobbyPreview();
      chaseCameras.forEach((c) => c.reset());
      for (const racer of game.racers) {
        if (racer.car) {
          racer.car.attachView(scene, assets, racer.color);
        }
      }
    } else if (state === 'lobby') {
      for (const racer of game.racers) {
        if (racer.car) {
          racer.car.detachView();
        }
      }
      hud.clearLabels();
      refreshLobbyPreview();
    }
  });

  // 9. 鍵盤加入/退出與按鍵監聽
  const keyboardPlayers = new Map();

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;

    const state = game.state;

    if (state === 'lobby') {
      // 地圖選擇：數字鍵 1~N 直接選，Tab 切換下一張
      const digit = /^Digit([1-9])$/.exec(e.code) || /^Numpad([1-9])$/.exec(e.code);
      if (digit) {
        const map = MAPS[Number(digit[1]) - 1];
        if (map) game.setMap(map.id);
      }
      if (e.code === 'Tab') {
        e.preventDefault();
        game.cycleMap(e.shiftKey ? -1 : 1);
      }
      // 難度：Q 切換（簡單 → 普通 → 困難）
      if (e.code === 'KeyQ') game.cycleDifficulty(1);

      // 造型選擇：已加入的鍵盤玩家用自己的方向鍵切換角色、Shift 切換顏色
      KEYBOARD_LAYOUTS.forEach((layout) => {
        const p = keyboardPlayers.get(layout.id);
        if (!p || !layout.lobbyKart) return;
        if (layout.lobbyKart.prev.includes(e.code)) game.cyclePlayerKart(p.id, -1);
        if (layout.lobbyKart.next.includes(e.code)) game.cyclePlayerKart(p.id, 1);
        if (layout.lobbyPaint.includes(e.code)) game.cyclePlayerPaint(p.id, 1);
        // 已經加入的玩家再按一次加入鍵（↑ / W）= 換車手
        if (layout.up.includes(e.code)) game.cyclePlayerDriver(p.id, 1);
      });

      // 玩家 1 加入（方向鍵配置）
      if (e.code === 'ArrowUp') {
        if (!keyboardPlayers.has('arrows')) {
          const input = new KeyboardInput(KEYBOARD_LAYOUTS[0], window);
          const p = game.addPlayer({
            name: KEYBOARD_LAYOUTS[0].name,
            kind: 'keyboard',
            input,
          });
          if (p) {
            keyboardPlayers.set('arrows', p);
          } else {
            input.destroy();
          }
        }
      }

      // 玩家 1 退出
      if (e.code === 'ArrowDown') {
        if (keyboardPlayers.has('arrows')) {
          const p = keyboardPlayers.get('arrows');
          game.removePlayer(p.id);
          p.input?.destroy?.();
          keyboardPlayers.delete('arrows');
        }
      }

      // 玩家 2 加入（WASD 配置）
      if (e.code === 'KeyW') {
        if (!keyboardPlayers.has('wasd')) {
          const input = new KeyboardInput(KEYBOARD_LAYOUTS[1], window);
          const p = game.addPlayer({
            name: KEYBOARD_LAYOUTS[1].name,
            kind: 'keyboard',
            input,
          });
          if (p) {
            keyboardPlayers.set('wasd', p);
          } else {
            input.destroy();
          }
        }
      }

      // 玩家 2 退出
      if (e.code === 'KeyS') {
        if (keyboardPlayers.has('wasd')) {
          const p = keyboardPlayers.get('wasd');
          game.removePlayer(p.id);
          p.input?.destroy?.();
          keyboardPlayers.delete('wasd');
        }
      }

      // 開始比賽
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        if (game.players.size === 0) {
          const input = new KeyboardInput(KEYBOARD_LAYOUTS[0], window);
          const p = game.addPlayer({
            name: KEYBOARD_LAYOUTS[0].name,
            kind: 'keyboard',
            input,
          });
          if (p) {
            keyboardPlayers.set('arrows', p);
          } else {
            input.destroy();
          }
        }
        game.startRace();
      }
    } else if (state === 'racing' || state === 'countdown') {
      if (e.code === 'Escape') {
        game.backToLobby();
      }
    } else if (state === 'results') {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        game.backToLobby();
      }
    }
  });

  // 10. 初始化網路介面（第一階段空殼）
  initNetwork(game);

  // 11. 監聽視窗縮放
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  });

  // 12. 主動畫渲染迴圈
  let lastTimestamp = null;

  function animate(timestamp) {
    requestAnimationFrame(animate);

    if (lastTimestamp == null) {
      lastTimestamp = timestamp;
      return;
    }

    const realDt = Math.min((timestamp - lastTimestamp) / 1000, 0.1);
    lastTimestamp = timestamp;

    // 核心物理步長推進
    game.update(realDt);

    // 每幀 3D 模型視圖同步
    if (game.state === 'racing' || game.state === 'countdown') {
      for (const racer of game.racers) {
        if (racer.car) {
          racer.car.syncView(realDt);
        }
      }
    }

    game.itemSystem.syncView(realDt);
    game.track.updateWeather?.(realDt);
    if (game.state === 'lobby') {
      refreshLobbyPreview();
      for (const car of lobbyPreviewCars) car.syncView(realDt);
    }
    hud.update();

    // 車輛持續音（引擎、甩尾、煞車、草地）：每位上場真人一組，倒數時可以空踩油門催引擎
    if (game.state === 'racing' || game.state === 'countdown') {
      const countdown = game.state === 'countdown';
      const list = [];
      for (const racer of game.viewRacers || []) {
        const car = racer.car;
        if (!car) continue;
        const maxSpeed = CONFIG.MAX_SPEED * (car.stats?.maxSpeedMult || 1);
        list.push({
          id: racer.id,
          speed: car.speed,
          speedRatio: Math.abs(car.speed) / maxSpeed,
          throttle: countdown ? (racer.lastThrottle ?? 0) : car.throttleInput,
          brake: car.brakeInput,
          skidding: car.isDrifting || car.spinTimer > 0,
          driftLevel: car.driftLevel,
          offroad: car.isOffroad,
          grounded: car.grounded,
          boosting: car.boostTimer > 0,
          revving: countdown,
          pan: panForRacer(racer),
        });
      }
      audio.updateVehicles(list);
    }

    // 6.1: 陰影每幀只更新一次
    renderer.shadowMap.needsUpdate = true;

    const W = window.innerWidth;
    const H = window.innerHeight;
    const state = game.state;

    if (state === 'racing' || state === 'countdown') {
      const viewRacers = game.viewRacers || [];
      const humanCount = viewRacers.length;

      if (humanCount === 0) {
        // 0 人（無頭測試或除錯）：全螢幕全場俯視（算繪前暫時關閉 fog 避免被霧洗白）
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, W, H);
        overviewCamera.camera.aspect = W / H;
        overviewCamera.camera.updateProjectionMatrix();
        overviewCamera.updateOverview();
        scene.fog = null;
        renderer.render(scene, overviewCamera.camera);
        scene.fog = defaultFog;
      } else {
        // 1~4 人自動分割畫面追尾渲染
        const rects = getViewportRects(humanCount, W, H);
        renderer.setScissorTest(true);

        for (let i = 0; i < rects.length; i++) {
          const rect = rects[i];
          renderer.setViewport(rect.x, rect.y, rect.w, rect.h);
          renderer.setScissor(rect.x, rect.y, rect.w, rect.h);

          if (i < humanCount) {
            const racer = viewRacers[i];
            const chaseCam = chaseCameras[racer.slot];
            chaseCam.camera.aspect = rect.w / rect.h;
            chaseCam.camera.updateProjectionMatrix();
            chaseCam.update(realDt, racer.car);
            scene.fog = defaultFog;
            renderer.render(scene, chaseCam.camera);
          } else {
            // 3 人模式下的第 4 格：全場俯視（算繪前暫時關閉 fog 避免被霧洗白）
            overviewCamera.camera.aspect = rect.w / rect.h;
            overviewCamera.camera.updateProjectionMatrix();
            overviewCamera.updateOverview();
            scene.fog = null;
            renderer.render(scene, overviewCamera.camera);
            scene.fog = defaultFog;
          }
        }

        renderer.setScissorTest(false);
      }
    } else if (state === 'lobby') {
      // 大廳：全螢幕慢速環繞起點（算繪前暫時關閉 fog 避免被霧洗白）
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, W, H);
      overviewCamera.camera.aspect = W / H;
      overviewCamera.camera.updateProjectionMatrix();
      // 寬螢幕時把展示焦點往右移，左側留給大廳選單
      const focus = lobbyFocusTarget();
      updatePreviewLabels(focus);
      overviewCamera.updateLobby(realDt, W >= 1100 ? 0.2 : 0, focus);
      scene.fog = null;
      renderer.render(scene, overviewCamera.camera);
      scene.fog = defaultFog;
    } else {
      // 結算畫面：全螢幕全場俯視（算繪前暫時關閉 fog 避免被霧洗白）
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, W, H);
      overviewCamera.camera.aspect = W / H;
      overviewCamera.camera.updateProjectionMatrix();
      overviewCamera.updateOverview();
      scene.fog = null;
      renderer.render(scene, overviewCamera.camera);
      scene.fog = defaultFog;
    }
  }

  requestAnimationFrame(animate);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
