// ============================================================
//  hud.js — 遊戲介面管理（大廳地圖選擇、造型選擇、倒數、分割畫面 HUD 面板、小地圖與結算）
//  支援分割畫面多鏡頭：依據 viewRacers 快照與 getViewportRects，
//  為每位真人賽車在對應螢幕格子疊加專屬 DOM 面板（名次、圈數、道具星星、速度表與甩尾火花條）。
//  已移除舊版 CSS2DRenderer，車頂姓名改由 3D 空間之 Sprite 渲染。
// ============================================================

import * as THREE from 'three';
import { CONFIG, KARTS, ITEMS, PAINTS, DRIVERS, DIFFICULTIES } from './config.js';
import { MAPS } from './maps.js';
import { Track } from './track.js';
import { formatTime, clamp, getViewportRects, escapeHtml } from './utils.js';

export class HUD {
  constructor(container, game) {
    this.container = container;
    this.game = game;
    this._lastQr = null;
    this._lastSlotsHtml = null;
    this._lastResultsHtml = null;

    // 由 main.js 設定的回呼：點選地圖卡片、點選造型按鈕
    this.onMapSelect = null;
    this.onDifficultySelect = null;
    this.onLookAction = null;

    // 建立 DOM 介面元素結構
    this._createDOM();

    // 監聽視窗縮放
    window.addEventListener('resize', () => {
      this._updateLayout();
      this._drawMinimapStatic();
    });

    // 繪製小地圖靜態賽道路線
    this._drawMinimapStatic();
  }

