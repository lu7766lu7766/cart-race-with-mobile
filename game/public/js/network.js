// ============================================================
//  network.js — 網路多人連線介面（第二階段：手機體感連線）
//  提供 RemoteInput 類別（輸入抽象層，支援逾時歸零與道具單次觸發）、
//  透過 WebSocket 連線到伺服器建立房間、取得房號與 QR Code、
//  接收手機加入並指派為 remote 玩家、轉發手機即時陀螺儀與按鈕輸入，
//  以及將名次、圈數、道具等級（itemLevel）與震動事件即時回傳給各手機。
// ============================================================

// ------------------------------------------------------------
// 1. 遠端輸入控制器類別（無 DOM 依賴，可在 Node.js 中測試）
// ------------------------------------------------------------
export class RemoteInput {
  constructor({ now = () => Date.now(), timeoutMs = 500 } = {}) {
    this.now = now;
    this.timeoutMs = timeoutMs;

    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.drift = false;

    // 道具累加計數器比對
    this.lastItemCounter = 0;
    this.itemTriggered = false;

    this.lastReceiveTime = this.now();
  }

  // 接收伺服器轉送來的手機端即時輸入數值
  update({ steer = 0, throttle = 0, brake = 0, item = 0 } = {}) {
    this.lastReceiveTime = this.now();
    this.steer = steer;
    this.throttle = throttle;
    this.brake = brake;

    // 若手機端同時按下油門與煞車/倒退，視為按住甩尾
    this.drift = throttle > 0.5 && brake > 0.5;

    // item 為手機端的累加計數器，數字比上次大時才觸發一次施放道具
    if (typeof item === 'number' && item > this.lastItemCounter) {
      this.itemTriggered = true;
      this.lastItemCounter = item;
    }
  }

  // 供 Game.step() 讀取目前輸入狀態
  getState() {
    const elapsed = this.now() - this.lastReceiveTime;

    // 超過 500 毫秒沒收到輸入（例如手機斷線或切到背景），將操控值歸零，避免暴衝
    if (elapsed > this.timeoutMs) {
      this.steer = 0;
      this.throttle = 0;
      this.brake = 0;
      this.drift = false;
    }

    // 道具只觸發一次，讀取後立即清空
    const useItem = this.itemTriggered;
    this.itemTriggered = false;

    return {
      steer: this.steer,
      throttle: this.throttle,
      brake: this.brake,
      drift: this.drift,
      useItem,
    };
  }

  // Game 在 GO 開賽瞬間會呼叫此函式，清空尚未讀取的道具觸發
  reset() {
    this.itemTriggered = false;
  }
}

