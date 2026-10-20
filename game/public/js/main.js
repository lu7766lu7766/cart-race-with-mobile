// ============================================================
//  main.js — 遊戲主程式啟動與主迴圈
//  負責初始化 Three.js 場景、燈光、陰影與相機，
//  驅動資產載入進度、建立遊戲核心 Game 實例、掛載 HUD 與 WebAudio 音效、
//  監聽大廳鍵盤加入控制，並以 requestAnimationFrame 驅動畫面渲染與邏輯步長。
// ============================================================

import * as THREE from 'three';
import { CONFIG, KEYBOARD_LAYOUTS } from './config.js';
import { Game } from './game.js';
import { AssetManager } from './assets.js';
import { RaceCamera } from './camera.js';
import { HUD } from './hud.js';
import { SoundSystem } from './audio.js';
import { KeyboardInput } from './input.js';
import { initNetwork } from './network.js';

async function bootstrap() {
  const container = document.getElementById('game-container') || document.body;
  const loadingScreen = document.getElementById('loading-screen');
  const progressBar = document.getElementById('loading-progress-bar');
  const progressText = document.getElementById('loading-progress-text');

  // 1. 初始化 Three.js 渲染器
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  // 2. 初始化 3D 場景與天空背景
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb); // 天空淺藍
  scene.fog = new THREE.FogExp2(0x87ceeb, 0.0025);

  // 3. 建立燈光系統（一盞開陰影的 DirectionalLight 日光 + 環境光）
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
  scene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight(0xffffff, 1.25);
  sunLight.position.set(60, 100, 40);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 320;
  sunLight.shadow.camera.left = -120;
  sunLight.shadow.camera.right = 120;
  sunLight.shadow.camera.top = 120;
  sunLight.shadow.camera.bottom = -120;
  scene.add(sunLight);
  scene.add(sunLight.target);

  // 4. 建立相機與智慧共用追蹤器
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 1000);
  const raceCamera = new RaceCamera(camera, sunLight);

  // 5. 載入 3D 模型素材
  const assets = new AssetManager();
  await assets.loadAll((progress) => {
    const pct = Math.floor(progress * 100);
    if (progressBar) progressBar.style.width = `${pct}%`;
    if (progressText) progressText.textContent = `載入素材中... ${pct}%`;
  });

  // 隱藏載入畫面
  if (loadingScreen) {
    loadingScreen.style.opacity = '0';
    setTimeout(() => {
      loadingScreen.style.display = 'none';
    }, 400);
  }

  // 6. 初始化遊戲核心
  const game = new Game();
  window.game = game; // 供控制台除錯檢測

  // 建立賽道路面與裝飾網格
  game.track.buildMeshes(scene, assets);
  game.itemSystem.attachView(scene, assets);

  // 7. 初始化 HUD 介面與音效系統
  const hudContainer = document.getElementById('hud-container') || container;
  const hud = new HUD(hudContainer, game);
  const audio = new SoundSystem();

  // 串接音效通知
  game.on('sound', (type) => audio.play(type));

  // 8. 狀態切換時動態掛載/卸載車輛 3D 視覺
  game.on('stateChanged', ({ state }) => {
    if (state === 'countdown') {
      // 開賽倒數：為所有參賽車建立 3D 視覺
      for (const racer of game.racers) {
        if (racer.car) {
          racer.car.attachView(scene, assets, racer.color);
        }
      }
    } else if (state === 'lobby') {
      // 返回大廳：清除所有賽車 3D 模型與標籤
      for (const racer of game.racers) {
        if (racer.car) {
          racer.car.detachView();
        }
      }
      hud.clearLabels();
    }
  });

  // 9. 鍵盤加入/退出與按鍵監聽
  const keyboardPlayers = new Map(); // layoutId -> player

  window.addEventListener('keydown', (e) => {
    const state = game.state;

    // 大廳按鍵控制
    if (state === 'lobby') {
      // 玩家 1（方向鍵配置）加入
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

      // 玩家 2（WASD 配置）加入
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

      // 按 Enter 開始比賽
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        // 若完全沒有真人加入，預設自動將玩家 1 加入
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
      // 比賽中按 Esc 放棄回大廳
      if (e.code === 'Escape') {
        game.backToLobby();
      }
    } else if (state === 'results') {
      // 結算畫面按 Enter 立即返回大廳
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        game.backToLobby();
      }
    }
  });

  // 10. 初始化網路介面（第一階段空殼）
  initNetwork(game);

  // 11. 監聽視窗尺寸改變
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  });

  // 12. requestAnimationFrame 主動畫迴圈（以 timestamp 計算真實 dt，相容 Three.js 新版規範）
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
    raceCamera.update(realDt, game.racers);
    hud.update(camera);

    renderer.render(scene, camera);
  }

  requestAnimationFrame(animate);
}

// 網頁載入完成後啟動遊戲
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