  // 建立全域 HUD DOM 容器
  _createDOM() {
    this.root = document.createElement('div');
    this.root.className = 'hud-root';

    // 1. 大廳層（Lobby Screen）
    this.lobbyEl = document.createElement('div');
    this.lobbyEl.className = 'screen lobby-screen';
    this.lobbyEl.innerHTML = `
      <div class="lobby-card">
        <h1 class="game-title">🏁 KART RACER</h1>
        <div class="room-info-box">
          <div class="room-code-label">房間號碼</div>
          <div class="room-code-value" id="roomCode">----</div>
          <div class="room-status-note" id="roomNote">本機模式：第二階段開放手機加入</div>
          <div class="room-qr-box" id="roomQr" style="display:none;"></div>
          <div class="room-url" id="roomUrl" style="display:none;"></div>
          <div class="room-message" id="roomMsg"></div>
        </div>
        <div class="lobby-section-title">🗺️ 選擇地圖 <span class="lobby-section-hint">按 1 / 2 / 3 或 Tab，也可以用滑鼠點</span></div>
        <div class="map-select" id="mapSelect"></div>
        <div class="lobby-section-title">🎚️ 難度 <span class="lobby-section-hint">按 Q 切換，也可以用滑鼠點</span></div>
        <div class="difficulty-select" id="difficultySelect">
          ${DIFFICULTIES.map((d) => `
            <button class="difficulty-chip" data-difficulty="${d.id}" tabindex="-1">
              <span class="difficulty-name">${d.emoji} ${d.name}</span>
              <span class="difficulty-desc">${d.desc}</span>
            </button>
          `).join('')}
        </div>
        <div class="lobby-section-title">🏎️ 參賽車手與造型</div>
        <div class="slots-container" id="playerSlots"></div>
        <div class="lobby-controls-help">
          <p>⌨️ 玩家 1：按 <strong>↑</strong> 加入（再按 ↑ 換車手），<strong>← →</strong> 換角色、<strong>右Shift</strong> 換顏色</p>
          <p>⌨️ 玩家 2：按 <strong>W</strong> 加入（再按 W 換車手），<strong>A D</strong> 換角色、<strong>左Shift</strong> 換顏色</p>
          <p>📱 手機玩家：加入後直接在手機上選角色、車手與顏色（有 3D 預覽）</p>
          <p class="audio-state" id="audioState">🔊 M 靜音　🎵 B 背景音樂</p>
          <p class="start-hint">按 <strong>Enter</strong> 開始比賽！</p>
        </div>
      </div>
    `;
    this.root.appendChild(this.lobbyEl);

    // 地圖卡片只建立一次（裡面有縮圖畫布），之後每幀只切換 active 樣式
    this._buildMapCards();

    // 大廳滑鼠點選（事件委派：卡片每次重繪都不必重新綁定）
    this.lobbyEl.addEventListener('click', (e) => {
      const diffBtn = e.target.closest('[data-difficulty]');
      if (diffBtn) {
        diffBtn.blur();
        this.onDifficultySelect?.(diffBtn.dataset.difficulty);
        return;
      }
      const mapBtn = e.target.closest('[data-map]');
      if (mapBtn) {
        mapBtn.blur();
        this.onMapSelect?.(mapBtn.dataset.map);
        return;
      }
      const lookBtn = e.target.closest('[data-action]');
      if (lookBtn) {
        lookBtn.blur();
        this.onLookAction?.(lookBtn.dataset.player, lookBtn.dataset.action);
      }
    });

    // 2. 倒數層（Countdown Overlay）
    this.countdownEl = document.createElement('div');
    this.countdownEl.className = 'countdown-overlay';
    this.countdownEl.style.display = 'none';
    this.root.appendChild(this.countdownEl);

    // 3. 比賽中層（Racing HUD）
    this.racingEl = document.createElement('div');
    this.racingEl.className = 'screen racing-screen';
    this.racingEl.style.display = 'none';

    // 頂部全場比賽計時
    this.timerEl = document.createElement('div');
    this.timerEl.className = 'race-timer';
    this.timerEl.textContent = '0:00.00';
    this.racingEl.appendChild(this.timerEl);

    // 分割畫面每格專屬面板容器
    this.cellPanelsContainer = document.createElement('div');
    this.cellPanelsContainer.className = 'cell-panels-container';
    this.cellPanels = [];

    for (let i = 0; i < CONFIG.MAX_PLAYERS; i++) {
      const panel = document.createElement('div');
      panel.className = 'cell-hud-panel';
      panel.style.display = 'none';
      panel.innerHTML = `
        <div class="cell-top-left">
          <div class="cell-pos">1st</div>
          <div class="cell-lap-col">
            <div class="cell-lap">LAP 1/3</div>
            <div class="cell-time" style="display:none;">0:00.00</div>
          </div>
        </div>
        <div class="cell-top-right">
          <div class="cell-item-box">
            <span class="cell-item-icon"></span>
            <span class="cell-item-stars"></span>
          </div>
        </div>
        <div class="cell-bottom-left">
          <div class="cell-speedo">
            <span class="cell-speed-num">0</span>
            <span class="cell-speed-unit">KM/H</span>
            <div class="cell-speed-bar-bg">
              <div class="cell-speed-bar-fill"></div>
            </div>
          </div>
        </div>
        <div class="cell-bottom-center">
          <div class="cell-drift-meter" style="display:none;">
            <div class="cell-drift-bar-fill"></div>
          </div>
        </div>
        <div class="cell-player-tag" style="display:none;">
          <span class="cell-player-num"></span>
          <span class="cell-player-name"></span>
        </div>
        <div class="cell-hit-flash" style="display:none;"></div>
        <div class="cell-wrong-way" style="display:none;">
          <div class="cell-wrong-way-icon">⟲</div>
          <div class="cell-wrong-way-text">逆向行駛！</div>
          <div class="cell-wrong-way-sub">請掉頭往回開</div>
        </div>
        <div class="cell-finish-badge" style="display:none;">FINISH!</div>
      `;
      this.cellPanelsContainer.appendChild(panel);
      this.cellPanels.push(panel);
    }
    this.racingEl.appendChild(this.cellPanelsContainer);

    // 小地圖 Canvas
    this.minimapCanvas = document.createElement('canvas');
    this.minimapCanvas.className = 'minimap-canvas';
    this.minimapCanvas.width = 180;
    this.minimapCanvas.height = 110;
    this.minimapCtx = this.minimapCanvas.getContext('2d');
    this.racingEl.appendChild(this.minimapCanvas);

    // 全場俯視格的玩家標記層（3 人模式第 4 格：在 3D 俯視畫面上疊大號碼圓點與名字）
    this.overviewCanvas = document.createElement('canvas');
    this.overviewCanvas.className = 'overview-marker-canvas';
    this.overviewCanvas.style.display = 'none';
    this.overviewCtx = this.overviewCanvas.getContext('2d');
    this.racingEl.appendChild(this.overviewCanvas);
    this.overviewCamera = null;

    this.root.appendChild(this.racingEl);

    // 4. 結算層（Results Screen）
    this.resultsEl = document.createElement('div');
    this.resultsEl.className = 'screen results-screen';
    this.resultsEl.style.display = 'none';
    this.resultsEl.innerHTML = `
      <div class="results-card">
        <h2>🏆 比賽結算</h2>
        <table class="results-table">
          <thead>
            <tr>
              <th>名次</th>
              <th>玩家</th>
              <th>總成績</th>
              <th>最佳單圈</th>
            </tr>
          </thead>
          <tbody id="resultsTbody"></tbody>
        </table>
        <div class="results-countdown" id="resultsCountdown">20 秒後返回大廳</div>
      </div>
    `;
    this.root.appendChild(this.resultsEl);

    this.container.appendChild(this.root);
  }

  // 繪製靜態小地圖軌跡
  _drawMinimapStatic() {
    if (!this.game || !this.game.track) return;
    const track = this.game.track;
    const canvas = this.minimapCanvas;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of track.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }

    const pad = 12;
    const w = maxX - minX;
    const h = maxZ - minZ;
    const scale = Math.min((canvas.width - pad * 2) / w, (canvas.height - pad * 2) / h);

