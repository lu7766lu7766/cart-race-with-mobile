// ============================================================
//  hud.js — 遊戲介面管理（大廳角色說明、倒數、分割畫面 HUD 面板、小地圖與結算）
//  支援分割畫面多鏡頭：依據 viewRacers 快照與 getViewportRects，
//  為每位真人賽車在對應螢幕格子疊加專屬 DOM 面板（名次、圈數、道具星星、速度表與甩尾火花條）。
//  已移除舊版 CSS2DRenderer，車頂姓名改由 3D 空間之 Sprite 渲染。
// ============================================================

import { CONFIG, KARTS, ITEMS } from './config.js';
import { formatTime, clamp, getViewportRects, escapeHtml } from './utils.js';

export class HUD {
  constructor(container, game) {
    this.container = container;
    this.game = game;
    this._lastQr = null;
    this._lastSlotsHtml = null;
    this._lastResultsHtml = null;

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
        <div class="slots-container" id="playerSlots"></div>
        <div class="lobby-controls-help">
          <p>⌨️ 玩家 1：按 <strong>↑</strong> 加入（方向鍵駕駛，右Shift 甩尾，Enter 道具/開始）</p>
          <p>⌨️ 玩家 2：按 <strong>W</strong> 加入（WASD 駕駛，左Shift 甩尾，空白鍵 道具）</p>
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
        <div class="cell-hit-flash" style="display:none;"></div>
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
            <div class="slot-main">
              <span class="slot-icon">${icon}</span>
              <span class="slot-name">${escapeHtml(human.name)}</span>
              <span class="slot-color-tag" style="background:${kart.color}">${kart.colorName}</span>
            </div>
            <div class="slot-ability">
              <span class="char-title">${kart.character}</span>：${kart.ability}
            </div>
          </div>
        `;
      } else {
        html += `
          <div class="player-slot ai-fallback" style="border-left: 6px solid ${kart.color}">
            <div class="slot-main">
              <span class="slot-icon">🤖</span>
              <span class="slot-name">電腦補位</span>
              <span class="slot-color-tag" style="background:${kart.color}">${kart.colorName}</span>
            </div>
            <div class="slot-ability">
              <span class="char-title">${kart.character}</span>：${kart.ability}
            </div>
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
