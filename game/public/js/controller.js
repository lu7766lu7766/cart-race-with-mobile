// ============================================================
//  controller.js — 手機體感方向盤控制器端邏輯
//  負責取得手機陀螺儀/重力感測權限、全螢幕與橫向鎖定、
//  透過 WebSocket 連線伺服器並加入房間、以 30 Hz 發送即時轉向與按鍵輸入、
//  接收大螢幕回傳的名次、圈數、道具等級（itemLevel）與震動受擊回饋。
//  本檔案為純前端腳本，不載入 Three.js。
// ============================================================

// 道具名稱對應 Emoji 圖示
const ITEM_ICONS = {
  nitro: '⚡',
  banana: '🍌',
  missile: '🚀',
  shield: '🛡️',
};

// DOM 元素快取
const joinScreen = document.getElementById('join-screen');
const wheelScreen = document.getElementById('wheel-screen');
const secureWarning = document.getElementById('secure-warning');
const roomCodeInput = document.getElementById('room-code');
const playerNameInput = document.getElementById('player-name');
const btnStart = document.getElementById('btn-start');
const errorMsg = document.getElementById('error-message');

const topBar = document.getElementById('top-bar');
const rankText = document.getElementById('rank-text');
const lapText = document.getElementById('lap-text');
const wheelIcon = document.getElementById('wheel-icon');
const steerDegree = document.getElementById('steer-degree');
const btnCalibrate = document.getElementById('btn-calibrate');
const btnInvert = document.getElementById('btn-invert');

const btnBrake = document.getElementById('btn-brake');
const btnThrottle = document.getElementById('btn-throttle');
const btnItem = document.getElementById('btn-item');
const itemIcon = document.getElementById('item-icon');
const itemStars = document.getElementById('item-stars');
const waitingOverlay = document.getElementById('waiting-overlay');
const flashOverlay = document.getElementById('flash-overlay');

// 控制器狀態
let ws = null;
let inputInterval = null;
let isConnected = false;

let isThrottlePressed = false;
let isBrakePressed = false;
let itemCounter = 0;

let rawTiltDeg = 0;
let calibrationAngle = 0;
let invertSteer = false;
let targetSteer = 0;
let smoothedSteer = 0;
let currentDisplayAngle = 0;

let hasMotionSensor = false;

// ------------------------------------------------------------
// 1. 初始化頁面狀態與 URL 參數
// ------------------------------------------------------------
function init() {
  // 檢查是否為安全環境（HTTPS）
  if (window.isSecureContext === false) {
    secureWarning.classList.remove('hidden');
  }

  // 從 URL 取得預設房號（例如掃描 QR Code 帶有 ?code=1234）
  const params = new URLSearchParams(window.location.search);
  const codeParam = params.get('code');
  if (codeParam) {
    roomCodeInput.value = codeParam.trim();
  }

  // 從 localStorage 還原上次輸入的暱稱
  const savedName = localStorage.getItem('kart_nickname');
  if (savedName) {
    playerNameInput.value = savedName;
  }
}

// 顯示錯誤訊息
function showError(text) {
  if (!text) {
    errorMsg.classList.add('hidden');
    errorMsg.textContent = '';
  } else {
    errorMsg.classList.remove('hidden');
    errorMsg.textContent = text;
  }
}

// 切換至加入畫面
function showJoinScreen(errorMessage = '') {
  wheelScreen.classList.remove('active');
  joinScreen.classList.add('active');
  if (errorMessage) {
    showError(errorMessage);
  }
  cleanupConnection();
}

// 切換至方向盤畫面
function showWheelScreen() {
  joinScreen.classList.remove('active');
  wheelScreen.classList.add('active');
  showError('');
  targetSteer = 0;
  smoothedSteer = 0;
  rawTiltDeg = 0;
  currentDisplayAngle = 0;
  wheelIcon.style.transform = 'rotate(0deg)';
  steerDegree.textContent = '0°';
}