// ------------------------------------------------------------
// 2. 初始化大螢幕網路連線
// ------------------------------------------------------------
export function initNetwork(game) {
  if (typeof window === 'undefined') return;

  // 對應 serverPlayerId -> { gamePlayer, remoteInput }
  const playerMap = new Map();
  let ws = null;
  let isConnecting = false;

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(typeof data === 'string' ? data : JSON.stringify(data));
      } catch (e) {}
    }
  }

  function connect() {
    if (isConnecting) return;
    isConnecting = true;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      isConnecting = false;
      handleDisconnect();
      return;
    }

    ws.onopen = () => {
      isConnecting = false;
      // 連線成功後，主動發送 host 要求建立房間
      send({ type: 'host' });
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      if (!msg || typeof msg !== 'object') return;

      // (A) 房間建立成功：取得房號與 QR Code，更新大廳 HUD
      if (msg.type === 'roomCreated') {
        const { code } = msg;
        fetch(`/api/server-info?code=${encodeURIComponent(code)}`)
          .then((res) => res.json())
          .then((info) => {
            game.setRoomInfo({
              code,
              url: info.controllerUrl,
              qrSvg: info.qrSvg,
              message: null,
            });
          })
          .catch(() => {
            game.setRoomInfo({ code, url: null, qrSvg: null, message: null });
          });
        return;
      }

      // (B) 手機玩家加入房間
      if (msg.type === 'playerJoined') {
        const { playerId, name } = msg;
        const remoteInput = new RemoteInput();
        const gamePlayer = game.addPlayer({
          name,
          kind: 'remote',
          input: remoteInput,
        });

        if (gamePlayer) {
          playerMap.set(playerId, { gamePlayer, remoteInput });

          // 加入成功後立刻回傳一次完整的 status 給該手機（包含車色與 itemLevel）
          const currentStatus = game.getStatus(gamePlayer.id);
          send({
            type: 'toPlayer',
            playerId,
            data: {
              type: 'status',
              ...currentStatus,
            },
          });
        } else {
          // 真人玩家已滿 4 位，回傳錯誤通知手機
          send({
            type: 'toPlayer',
            playerId,
            data: {
              type: 'error',
              message: '房間已滿（4 位真人）',
            },
          });
        }
        return;
      }

      // (C) 手機玩家離開或斷線
      if (msg.type === 'playerLeft') {
        const { playerId } = msg;
        const entry = playerMap.get(playerId);
        if (entry) {
          game.removePlayer(entry.gamePlayer.id);
          playerMap.delete(playerId);
        }
        return;
      }

      // (D) 收到手機輸入資料
      if (msg.type === 'input') {
        const { playerId, steer, throttle, brake, item } = msg;
        const entry = playerMap.get(playerId);
        if (entry) {
          entry.remoteInput.update({ steer, throttle, brake, item });
        }
        return;
      }
    };

    ws.onclose = () => {
      isConnecting = false;
      handleDisconnect();
    };

    ws.onerror = () => {
      isConnecting = false;
      try {
        ws.close();
      } catch (e) {}
    };
  }

  function handleDisconnect() {
    // 斷線時清理所有遠端手機玩家（比賽中將由 AI 接手繼續跑）
    for (const entry of playerMap.values()) {
      game.removePlayer(entry.gamePlayer.id);
    }
    playerMap.clear();

    // 大廳顯示連線中斷訊息，清除失效的房號、QR Code 與網址
    game.setRoomInfo({ code: null, url: null, qrSvg: null, message: '連線中斷，重新連線中…' });

    // 2 秒後自動重試連線
    setTimeout(() => {
      connect();
    }, 2000);
  }

  // ------------------------------------------------------------
  // 3. 訂閱遊戲核心事件，即時轉發給對應手機端
  // ------------------------------------------------------------

  // (1) 道具改變、名次改變、圈數改變：回傳給該手機最新 status
  function sendPlayerStatus(player) {
    if (!player) return;
    for (const [serverPlayerId, entry] of playerMap.entries()) {
      if (entry.gamePlayer.id === player.id) {
        send({
          type: 'toPlayer',
          playerId: serverPlayerId,
          data: {
            type: 'status',
            ...game.getStatus(player.id),
          },
        });
        break;
      }
    }
  }

  game.on('itemChanged', ({ player }) => sendPlayerStatus(player));
  game.on('positionChanged', ({ player }) => sendPlayerStatus(player));
  game.on('lapChanged', ({ player }) => sendPlayerStatus(player));

  // (2) 遊戲狀態改變（lobby -> countdown -> racing -> results 等）：對所有已連線手機廣播
  game.on('stateChanged', () => {
    for (const [serverPlayerId, entry] of playerMap.entries()) {
      send({
        type: 'toPlayer',
        playerId: serverPlayerId,
        data: {
          type: 'status',
          ...game.getStatus(entry.gamePlayer.id),
        },
      });
    }
  });

  // (3) 被道具擊中：傳送震動指令（300ms）
  game.on('playerHit', ({ player }) => {
    if (!player) return;
    for (const [serverPlayerId, entry] of playerMap.entries()) {
      if (entry.gamePlayer.id === player.id) {
        send({
          type: 'toPlayer',
          playerId: serverPlayerId,
          data: {
            type: 'vibrate',
            ms: 300,
          },
        });
        break;
      }
    }
  });

  // (4) 迷你加速釋放：傳送短震動回饋（60ms）
  game.on('miniTurbo', ({ player }) => {
    if (!player) return;
    for (const [serverPlayerId, entry] of playerMap.entries()) {
      if (entry.gamePlayer.id === player.id) {
        send({
          type: 'toPlayer',
          playerId: serverPlayerId,
          data: {
            type: 'vibrate',
            ms: 60,
          },
        });
        break;
      }
    }
  });

  // (5) 逆向行駛：傳送長震動提醒（500ms，持續逆向時每 2 秒重複）
  game.on('wrongWay', ({ player }) => {
    if (!player) return;
    for (const [serverPlayerId, entry] of playerMap.entries()) {
      if (entry.gamePlayer.id === player.id) {
        send({
          type: 'toPlayer',
          playerId: serverPlayerId,
          data: {
            type: 'vibrate',
            ms: 500,
          },
        });
        break;
      }
    }
  });

  // 啟動連線
  connect();
}
