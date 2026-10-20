// ============================================================
//  main.js — 遊戲主程式啟動與主迴圈
//  負責初始化 Three.js 場景、固定範圍全局日光陰影相機、
//  陸行鳥大賽車風格分割畫面追尾相機（ChaseCamera）與全場相機（OverviewCamera）、
//  資產載入進度、建立遊戲核心 Game 實例、掛載 HUD 與 WebAudio 音效，
//  並以 requestAnimationFrame 驅動畫面渲染（setScissorTest / setViewport / setScissor）。
// ============================================================

import * as THREE from 'three';
import { CONFIG, KEYBOARD_LAYOUTS } from './config.js';
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

  // 依賽道包圍盒配置陰影相機
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of game.track.points) {
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
  game.track.buildMeshes(scene, assets);
  game.itemSystem.attachView(scene, assets);

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
  const audio = new SoundSystem();

  game.on('sound', (type) => audio.play(type));

  // 8. 狀態切換時動態掛載/卸載車輛 3D 視覺
  game.on('stateChanged', ({ state }) => {
    if (state === 'countdown') {
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
    }
  });

  // 9. 鍵盤加入/退出與按鍵監聽
  const keyboardPlayers = new Map();

  window.addEventListener('keydown', (e) => {
    const state = game.state;

    if (state === 'lobby') {
      // 玩家 1 加入（方向鍵配置）
      if (e.code === 'ArrowUp') {
        if (!keyboardPlayers.has('arrows')) {
          const input = new KeyboardInput(KEYBOARD_LAYOUTS[0], window);
          const p = game.addPlayer({
            name: KEYBOARD_LAYOUTS[0].name,
            kind: 'keyboard',
            input,
          });
          if (p) keyboardPlayers.set('arrows', p);
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
          if (p) keyboardPlayers.set('wasd', p);
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
          if (p) keyboardPlayers.set('arrows', p);
        }
        game.startRace();
      }
    } else if (state === 'racing') {
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
    hud.update();

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
      overviewCamera.updateLobby(realDt);
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