// ------------------------------------------------------------
// 2. 轉向感測計算（DeviceMotion / DeviceOrientation）
// ------------------------------------------------------------
function processTilt(degrees) {
  currentDisplayAngle = degrees - calibrationAngle;
  let effective = currentDisplayAngle * (invertSteer ? -1 : 1);

  // 3 度以內死區判定
  if (Math.abs(effective) <= 3) {
    effective = 0;
  } else {
    effective = effective > 0 ? effective - 3 : effective + 3;
  }

  // ±35 度對應 -1 ～ +1 轉向
  targetSteer = Math.max(-1, Math.min(1, effective / 32));

  // 視覺方向盤即時跟隨旋轉
  const rotateDeg = Math.round(effective);
  wheelIcon.style.transform = `rotate(${rotateDeg}deg)`;
  steerDegree.textContent = `${rotateDeg > 0 ? '+' : ''}${rotateDeg}°`;
}

function handleDeviceMotion(e) {
  const acc = e.accelerationIncludingGravity;
  if (!acc) return;

  const ax = acc.x;
  const ay = acc.y;

  // 1. 若 x 或 y 不是有限數字（如桌機 Chrome 傳 null 或空值），直接忽略，
  // 且不要把 hasMotionSensor 設為 true，讓 deviceorientation 備援能繼續運作。
  if (!Number.isFinite(ax) || !Number.isFinite(ay)) {
    return;
  }

  // 收到有效數值才標記感測器可用
  hasMotionSensor = true;

  // 取得目前螢幕旋轉角度（0, 90, 180, 270）
  let screenAngle = 0;
  if (screen.orientation && typeof screen.orientation.angle === 'number') {
    screenAngle = screen.orientation.angle;
  } else if (typeof window.orientation === 'number') {
    screenAngle = window.orientation;
  }

  // 將重力加速度向量轉換至目前橫向螢幕坐標系
  let sx = ax;
  let sy = ay;

  if (screenAngle === 90) {
    sx = -ay;
    sy = ax;
  } else if (screenAngle === 270 || screenAngle === -90) {
    sx = ay;
    sy = -ax;
  } else if (screenAngle === 180) {
    sx = -ax;
    sy = -ay;
  }

  // 2. 重力向量在螢幕平面上的長度 < 3 m/s²（手機幾乎平放或讀數無效）時，忽略這次讀數（維持上一次的角度）
  if (Math.hypot(sx, sy) < 3) {
    return;
  }

  // 手機直立橫拿如方向盤時，重力方向朝螢幕下方（-sy）
  // 往右轉動方向盤時，右端向下傾斜，sx > 0，atan2 算出正角
  const rad = Math.atan2(sx, -sy);
  rawTiltDeg = rad * (180 / Math.PI);
  processTilt(rawTiltDeg);
}

function handleDeviceOrientation(e) {
  if (hasMotionSensor) return; // 優先使用 devicemotion

  // 檢查 beta / gamma 是否為有限數字
  if (!Number.isFinite(e.beta) || !Number.isFinite(e.gamma)) {
    return;
  }

  let screenAngle = screen.orientation?.angle ?? window.orientation ?? 0;
  let tilt = 0;

  if (screenAngle === 90) {
    tilt = e.beta;
  } else if (screenAngle === 270 || screenAngle === -90) {
    tilt = -e.beta;
  } else {
    tilt = e.gamma;
  }

  rawTiltDeg = tilt;
  processTilt(rawTiltDeg);
}

