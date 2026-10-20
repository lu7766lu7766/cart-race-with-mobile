// ============================================================
//  hud.js — 遊戲介面管理（大廳、倒數、抬頭顯示、結算、小地圖與 3D 浮動姓名標籤）
//  採用高效能 DOM 快取更新機制（不頻繁重建 DOM，僅更新文字與樣式）。
//  支援 CSS2DRenderer 呈現車頭 3D 姓名標籤，並於 Canvas 繪製即時小地圖。
// ============================================================

import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { CONFIG, KARTS, ITEMS } from './config.js';
import { formatTime } from './utils.js';

export class HUD {
  constructor(container, game) {
    this.container = container;
    this.game = game;

    // 建立 CSS2DRenderer（用於車頂 3D 名字標籤）
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    this.labelRenderer.domElement.className = 'label-renderer';
    this.container.appendChild(this.labelRenderer.domElement);

    this.carLabels = new Map(); // racerId -> CSS2DObject

    // 建立 DOM 介面元素結構
    this._createDOM();

    // 監聽視窗縮放
    window.addEventListener('resize', () => {
      this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
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
          <div class="room-message" id="roomMsg"></div>
        </div>
        <div class="slots-container" id="playerSlots"></div>
        <div class="lobby-controls-help">
          <p>⌨️ 玩家 1：按 <strong>↑</strong> 加入（方向鍵駕駛，Enter 道具/開始）</p>
          <p>⌨️ 玩家 2：按 <strong>W</strong> 加入（WASD 駕駛，空白鍵 道具）</p>
          <p class="start-hint">按 <strong>Enter</strong> 開始比賽！</p>
        </div>
      </div>
    `;
    this.root.appendChild(this.lobbyEl);

    // 2. 倒數層（Countdown Overlay）
    this.countdownEl = document.createElement('div');
    this.countdownEl.className = 'countdown-overlay';
    this.countdownEl.style.display = 'none';
    this.root.appendChild(this.countdownEl);

    // 3. 比賽中層（Racing HUD）
    this.racingEl = document.createElement('div');
    this.racingEl.className = 'screen racing-screen';
    this.racingEl.style.display = 'none';

    // 頂部賽事計時
    this.timerEl = document.createElement('div');
    this.timerEl.className = 'race-timer';
    this.timerEl.textContent = '0:00.00';
    this.racingEl.appendChild(this.timerEl);

    // 四個角落玩家卡片容器
    this.cardsContainer = document.createElement('div');
    this.cardsContainer.className = 'player-cards-container';
    this.playerCards = [];

    // 四個角落樣式位置
    const cardPositions = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
    for (let i = 0; i < CONFIG.MAX_PLAYERS; i++) {
      const card = document.createElement('div');
      card.className = `player-card ${cardPositions[i]}`;
      card.innerHTML = `
        <div class="card-header">
          <span class="card-name">玩家 ${i + 1}</span>
          <span class="card-pos">#1</span>
        </div>
        <div class="card-body">
          <div class="card-lap">圈數 1/3</div>
          <div class="card-item-slot">
            <span class="card-item-icon"></span>
          </div>
        </div>
      `;
      this.cardsContainer.appendChild(card);
      this.playerCards.push(card);
    }
    this.racingEl.appendChild(this.cardsContainer);

    // 底部中央小地圖 Canvas
    this.minimapCanvas = document.createElement('canvas');
    this.minimapCanvas.className = 'minimap-canvas';
    this.minimapCanvas.width = 160;
    this.minimapCanvas.height = 100;
    this.minimapCtx = this.minimapCanvas.getContext('2d');
    this.racingEl.appendChild(this.minimapCanvas);

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

  // 預先繪製靜態小地圖軌跡
  _drawMinimapStatic() {
    if (!this.game || !this.game.track) return;
    const track = this.game.track;
    const canvas = this.minimapCanvas;
    const ctx = this.minimapCtx;

    // 計算賽道包圍盒以進行正規化對齊
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of track.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }

    const pad = 10;
    const w = maxX - minX;
    const h = maxZ - minZ;
    const scale = Math.min((canvas.width - pad * 2) / w, (canvas.height - pad * 2) / h);

    this.minimapTransform = {
      scale,
      offsetX: canvas.width / 2 - ((minX + maxX) / 2) * scale,
      offsetZ: canvas.height / 2 - ((minZ + maxZ) / 2) * scale,
    };
  }

  // 每幀更新 HUD
  update(camera = null) {
    const state = this.game.state;

    // 控制各層顯示/隱藏
    this.lobbyEl.style.display = state === 'lobby' ? 'flex' : 'none';
    this.countdownEl.style.display = state === 'countdown' ? 'flex' : 'none';
    this.racingEl.style.display = (state === 'racing' || state === 'countdown') ? 'block' : 'none';
    this.resultsEl.style.display = state === 'results' ? 'flex' : 'none';

    if (state === 'lobby') {
      this._updateLobby();
    } else if (state === 'countdown') {
      this._updateCountdown();
      this._updateRacingHUD();
    } else if (state === 'racing') {
      this._updateRacingHUD();
    } else if (state === 'results') {
      this._updateResults();
    }

    // 更新 3D 車名浮動標籤與 CSS2DRenderer
    this._updateLabels();
    if (camera) {
      this.labelRenderer.render(this.game.scene || this._findScene(), camera);
    }
  }

  _findScene() {
    return this.game.track?.meshesGroup?.parent || null;
  }

  // 更新大廳資訊與玩家欄位
  _updateLobby() {
    const roomInfo = this.game.roomInfo;
    const roomCodeEl = this.root.querySelector('#roomCode');
    const roomNoteEl = this.root.querySelector('#roomNote');
    const roomQrEl = this.root.querySelector('#roomQr');
    const roomMsgEl = this.root.querySelector('#roomMsg');

    if (roomCodeEl) {
      roomCodeEl.textContent = roomInfo.code || '----';
    }
    if (roomNoteEl) {
      roomNoteEl.textContent = roomInfo.code ? '用手機掃描或輸入房號加入' : '本機模式：第二階段開放手機加入';
    }
    if (roomQrEl) {
      if (roomInfo.qrSvg) {
        roomQrEl.style.display = 'block';
        // innerHTML 僅插入本機伺服器端產生之 SVG 字串
        roomQrEl.innerHTML = roomInfo.qrSvg;
      } else {
        roomQrEl.style.display = 'none';
      }
    }
    if (roomMsgEl) {
      roomMsgEl.textContent = roomInfo.message || '';
    }

    // 更新 4 個發車格位玩家資訊
    const slotsEl = this.root.querySelector('#playerSlots');
    if (!slotsEl) return;

    const humans = this.game.getPlayers();
    const humanSlotMap = new Map(humans.map((h) => [h.slot, h]));

    let html = '';
    for (let slot = 0; slot < CONFIG.MAX_PLAYERS; slot++) {
      const human = humanSlotMap.get(slot);
      const kart = KARTS[slot] || KARTS[0];

      if (human) {
        const icon = human.kind === 'remote' ? '📱' : '⌨️';
        html += `
          <div class="player-slot joined" style="border-left: 6px solid ${kart.color}">
            <span class="slot-icon">${icon}</span>
            <span class="slot-name">${human.name}</span>
            <span class="slot-color-tag" style="background:${kart.color}">${kart.colorName}</span>
          </div>
        `;
      } else {
        html += `
          <div class="player-slot ai-fallback" style="border-left: 6px solid ${kart.color}">
            <span class="slot-icon">🤖</span>
            <span class="slot-name">電腦補位</span>
            <span class="slot-color-tag" style="background:${kart.color}">${kart.colorName}</span>
          </div>
        `;
      }
    }
    if (slotsEl.innerHTML !== html) {
      slotsEl.innerHTML = html;
    }
  }

  // 更新倒數大字
  _updateCountdown() {
    const val = this.game.countdownValue;
    this.countdownEl.textContent = val > 0 ? val.toString() : 'GO!';
  }

  // 更新比賽中 HUD
  _updateRacingHUD() {
    // 1. 總時間
    this.timerEl.textContent = formatTime(this.game.raceTime);

    // 2. 四角卡片
    const racers = this.game.racers;
    const icons = ['⚡', '🍌', '🚀', '🛡️'];

    for (let i = 0; i < CONFIG.MAX_PLAYERS; i++) {
      const card = this.playerCards[i];
      const racer = racers[i];

      if (!racer || !racer.car) {
        card.style.display = 'none';
        continue;
      }
      card.style.display = 'block';

      // 玩家姓名與名次
      const nameEl = card.querySelector('.card-name');
      const posEl = card.querySelector('.card-pos');
      const lapEl = card.querySelector('.card-lap');
      const iconEl = card.querySelector('.card-item-icon');

      if (nameEl) nameEl.textContent = racer.name;
      if (posEl) posEl.textContent = `#${racer.position || '-'}`;

      if (lapEl) {
        lapEl.textContent = racer.car.finished
          ? '完賽'
          : `圈數 ${racer.car.lap}/${CONFIG.LAPS}`;
      }

      // 道具格顯示與抽獎輪播效果
      if (iconEl) {
        if (racer.rolling) {
          // 輪播動畫
          const rollIndex = Math.floor(Date.now() / 80) % icons.length;
          iconEl.textContent = icons[rollIndex];
          iconEl.className = 'card-item-icon rolling';
        } else if (racer.item && ITEMS[racer.item]) {
          iconEl.textContent = ITEMS[racer.item].icon;
          iconEl.className = 'card-item-icon has-item';
        } else {
          iconEl.textContent = '';
          iconEl.className = 'card-item-icon';
        }
      }
    }

    // 3. 繪製小地圖
    this._renderMinimap();
  }

  // 繪製動態小地圖（賽道軌道＋各車位置圓點）
  _renderMinimap() {
    const canvas = this.minimapCanvas;
    const ctx = this.minimapCtx;
    const track = this.game.track;
    const tf = this.minimapTransform;
    if (!tf) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 背景半透明黑
    ctx.fillStyle = 'rgba(20, 20, 25, 0.7)';
    ctx.roundRect ? ctx.roundRect(0, 0, canvas.width, canvas.height, 8) : ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fill();

    // 繪製賽道路線
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

    // 繪製賽車位置圓點
    for (const r of this.game.racers) {
      if (!r.car) continue;
      const cx = r.car.x * tf.scale + tf.offsetX;
      const cz = r.car.z * tf.scale + tf.offsetZ;

      ctx.beginPath();
      ctx.arc(cx, cz, 4, 0, Math.PI * 2);
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
          <td style="color:${r.color}; font-weight:bold;">${r.name}</td>
          <td>${totalTimeStr}</td>
          <td>${bestLapStr}</td>
        </tr>
      `;
    }

    if (tbody.innerHTML !== rowsHtml) {
      tbody.innerHTML = rowsHtml;
    }

    if (cdEl) {
      const remain = Math.max(0, Math.ceil(CONFIG.RESULTS_SECONDS - this.game.resultsTimer));
      cdEl.textContent = `${remain} 秒後返回大廳，或按 Enter 立即返回`;
    }
  }

  // 更新車頭上方 3D 浮動姓名標籤
  _updateLabels() {
    if (this.game.state !== 'racing' && this.game.state !== 'countdown') {
      // 非比賽狀態隱藏標籤
      for (const label of this.carLabels.values()) {
        label.visible = false;
      }
      return;
    }

    for (const r of this.game.racers) {
      if (!r.car || !r.car.viewGroup) continue;

      let labelObj = this.carLabels.get(r.id);
      if (!labelObj) {
        const div = document.createElement('div');
        div.className = 'car-3d-label';
        div.textContent = r.name;
        div.style.borderColor = r.color;
        labelObj = new CSS2DObject(div);
        labelObj.position.set(0, 1.8, 0);
        r.car.viewGroup.add(labelObj);
        this.carLabels.set(r.id, labelObj);
      }
      labelObj.visible = true;
    }
  }

  // 清除所有 3D 浮動姓名標籤 DOM 節點
  clearLabels() {
    for (const [id, labelObj] of this.carLabels.entries()) {
      if (labelObj.parent) {
        labelObj.parent.remove(labelObj);
      }
    }
    this.carLabels.clear();
  }
}