    this.minimapTransform = {
      scale,
      offsetX: canvas.width / 2 - ((minX + maxX) / 2) * scale,
      offsetZ: canvas.height / 2 - ((minZ + maxZ) / 2) * scale,
    };
  }

  // 建立地圖卡片：俯視縮圖（路面依高度上色、標出特殊路段與跳台）＋ 數據 ＋ 特色標籤
  _buildMapCards() {
    const mapEl = this.root.querySelector('#mapSelect');
    if (!mapEl) return;
    this._mapCards = [];
    MAPS.forEach((m, i) => {
      const track = new Track(m.id);
      let minH = Infinity, maxH = -Infinity;
      for (const h of track.height) { minH = Math.min(minH, h); maxH = Math.max(maxH, h); }

      const card = document.createElement('button');
      card.className = 'map-card';
      card.dataset.map = m.id;
      card.tabIndex = -1;
      card.innerHTML = `
        <canvas class="map-thumb" width="200" height="104"></canvas>
        <span class="map-name">${m.emoji} ${i + 1}. ${escapeHtml(m.name)}</span>
        <span class="map-stars" title="賽道難度">${'★'.repeat(m.stars || 1)}${'☆'.repeat(3 - (m.stars || 1))} ${['', '入門', '中級', '高手'][m.stars || 1]}</span>
        <span class="map-stats">全長 ${Math.round(track.length)}・落差 ${Math.round(maxH - minH)}m・路寬 ${track.width}</span>
        <span class="map-features">${(m.features || []).map((f) => `<i>${escapeHtml(f)}</i>`).join('')}</span>
        <span class="map-desc">${escapeHtml(m.description)}</span>
      `;
      this._drawMapThumb(card.querySelector('canvas'), track, minH, maxH);
      mapEl.appendChild(card);
      this._mapCards.push(card);
    });
  }

  _drawMapThumb(canvas, track, minH, maxH) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const theme = track.theme;
    const hex = (n) => '#' + new THREE.Color(n).getHexString();

    // 背景：地形顏色漸層（低處 → 高處）
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, hex(theme.terrain?.colorLow ?? theme.ground));
    bg.addColorStop(1, hex(theme.terrain?.colorHigh ?? theme.ground));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of track.points) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const pad = 10;
    const scale = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxZ - minZ));
    const ox = W / 2 - ((minX + maxX) / 2) * scale;
    const oz = H / 2 - ((minZ + maxZ) / 2) * scale;
    const px = (i) => track.points[i].x * scale + ox;
    const pz = (i) => track.points[i].z * scale + oz;
    const roadW = Math.max(3, track.width * scale * 1.6);
    const N = track.N;

    const strokeRange = (from, to, color, width) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px(from % N), pz(from % N));
      for (let k = from + 1; k <= to; k++) ctx.lineTo(px(k % N), pz(k % N));
      ctx.stroke();
    };

    // 峽谷：路的兩側畫深色岩壁
    for (const z of track.zones) {
      if (z.type === 'canyon') strokeRange(z.start, z.end + (z.end < z.start ? N : 0), '#6e2c14', roadW + 7);
    }
    // 外框（深色描邊）
    strokeRange(0, N, 'rgba(0,0,0,0.55)', roadW + 2);
    // 路面依高度上色：低處淺灰 → 高處橘紅
    const low = new THREE.Color(0xdfe6e9);
    const high = new THREE.Color(0xff6b35);
    const c = new THREE.Color();
    for (let i = 0; i < N; i += 3) {
      const k = maxH > minH ? (track.height[i] - minH) / (maxH - minH) : 0;
      c.copy(low).lerp(high, k);
      strokeRange(i, i + 3, '#' + c.getHexString(), roadW);
    }
    // 特殊路段
    const zoneColor = { sand: '#f6b93b', ice: '#74b9ff', tunnel: '#2d3436' };
    for (const z of track.zones) {
      if (zoneColor[z.type]) strokeRange(z.start, z.end + (z.end < z.start ? N : 0), zoneColor[z.type], roadW * (z.type === 'tunnel' ? 1.5 : 1));
    }
    // 跳台（紅點）
    for (const j of track.jumps) {
      ctx.fillStyle = '#ff3838';
      ctx.beginPath();
      ctx.arc(px(j.index), pz(j.index), 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    // 起點（黑白方塊）
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px(0) - 4, pz(0) - 4, 8, 8);
    ctx.fillStyle = '#111111';
    ctx.fillRect(px(0) - 4, pz(0) - 4, 4, 4);
    ctx.fillRect(px(0), pz(0), 4, 4);
  }

  // 換地圖後重新計算小地圖比例
  onMapChanged() {
    this._drawMinimapStatic();
  }

  // 顯示目前的靜音與背景音樂狀態
  setAudioState({ muted, music }) {
    const el = this.root.querySelector('#audioState');
    if (!el) return;
    el.textContent = `${muted ? '🔇 已靜音（按 M 開啟）' : '🔊 按 M 靜音'}　${music ? '🎵 按 B 關閉背景音樂' : '🎵 背景音樂已關閉（按 B 開啟）'}`;
  }

  // 由 main.js 傳入全場俯視相機，供標記層把 3D 座標投影到畫面
  setOverviewCamera(camera) {
    this.overviewCamera = camera;
  }

  // 依真人數量與視窗尺寸調整小地圖定位
  _updateLayout() {
    const viewRacers = this.game.viewRacers || [];
    const count = viewRacers.length;

    if (count <= 1) {
      // 1 人時小地圖放右下角
      this.minimapCanvas.style.display = 'block';
      this.minimapCanvas.classList.remove('center-mode');
      this.minimapCanvas.classList.add('corner-mode');
    } else if (count === 3) {
      // 3 人時不顯示小地圖（第 4 格全場俯視鏡頭本身就是地圖）
      this.minimapCanvas.style.display = 'none';
      this.minimapCanvas.classList.remove('corner-mode');
      this.minimapCanvas.classList.remove('center-mode');
    } else {
      // 2、4 人分割畫面時小地圖置於十字交界正中央
      this.minimapCanvas.style.display = 'block';
      this.minimapCanvas.classList.remove('corner-mode');
      this.minimapCanvas.classList.add('center-mode');
    }
  }

  // 每幀更新 HUD
  update() {
    const state = this.game.state;

    this.lobbyEl.style.display = state === 'lobby' ? 'flex' : 'none';
    const showCountdown = state === 'countdown' || (state === 'racing' && this.game.raceTime < 0.8);
    this.countdownEl.style.display = showCountdown ? 'flex' : 'none';
    this.racingEl.style.display = (state === 'racing' || state === 'countdown') ? 'block' : 'none';
    this.resultsEl.style.display = state === 'results' ? 'flex' : 'none';

    if (state === 'lobby') {
      this._updateLobby();
    } else if (state === 'countdown') {
      this._updateCountdown();
      this._updateRacingHUD();
    } else if (state === 'racing') {
      if (this.game.raceTime < 0.8) {
        this._updateCountdown();
      }
      this._updateRacingHUD();
    } else if (state === 'results') {
      this._updateResults();
    }
  }

  // 更新大廳資訊與 6.6 角色被動能力說明
  _updateLobby() {
    const roomInfo = this.game.roomInfo;
    const roomCodeEl = this.root.querySelector('#roomCode');
    const roomNoteEl = this.root.querySelector('#roomNote');
    const roomQrEl = this.root.querySelector('#roomQr');
    const roomUrlEl = this.root.querySelector('#roomUrl');
    const roomMsgEl = this.root.querySelector('#roomMsg');

    if (roomCodeEl) roomCodeEl.textContent = roomInfo.code || '----';
    if (roomNoteEl) {
      roomNoteEl.textContent = roomInfo.code ? '用手機掃描或輸入房號加入' : '本機模式：第二階段開放手機加入';
    }
    if (roomQrEl) {
      if (roomInfo.qrSvg) {
        roomQrEl.style.display = 'block';
        if (this._lastQr !== roomInfo.qrSvg) {
          roomQrEl.innerHTML = roomInfo.qrSvg;
          this._lastQr = roomInfo.qrSvg;
        }
      } else {
        roomQrEl.style.display = 'none';
        roomQrEl.innerHTML = '';
        this._lastQr = null;
      }
    }
    if (roomUrlEl) {
      if (roomInfo.url) {
        roomUrlEl.style.display = 'block';
        roomUrlEl.textContent = roomInfo.url;
      } else {
        roomUrlEl.style.display = 'none';
        roomUrlEl.textContent = '';
      }
    }
    if (roomMsgEl) roomMsgEl.textContent = roomInfo.message || '';

    const slotsEl = this.root.querySelector('#playerSlots');
    if (!slotsEl) return;

    // 難度：標示目前選擇
    for (const chip of this.root.querySelectorAll('[data-difficulty]')) {
      chip.classList.toggle('active', chip.dataset.difficulty === this.game.difficulty);
    }

    // 地圖選擇卡片：標示目前選擇的地圖
    if (this._mapCards) {
      for (const card of this._mapCards) {
        card.classList.toggle('active', card.dataset.map === this.game.mapId);
      }
    }

    // 參賽名單（真人顯示自己選的造型；空位顯示電腦補位會使用的造型）
    let html = '';
    for (const entry of this.game.getLobbyRoster()) {
      const human = entry.human;
      const kart = KARTS[entry.kart] || KARTS[0];
      const paint = PAINTS[entry.paint] || PAINTS[0];
      const tagTextColor = (paint.hex === '#f5f6fa' || paint.hex === '#f1c40f') ? '#222' : '#fff';
      const driver = DRIVERS[entry.driver] || DRIVERS[0];
      const driverLine = `<div class="slot-driver">${driver.emoji} 車手：${driver.name}（${driver.title}）</div>`;

      if (human) {
        const icon = human.kind === 'remote' ? '📱' : '⌨️';
        const keyHint = human.kind === 'remote' ? '在手機上換造型' : '';
        html += `
          <div class="player-slot joined" style="border-left: 6px solid ${paint.hex}">
            <div class="slot-main">
              <span class="slot-icon">${icon}</span>
              <span class="slot-name">${escapeHtml(human.name)}</span>
              <span class="slot-color-tag" style="background:${paint.hex};color:${tagTextColor}">${paint.name}</span>
            </div>
            <div class="slot-ability">
              <span class="char-title">${kart.emoji} ${kart.character}</span>：${kart.ability}
            </div>
            ${driverLine}
            <div class="slot-look-actions">
              <button data-player="${human.id}" data-action="kartPrev" tabindex="-1">◀</button>
              <span class="look-label">角色</span>
              <button data-player="${human.id}" data-action="kartNext" tabindex="-1">▶</button>
              <button data-player="${human.id}" data-action="driverPrev" tabindex="-1">◀</button>
              <span class="look-label">車手</span>
              <button data-player="${human.id}" data-action="driverNext" tabindex="-1">▶</button>
              <button data-player="${human.id}" data-action="paintNext" tabindex="-1">🎨</button>
              <span class="look-hint">${keyHint}</span>
            </div>
          </div>
        `;
      } else {
        html += `
          <div class="player-slot ai-fallback" style="border-left: 6px solid ${paint.hex}">
            <div class="slot-main">
              <span class="slot-icon">🤖</span>
              <span class="slot-name">電腦補位</span>
              <span class="slot-color-tag" style="background:${paint.hex};color:${tagTextColor}">${paint.name}</span>
            </div>
            <div class="slot-ability">
              <span class="char-title">${kart.emoji} ${kart.character}</span>：${kart.ability}
            </div>
            ${driverLine}
          </div>
        `;
      }
    }
    if (this._lastSlotsHtml !== html) {
      slotsEl.innerHTML = html;
      this._lastSlotsHtml = html;
    }
  }

  // 更新倒數大字（包含進入 racing 0.8 秒內顯示 GO!）
  _updateCountdown() {
    if (this.game.state === 'racing') {
      this.countdownEl.textContent = 'GO!';
    } else {
      const val = this.game.countdownValue;
      this.countdownEl.textContent = val > 0 ? val.toString() : 'GO!';
    }
  }

  // 格式化名次序數大字（1st, 2nd, 3rd, 4th）
  _formatOrdinal(pos) {
    if (!pos) return '-';
    if (pos === 1) return '1st';
    if (pos === 2) return '2nd';
    if (pos === 3) return '3rd';
    return `${pos}th`;
  }

  // 更新比賽中分割畫面每格 HUD 面板
  _updateRacingHUD() {
    this._updateLayout();

    const viewRacers = this.game.viewRacers || [];
    const count = Math.max(1, viewRacers.length);
    const W = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const H = typeof window !== 'undefined' ? window.innerHeight : 720;
    const rects = getViewportRects(count, W, H);

    // 1 人時維持正上方中央全域計時器；2 人以上分割畫面不顯示全域計時器（改在每格左上面板顯示）
    const isSplit = count >= 2;
    if (isSplit) {
      this.timerEl.style.display = 'none';
    } else {
      this.timerEl.style.display = 'block';
      this.timerEl.textContent = formatTime(this.game.raceTime);
    }

    // 計算小地圖在畫面中央時的邊界矩形（供各格判斷角落貼合與面板動態避讓）
    const hasCenterMinimap = (count === 2 || count === 4) && this.minimapCanvas.style.display !== 'none';
    const mmW = this.minimapCanvas.width || 180;
    const mmH = this.minimapCanvas.height || 110;
    const mmRect = {
      left: (W - mmW) / 2,
      right: (W + mmW) / 2,
      top: (H - mmH) / 2,
      bottom: (H + mmH) / 2,
    };

    const icons = ['⚡', '🍌', '🚀', '🛡️'];

    // 依據 viewRacers 更新每一格追尾視角疊層面板
    for (let i = 0; i < CONFIG.MAX_PLAYERS; i++) {
      const panel = this.cellPanels[i];
      const racer = viewRacers[i];

      if (!racer || !racer.car || i >= rects.length) {
        panel.style.display = 'none';
        continue;
      }

      panel.style.display = 'block';
      const r = rects[i];
      panel.style.left = `${r.x}px`;
      panel.style.top = `${r.top}px`;
      panel.style.width = `${r.w}px`;
      panel.style.height = `${r.h}px`;

      // 取得各角主要面板元件
      const posLapEl = panel.querySelector('.cell-top-left');
      const itemBoxEl = panel.querySelector('.cell-top-right');
      const speedoEl = panel.querySelector('.cell-bottom-left');

      // 幾何判斷：使用 getViewportRects 計算出的此格四角座標，比對是否貼齊中央小地圖矩形
      const cellLeft = r.x;
      const cellRight = r.x + r.w;
      const cellTop = r.top;
      const cellBottom = r.top + r.h;

      const pointInRect = (px, py, rect) => (
        px >= rect.left - 5 && px <= rect.right + 5 &&
        py >= rect.top - 5 && py <= rect.bottom + 5
      );

      const centerTouchesTopLeft = hasCenterMinimap && pointInRect(cellLeft, cellTop, mmRect);
      const centerTouchesTopRight = hasCenterMinimap && pointInRect(cellRight, cellTop, mmRect);
      const centerTouchesBottomLeft = hasCenterMinimap && pointInRect(cellLeft, cellBottom, mmRect);
      const centerTouchesBottomRight = hasCenterMinimap && pointInRect(cellRight, cellBottom, mmRect);

      // 動態調整面板位置，避開貼齊畫面中央的角落
      if (centerTouchesBottomLeft) {
        // 右上格：左下角貼齊中心，原在左下角的速度表水平翻轉至右下角
        if (posLapEl) {
          posLapEl.style.top = '12px'; posLapEl.style.left = '12px';
          posLapEl.style.right = 'auto'; posLapEl.style.bottom = 'auto';
        }
        if (itemBoxEl) {
          itemBoxEl.style.top = '12px'; itemBoxEl.style.right = '12px';
          itemBoxEl.style.left = 'auto'; itemBoxEl.style.bottom = 'auto';
        }
        if (speedoEl) {
          speedoEl.style.bottom = '12px'; speedoEl.style.right = '12px';
          speedoEl.style.left = 'auto'; speedoEl.style.top = 'auto';
        }
      } else if (centerTouchesTopRight) {
        // 左下格：右上角貼齊中心，原在右上角的道具格水平翻轉至左上角，並堆疊於名次圈數下方
        const stackTop = posLapEl?.offsetHeight ? `${12 + posLapEl.offsetHeight + 8}px` : '70px';
        if (posLapEl) {
          posLapEl.style.top = '12px'; posLapEl.style.left = '12px';
          posLapEl.style.right = 'auto'; posLapEl.style.bottom = 'auto';
        }
        if (itemBoxEl) {
          itemBoxEl.style.top = stackTop; itemBoxEl.style.left = '12px';
          itemBoxEl.style.right = 'auto'; itemBoxEl.style.bottom = 'auto';
        }
        if (speedoEl) {
          speedoEl.style.bottom = '12px'; speedoEl.style.left = '12px';
          speedoEl.style.right = 'auto'; speedoEl.style.top = 'auto';
        }
      } else if (centerTouchesTopLeft) {
        // 右下格：左上角貼齊中心，原在左上角的名次圈數水平翻轉至右上角，道具格堆疊於其下方
        const stackTop = posLapEl?.offsetHeight ? `${12 + posLapEl.offsetHeight + 8}px` : '70px';
        if (posLapEl) {
          posLapEl.style.top = '12px'; posLapEl.style.right = '12px';
          posLapEl.style.left = 'auto'; posLapEl.style.bottom = 'auto';
        }
        if (itemBoxEl) {
          itemBoxEl.style.top = stackTop; itemBoxEl.style.right = '12px';
          itemBoxEl.style.left = 'auto'; itemBoxEl.style.bottom = 'auto';
        }
        if (speedoEl) {
          speedoEl.style.bottom = '12px'; speedoEl.style.left = '12px';
          speedoEl.style.right = 'auto'; speedoEl.style.top = 'auto';
        }
      } else {
        // 預設配置（左上格、單人、雙人或 3 人無中央小地圖時）
        if (posLapEl) {
          posLapEl.style.top = '12px'; posLapEl.style.left = '12px';
          posLapEl.style.right = 'auto'; posLapEl.style.bottom = 'auto';
        }
        if (itemBoxEl) {
          itemBoxEl.style.top = '12px'; itemBoxEl.style.right = '12px';
          itemBoxEl.style.left = 'auto'; itemBoxEl.style.bottom = 'auto';
        }
        if (speedoEl) {
          speedoEl.style.bottom = '12px'; speedoEl.style.left = '12px';
          speedoEl.style.right = 'auto'; speedoEl.style.top = 'auto';
        }
      }

      const car = racer.car;

      // 0. 分割畫面時以玩家顏色描邊整格，並在上方中央顯示號碼名牌（號碼同車尾旗與俯視圖標記）
      const tagEl = panel.querySelector('.cell-player-tag');
      if (isSplit) {
        panel.style.boxShadow = `inset 0 0 0 4px ${racer.color}`;
        tagEl.style.display = 'flex';
        tagEl.style.background = racer.color;
        tagEl.querySelector('.cell-player-num').textContent = String(racer.slot + 1);
        tagEl.querySelector('.cell-player-name').textContent = racer.name;
      } else {
        panel.style.boxShadow = 'none';
        tagEl.style.display = 'none';
      }

      // 1. 名次、圈數與分割畫面獨立比賽時間
      const posEl = panel.querySelector('.cell-pos');
      const lapEl = panel.querySelector('.cell-lap');
      const timeEl = panel.querySelector('.cell-time');
      if (posEl) posEl.textContent = this._formatOrdinal(racer.position);
      if (lapEl) {
        lapEl.textContent = car.finished ? '完賽' : `LAP ${car.lap}/${CONFIG.LAPS}`;
      }
      if (timeEl) {
        if (isSplit) {
          timeEl.style.display = 'block';
          timeEl.textContent = formatTime(this.game.raceTime);
        } else {
          timeEl.style.display = 'none';
        }
      }

      // 2. 道具格（含升級星星 ★ / ★★ / ★★★）
      const iconEl = panel.querySelector('.cell-item-icon');
      const starsEl = panel.querySelector('.cell-item-stars');
      if (iconEl && starsEl) {
        if (racer.rolling) {
          const rollIndex = Math.floor(Date.now() / 80) % icons.length;
          iconEl.textContent = icons[rollIndex];
          starsEl.textContent = '';
        } else if (racer.item && ITEMS[racer.item]) {
          iconEl.textContent = ITEMS[racer.item].icon;
          const stars = racer.itemLevel === 3 ? '★★★' : racer.itemLevel === 2 ? '★★' : '★';
          starsEl.textContent = stars;
        } else {
          iconEl.textContent = '';
          starsEl.textContent = '';
        }
      }

      // 3. 速度表
      const speedNumEl = panel.querySelector('.cell-speed-num');
      const speedFillEl = panel.querySelector('.cell-speed-bar-fill');
      const speedKmh = Math.max(0, Math.round(car.speed * 2.5));
      if (speedNumEl) speedNumEl.textContent = speedKmh.toString();
      if (speedFillEl) {
        const pct = clamp((car.speed / CONFIG.BOOST_SPEED) * 100, 0, 100);
        speedFillEl.style.width = `${pct}%`;
      }

      // 4. 甩尾火花集氣量表（藍 -> 橘 -> 紫）
      const driftMeter = panel.querySelector('.cell-drift-meter');
      const driftFill = panel.querySelector('.cell-drift-bar-fill');
      if (driftMeter && driftFill) {
        if (car.isDrifting && car.driftCharge > 0) {
          driftMeter.style.display = 'block';
          const chargePct = clamp((car.driftCharge / CONFIG.DRIFT_T3) * 100, 0, 100);
          driftFill.style.width = `${chargePct}%`;

          if (car.driftLevel === 3) {
            driftFill.style.background = 'linear-gradient(90deg, #9b59b6, #e056fd)';
          } else if (car.driftLevel === 2) {
            driftFill.style.background = 'linear-gradient(90deg, #e67e22, #f39c12)';
          } else {
            driftFill.style.background = 'linear-gradient(90deg, #3498db, #00d2d3)';
          }
        } else {
          driftMeter.style.display = 'none';
        }
      }

      // 5. 受擊紅框閃爍（獨立 0.3 秒計時）
      const flashEl = panel.querySelector('.cell-hit-flash');
      if (flashEl) {
        flashEl.style.display = (car.hitFlashTimer > 0) ? 'block' : 'none';
      }

      // 5-1. 逆向行駛警告
      const wrongWayEl = panel.querySelector('.cell-wrong-way');
      if (wrongWayEl) {
        wrongWayEl.style.display = car.wrongWay ? 'flex' : 'none';
      }

      // 6. 完賽大字徽章
      const finishBadge = panel.querySelector('.cell-finish-badge');
      if (finishBadge) {
        if (car.finished) {
          finishBadge.style.display = 'block';
          finishBadge.textContent = `FINISH! 第 ${racer.rank || racer.position} 名`;
        } else {
          finishBadge.style.display = 'none';
        }
      }
    }

    // 7. 小地圖繪製
    this._renderMinimap();

    // 8. 3 人模式第 4 格全場俯視的玩家標記
    if (count === 3 && rects[3]) {
      this._renderOverviewMarkers(rects[3]);
    } else {
      this.overviewCanvas.style.display = 'none';
    }
  }

  // 在全場俯視格疊上大號玩家標記（俯視鏡頭很遠，3D 車身只剩幾個像素）
  _renderOverviewMarkers(rect) {
    const cam = this.overviewCamera;
    if (!cam) return;

    const canvas = this.overviewCanvas;
    const ctx = this.overviewCtx;
    canvas.style.display = 'block';
    canvas.style.left = `${rect.x}px`;
    canvas.style.top = `${rect.top}px`;
    canvas.style.width = `${rect.w}px`;
    canvas.style.height = `${rect.h}px`;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.round(rect.w * dpr);
    const ch = Math.round(rect.h * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.w, rect.h);

    // 世界座標 → 此格畫面座標
    const toScreen = (x, y, z) => {
      const v = new THREE.Vector3(x, y, z).project(cam);
      return { x: (v.x + 1) / 2 * rect.w, y: (1 - v.y) / 2 * rect.h };
    };

    const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 180);
    const placedLabels = [];
    // AI 先畫、真人後畫，讓真人標記永遠在最上層
    const ordered = [...this.game.racers].sort((a, b) => (a.kind === 'ai' ? 0 : 1) - (b.kind === 'ai' ? 0 : 1));

    for (const r of ordered) {
      const car = r.car;
      if (!car) continue;
      const isHuman = r.kind !== 'ai';
      const p = toScreen(car.x, car.y + 1, car.z);
      const ahead = toScreen(car.x + Math.sin(car.heading) * 8, car.y + 1, car.z + Math.cos(car.heading) * 8);
      const ang = Math.atan2(ahead.y - p.y, ahead.x - p.x);
      const radius = isHuman ? 13 : 8;

      // 行進方向箭頭
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(radius + 10, 0);
      ctx.lineTo(radius - 1, -7);
      ctx.lineTo(radius - 1, 7);
      ctx.closePath();
      ctx.fillStyle = r.color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.restore();

      // 真人外圈脈動光環
      if (isHuman) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius + 4 + pulse * 6, 0, Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = r.color;
        ctx.globalAlpha = 0.35 + 0.4 * (1 - pulse);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // 號碼圓點
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = r.color;
      ctx.globalAlpha = isHuman ? 1 : 0.75;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = isHuman ? 3 : 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 ${isHuman ? 15 : 10}px sans-serif`;
      ctx.fillText(isHuman ? String(r.slot + 1) : 'AI', p.x, p.y + 1);

      // 真人名字標籤
      if (isHuman) {
        ctx.font = 'bold 13px sans-serif';
        const label = r.name;
        const tw = ctx.measureText(label).width + 14;
        // 兩位玩家靠太近時名字標籤往上堆疊，避免互相蓋住
        let ly = p.y - radius - 18;
        const overlaps = (y) => placedLabels.some((b) => Math.abs(b.x - p.x) < (b.w + tw) / 2 && Math.abs(b.y - y) < 22);
        while (overlaps(ly)) ly -= 22;
        placedLabels.push({ x: p.x, y: ly, w: tw });
        ctx.fillStyle = 'rgba(18, 20, 26, 0.85)';
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(p.x - tw / 2, ly - 10, tw, 20, 10) : ctx.rect(p.x - tw / 2, ly - 10, tw, 20);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = r.color;
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, p.x, ly + 1);
      }
    }
  }

  // 繪製動態小地圖
  _renderMinimap() {
    if (this.minimapCanvas.style.display === 'none') return;
    const canvas = this.minimapCanvas;
    const ctx = this.minimapCtx;
    const track = this.game.track;
    const tf = this.minimapTransform;
    if (!tf) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'rgba(20, 24, 34, 0.75)';
    ctx.roundRect ? ctx.roundRect(0, 0, canvas.width, canvas.height, 10) : ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fill();

    // 賽道線條
    ctx.beginPath();
    for (let i = 0; i < track.N; i++) {
      const p = track.points[i];
      const px = p.x * tf.scale + tf.offsetX;
      const pz = p.z * tf.scale + tf.offsetZ;
      if (i === 0) ctx.moveTo(px, pz);
      else ctx.lineTo(px, pz);
    }
    ctx.closePath();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#4b6584';
    ctx.stroke();

    // 賽車位置圓點
    for (const r of this.game.racers) {
      if (!r.car) continue;
      const cx = r.car.x * tf.scale + tf.offsetX;
      const cz = r.car.z * tf.scale + tf.offsetZ;

      ctx.beginPath();
      ctx.arc(cx, cz, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = r.color || '#ffffff';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
  }

  // 更新結算畫面
  _updateResults() {
    const tbody = this.root.querySelector('#resultsTbody');
    const cdEl = this.root.querySelector('#resultsCountdown');
    if (!tbody) return;

    const sorted = [...this.game.racers].sort((a, b) => (a.rank || 99) - (b.rank || 99));
    let rowsHtml = '';

    for (let i = 0; i < sorted.length; i++) {
      const r = sorted[i];
      const car = r.car;
      const rank = r.rank || (i + 1);
      const totalTimeStr = car && car.finished ? formatTime(car.finishTime) : '--:--.--';

      let bestLapStr = '--:--.--';
      if (car && car.lapTimes && car.lapTimes.length > 0) {
        const best = Math.min(...car.lapTimes);
        bestLapStr = formatTime(best);
      }

      rowsHtml += `
        <tr>
          <td>#${rank}</td>
          <td style="color:${r.color}; font-weight:bold;">${escapeHtml(r.name)}</td>
          <td>${totalTimeStr}</td>
          <td>${bestLapStr}</td>
        </tr>
      `;
    }

    if (this._lastResultsHtml !== rowsHtml) {
      tbody.innerHTML = rowsHtml;
      this._lastResultsHtml = rowsHtml;
    }

    if (cdEl) {
      const remain = Math.max(0, Math.ceil(CONFIG.RESULTS_SECONDS - this.game.resultsTimer));
      cdEl.textContent = `${remain} 秒後返回大廳，或按 Enter 立即返回`;
    }
  }

  // 清空標籤與 HTML 快取
  clearLabels() {
    this._lastSlotsHtml = null;
    this._lastResultsHtml = null;
  }
}