// ------------------------------------------------------------
// 3. 觸控與按鈕互動
// ------------------------------------------------------------
function setupTouchEvents() {
  // 校正按鈕：將當前角度記錄為中心點
  btnCalibrate.addEventListener('click', (e) => {
    e.stopPropagation();
    calibrationAngle = rawTiltDeg;
  });

  // 反轉方向按鈕：切換左右轉正負方向
  btnInvert.addEventListener('click', (e) => {
    e.stopPropagation();
    invertSteer = !invertSteer;
    btnInvert.textContent = invertSteer ? '反轉 🟢' : '反轉 🔄';
  });

  // 道具按鈕點擊：計數器累加 1
  btnItem.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    itemCounter++;
    btnItem.style.transform = 'scale(0.9)';
  });

  btnItem.addEventListener('pointerup', () => {
    btnItem.style.transform = '';
  });
  btnItem.addEventListener('pointercancel', () => {
    btnItem.style.transform = '';
  });

  // 多指觸控：支援同時按壓油門、煞車與道具（如油門＋煞車＝甩尾）
  const controlArea = document.getElementById('control-area');

  function updateTouchZones(e) {
    e.preventDefault();
    let throttleActive = false;
    let brakeActive = false;

    const touches = e.touches || [];
    for (let i = 0; i < touches.length; i++) {
      const touch = touches[i];
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      if (!target) continue;

      if (btnThrottle.contains(target)) {
        throttleActive = true;
      }
      if (btnBrake.contains(target)) {
        brakeActive = true;
      }
    }

    isThrottlePressed = throttleActive;
    isBrakePressed = brakeActive;

    btnThrottle.classList.toggle('active', throttleActive);
    btnBrake.classList.toggle('active', brakeActive);
  }

  controlArea.addEventListener('touchstart', updateTouchZones, { passive: false });
  controlArea.addEventListener('touchmove', updateTouchZones, { passive: false });
  controlArea.addEventListener('touchend', updateTouchZones, { passive: false });
  controlArea.addEventListener('touchcancel', updateTouchZones, { passive: false });

  // 電腦端測試滑鼠按壓支援
  btnThrottle.addEventListener('mousedown', () => {
    isThrottlePressed = true;
    btnThrottle.classList.add('active');
  });
  window.addEventListener('mouseup', () => {
    isThrottlePressed = false;
    isBrakePressed = false;
    btnThrottle.classList.remove('active');
    btnBrake.classList.remove('active');
  });
  btnBrake.addEventListener('mousedown', () => {
    isBrakePressed = true;
    btnBrake.classList.add('active');
  });

  // 電腦端鍵盤除錯支援（A/D 轉向、W 油門、S 煞車、Space 道具）
  window.addEventListener('keydown', (e) => {
    if (!isConnected) return;
    if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') processTilt(-30);
    if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') processTilt(30);
    if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
      isThrottlePressed = true;
      btnThrottle.classList.add('active');
    }
    if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') {
      isBrakePressed = true;
      btnBrake.classList.add('active');
    }
    if (e.key === ' ') {
      itemCounter++;
    }
  });

  window.addEventListener('keyup', (e) => {
    if (!isConnected) return;
    if (['a', 'A', 'd', 'D', 'ArrowLeft', 'ArrowRight'].includes(e.key)) processTilt(0);
    if (['w', 'W', 'ArrowUp'].includes(e.key)) {
      isThrottlePressed = false;
      btnThrottle.classList.remove('active');
    }
    if (['s', 'S', 'ArrowDown'].includes(e.key)) {
      isBrakePressed = false;
      btnBrake.classList.remove('active');
    }
  });
}

// ------------------------------------------------------------
// 4. 震動與畫面閃爍提示
// ------------------------------------------------------------
function triggerFeedback(ms = 300) {
  if (navigator.vibrate) {
    try {
      navigator.vibrate(ms);
    } catch (e) {}
  }

  // 畫面閃紅（適合 iPhone 等無震動 API 之裝置）
  flashOverlay.classList.add('flashing');
  setTimeout(() => {
    flashOverlay.classList.remove('flashing');
  }, Math.max(100, ms));
}

// ------------------------------------------------------------
// 5. 連線清理與中斷處理
// ------------------------------------------------------------
function cleanupConnection() {
  isConnected = false;
  if (inputInterval) {
    clearInterval(inputInterval);
    inputInterval = null;
  }
  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
    try {
      ws.close();
    } catch (e) {}
    ws = null;
  }

  window.removeEventListener('devicemotion', handleDeviceMotion, true);
  window.removeEventListener('deviceorientation', handleDeviceOrientation, true);

  hasMotionSensor = false;
  targetSteer = 0;
  smoothedSteer = 0;
  rawTiltDeg = 0;
  currentDisplayAngle = 0;
}

// ------------------------------------------------------------
// 6. 開始按鈕與連線流程
// ------------------------------------------------------------
btnStart.addEventListener('click', async () => {
  const code = roomCodeInput.value.trim();
  const name = playerNameInput.value.trim();

  if (!code) {
    showError('請輸入大螢幕上的 4 位數房號！');
    return;
  }

  showError('');
  if (name) {
    localStorage.setItem('kart_nickname', name);
  }

  // (1) 取得感測器權限（iOS 13+ 必須在使用者點擊事件中第一時間執行）
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      await DeviceMotionEvent.requestPermission();
    } catch (e) {
      console.warn('DeviceMotionEvent permission denied:', e);
    }
  }
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      await DeviceOrientationEvent.requestPermission();
    } catch (e) {
      console.warn('DeviceOrientationEvent permission denied:', e);
    }
  }

  // (2) 嘗試全螢幕、鎖定橫向與防止螢幕休眠（各自 try/catch，失敗不影響遊戲進行）
  try {
    if (document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    }
  } catch (e) {}

  try {
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock('landscape');
    }
  } catch (e) {}

  try {
    if ('wakeLock' in navigator) {
      await navigator.wakeLock.request('screen');
    }
  } catch (e) {}

  // (3) 連線至 WebSocket 房間伺服器
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  cleanupConnection();

  try {
    ws = new WebSocket(wsUrl);
  } catch (err) {
    showError('無法建立 WebSocket 連線：' + err.message);
    return;
  }

  btnStart.disabled = true;
  btnStart.textContent = '連線中… ⏳';

  ws.onopen = () => {
    btnStart.disabled = false;
    btnStart.textContent = '開始連線 🏁';
    // 發送加入房間請求
    ws.send(JSON.stringify({
      type: 'join',
      code,
      name,
    }));
  };

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      return;
    }

    // 成功加入房間
    if (msg.type === 'joined') {
      isConnected = true;
      showWheelScreen();

      // 掛載陀螺儀監聽
      window.addEventListener('devicemotion', handleDeviceMotion, true);
      window.addEventListener('deviceorientation', handleDeviceOrientation, true);

      // 啟動每秒 30 次（30 Hz）定時發送 input 迴圈
      inputInterval = setInterval(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        // 平滑低通濾波
        smoothedSteer = smoothedSteer * 0.75 + targetSteer * 0.25;

        ws.send(JSON.stringify({
          type: 'input',
          steer: Number(smoothedSteer.toFixed(3)),
          throttle: isThrottlePressed ? 1 : 0,
          brake: isBrakePressed ? 1 : 0,
          item: itemCounter,
        }));
      }, 1000 / 30);
      return;
    }

    // 收到錯誤訊息（房號錯誤、房間已滿等）：立即中斷並退回畫面一
    if (msg.type === 'error') {
      showJoinScreen(msg.message || '連線發生錯誤');
      return;
    }

    // 大螢幕重新整理或關閉
    if (msg.type === 'roomClosed') {
      showJoinScreen('大螢幕已關閉房間，連線已中斷');
      return;
    }

    // 收到遊戲狀態（名次、圈數、道具與等級、車色）
    if (msg.type === 'status') {
      // 玩家車輛顏色背景
      if (msg.color) {
        topBar.style.backgroundColor = msg.color;
      }

      // 名次
      if (msg.position != null) {
        rankText.textContent = `第 ${msg.position} 名`;
      } else {
        rankText.textContent = '--';
      }

      // 圈數
      if (msg.lap != null && msg.totalLaps != null) {
        rankText.parentElement.style.display = 'flex';
        lapText.textContent = `${msg.lap} / ${msg.totalLaps}`;
      }

      // 道具圖示與等級星號
      if (msg.item) {
        itemIcon.textContent = ITEM_ICONS[msg.item] || '❓';
        btnItem.classList.add('ready');
      } else {
        itemIcon.textContent = '❓';
        btnItem.classList.remove('ready');
      }

      const level = msg.itemLevel || 0;
      itemStars.textContent = level > 0 ? '★'.repeat(level) : '';

      // 中途加入者提示（非大廳且尚未上場）
      if (msg.inRace === false && msg.state !== 'lobby') {
        waitingOverlay.classList.remove('hidden');
      } else {
        waitingOverlay.classList.add('hidden');
      }
      return;
    }

    // 收到震動通知（被道具打中 300ms 或迷你加速釋放 60ms）
    if (msg.type === 'vibrate') {
      triggerFeedback(msg.ms || 300);
      return;
    }
  };

  ws.onclose = () => {
    btnStart.disabled = false;
    btnStart.textContent = '開始連線 🏁';
    if (isConnected) {
      showJoinScreen('伺服器連線已中斷');
    }
  };

  ws.onerror = () => {
    btnStart.disabled = false;
    btnStart.textContent = '開始連線 🏁';
    showJoinScreen('無法連接至伺服器');
  };
});

// 啟動初始化
init();
setupTouchEvents();
