// ============================================================
//  game.js — 遊戲核心管理類別
//  包含遊戲狀態機（loading -> lobby -> countdown -> racing -> results）、
//  玩家與電腦參賽者管理、固定步長物理模擬迴圈（1/60s）、圈數與即時名次結算，
//  以及提供外部（HUD、網路、輸入系統）操作的統一 API。
//  本類別無 DOM 依賴，可在 Node.js 環境中進行無頭（headless）測試。
// ============================================================

import { CONFIG, KARTS, AI_NAMES } from './config.js';
import { clamp, Emitter } from './utils.js';
import { Track } from './track.js';
import { Car } from './car.js';
import { ItemSystem } from './items.js';
import { AIInput } from './ai.js';
import { NullInput } from './input.js';

export class Game extends Emitter {
  constructor({ headless = false, rng = Math.random } = {}) {
    super();
    this.headless = headless;
    this.rng = rng;

    this.track = new Track();
    this.itemSystem = new ItemSystem({ game: this, track: this.track, rng: this.rng });

    // 真人玩家列表（keyboard 或 remote）
    // key 為 playerId，value 為 player 物件
    this.players = new Map();

    // 當前比賽參賽者陣列（最多 MAX_PLAYERS 台，包含真人與補位 AI）
    this.racers = [];

    // 狀態機：loading -> lobby -> countdown -> racing -> results
    this._state = 'lobby';

    this.countdownTimer = 0;
    this.countdownValue = 3;
    this.raceTime = 0;
    this.resultsTimer = 0;
    this.firstHumanFinishTime = null;

    // 房號與連線資訊（供 HUD 顯示）
    this.roomInfo = {
      code: null,
      url: null,
      qrSvg: null,
      message: null,
    };

    // 固定步長累積器
    this.accumulator = 0;
    this.nextPlayerId = 1;

    // 車輛碰撞冷卻記錄（避免重疊時每幀持續扣速卡死）
    this.collisionCooldowns = new Map();
  }

  // 唯讀取得當前遊戲狀態
  get state() {
    return this._state;
  }

  // 對外更新介面：以真實經過時間 realDt 累加，以固定 1/60 秒模擬
  update(realDt) {
    this.accumulator += realDt;
    const fixedDt = 1 / 60;
    let steps = 0;

    // 每幀最多執行 5 步，避免切換分頁回到頁面時產生過大累計跳躍
    while (this.accumulator >= fixedDt && steps < 5) {
      this.step(fixedDt);
      this.accumulator -= fixedDt;
      steps++;
    }

    if (steps >= 5) {
      this.accumulator = 0;
    }
  }

  // 純邏輯模擬單一步長（測試直接呼叫此函式）
  step(dt) {
    // --------------------------------------------------------
    // 1. 狀態機時序邏輯
    // --------------------------------------------------------
    if (this._state === 'countdown') {
      this.countdownTimer += dt;
      const prevVal = this.countdownValue;
      this.countdownValue = Math.max(1, 3 - Math.floor(this.countdownTimer));

      if (this.countdownTimer >= 3.0) {
        // 倒數結束，GO！正式開賽
        this._state = 'racing';
        this.raceTime = 0;
        this.firstHumanFinishTime = null;

        for (const racer of this.racers) {
          if (racer.car) {
            racer.car.maxLapsDone = 0;
            racer.car.lapStartTime = 0;
          }
          if (racer.input && typeof racer.input.reset === 'function') {
            racer.input.reset();
          }
        }

        this.emit('stateChanged', { state: 'racing' });
        this.emit('sound', 'go');
      }
      return;
    }

    if (this._state === 'results') {
      this.resultsTimer += dt;
      if (this.resultsTimer >= CONFIG.RESULTS_SECONDS) {
        this.backToLobby();
      }
      return;
    }

    if (this._state !== 'racing') {
      return;
    }

    // --------------------------------------------------------
    // 2. 比賽中物理與操作模擬
    // --------------------------------------------------------
    this.raceTime += dt;

    // 讀取每位參賽者的輸入並更新車輛物理
    for (const racer of this.racers) {
      if (!racer.car) continue;

      let rawInput = { steer: 0, throttle: 0, brake: 0, useItem: false };
      try {
        if (racer.input && typeof racer.input.getState === 'function') {
          rawInput = racer.input.getState() || rawInput;
        }
      } catch (err) {
        console.error(`讀取玩家 ${racer.name} 輸入時發生錯誤：`, err);
      }

      // 輸入安全限制（clamp 到標準合法區間，非有限數一律當 0）
      const steer = Number.isFinite(rawInput.steer) ? clamp(rawInput.steer, -1, 1) : 0;
      const throttle = Number.isFinite(rawInput.throttle) ? clamp(rawInput.throttle, 0, 1) : 0;
      const brake = Number.isFinite(rawInput.brake) ? clamp(rawInput.brake, 0, 1) : 0;
      const useItem = Boolean(rawInput.useItem);

      if (useItem) {
        this.itemSystem.useItem(racer);
      }

      racer.car.update(dt, { steer, throttle, brake }, this.track);

      if (racer.car.wallHitThisFrame) {
        this.emit('sound', 'wall');
      }
    }

    // 更新車輛碰撞冷卻時間
    for (const [key, cd] of this.collisionCooldowns) {
      if (cd <= dt) {
        this.collisionCooldowns.delete(key);
      } else {
        this.collisionCooldowns.set(key, cd - dt);
      }
    }

    // 車對車圓形彈性互推碰撞
    const carCount = this.racers.length;
    for (let i = 0; i < carCount; i++) {
      for (let j = i + 1; j < carCount; j++) {
        const racerA = this.racers[i];
        const racerB = this.racers[j];
        const carA = racerA.car;
        const carB = racerB.car;
        if (!carA || !carB) continue;

        const dx = carB.x - carA.x;
        const dz = carB.z - carA.z;
        const distSq = dx * dx + dz * dz;
        const minDist = CONFIG.CAR_RADIUS * 2; // 3.0

        if (distSq < minDist * minDist) {
          const dist = Math.sqrt(distSq);
          const overlap = minDist - dist;
          const nx = dist > 0.0001 ? dx / dist : 1;
          const nz = dist > 0.0001 ? dz / dist : 0;

          // 兩台車完全推開（各推一半重疊距離）
          carA.x -= nx * (overlap * 0.5);
          carA.z -= nz * (overlap * 0.5);
          carB.x += nx * (overlap * 0.5);
          carB.z += nz * (overlap * 0.5);

          // 計算兩車相對速度在連心線方向的分量（接近速度）
          const vxA = Math.sin(carA.heading) * carA.speed;
          const vzA = Math.cos(carA.heading) * carA.speed;
          const vxB = Math.sin(carB.heading) * carB.speed;
          const vzB = Math.cos(carB.heading) * carB.speed;
          const approachSpeed = (vxB - vxA) * nx + (vzB - vzA) * nz;

          // 只有兩車「互相接近」（接近速度 < -0.5）且冷卻結束才扣速度一次，避免卡死
          const pairKey = `${racerA.id}_${racerB.id}`;
          const cd = this.collisionCooldowns.get(pairKey) || 0;
          if (cd <= 0 && approachSpeed < -0.5) {
            carA.speed *= 0.85;
            carB.speed *= 0.85;
            this.collisionCooldowns.set(pairKey, 0.3);
            this.emit('sound', 'bump');
          }
        }
      }
    }

    // 道具系統邏輯更新（道具箱、香蕉皮、導彈）
    this.itemSystem.update(dt, this.racers);

    // 圈數計算與完賽檢查
    for (const racer of this.racers) {
      const car = racer.car;
      if (!car || car.finished) continue;

      // 檢查是否真正完成一圈
      if (car.lapsDone > car.maxLapsDone) {
        car.maxLapsDone = car.lapsDone;
        car.lapTimes.push(this.raceTime - car.lapStartTime);
        car.lapStartTime = this.raceTime;

        if (car.lapsDone < CONFIG.LAPS) {
          // 進入下一圈
          this.emit('lapChanged', { player: racer, lap: car.lapsDone + 1 });
          this.emit('sound', 'lap');
        } else {
          // 跑滿指定圈數完賽
          car.finished = true;
          car.finishTime = this.raceTime;

          const finishedRank = this.racers.filter((r) => r.car && r.car.finished).length;
          racer.rank = finishedRank;

          // 完賽後交由慢速 AI 接手巡航
          racer.input = new AIInput({
            car,
            game: this,
            rng: this.rng,
            speedFactor: 0.5,
          });

          this.emit('playerFinished', {
            player: racer,
            rank: racer.rank,
            time: car.finishTime,
          });
          this.emit('sound', 'finished');
        }
      }
    }

    // 實時計算比賽名次
    const sortedRacers = [...this.racers].sort((a, b) => {
      const carA = a.car;
      const carB = b.car;
      if (!carA || !carB) return 0;

      // 完賽者以完賽成績排序
      if (carA.finished && carB.finished) {
        return carA.finishTime - carB.finishTime;
      }
      if (carA.finished) return -1;
      if (carB.finished) return 1;

      // 未完賽者依賽道累積進度 progress 排序
      return carB.progress - carA.progress;
    });

    for (let i = 0; i < sortedRacers.length; i++) {
      const racer = sortedRacers[i];
      const newPos = i + 1;
      if (racer.position !== newPos) {
        racer.position = newPos;
        this.emit('positionChanged', { player: racer, position: newPos });
      }
    }

    // --------------------------------------------------------
    // 3. 比賽結束判定
    // --------------------------------------------------------
    const humanRacers = this.racers.filter((r) => r.kind !== 'ai');
    let shouldEndRace = false;

    if (humanRacers.length > 0) {
      const allHumansFinished = humanRacers.every((r) => r.car && r.car.finished);
      if (allHumansFinished) {
        shouldEndRace = true;
      } else {
        const anyHumanFinished = humanRacers.some((r) => r.car && r.car.finished);
        if (anyHumanFinished) {
          if (this.firstHumanFinishTime == null) {
            this.firstHumanFinishTime = this.raceTime;
          }
          if (this.raceTime - this.firstHumanFinishTime >= CONFIG.FINISH_GRACE_SECONDS) {
            shouldEndRace = true;
          }
        }
      }
    } else {
      // 只有 AI 或真人全部斷線時，所有車輛都完賽才結束（不可對空陣列呼叫 every）
      if (this.racers.length > 0 && this.racers.every((r) => r.car && r.car.finished)) {
        shouldEndRace = true;
      }
    }

    // 安全時間上限，超過 MAX_RACE_SECONDS 強制結算
    if (this.raceTime >= (CONFIG.MAX_RACE_SECONDS || 300)) {
      shouldEndRace = true;
    }

    if (shouldEndRace) {
      this._endRace();
    }
  }

  // 結束比賽進入結算畫面
  _endRace() {
    this._state = 'results';
    this.resultsTimer = 0;

    // 未完賽的車輛依據進度名次定案，成績記為 null
    for (const racer of this.racers) {
      if (racer.car && !racer.car.finished) {
        racer.rank = racer.position;
      }
    }

    this.emit('stateChanged', { state: 'results' });
    this.emit('sound', 'race_over');
  }

  // 加入真人玩家（鍵盤或遠端手機）
  addPlayer({ name, kind = 'keyboard', input = null } = {}) {
    if (this.players.size >= CONFIG.MAX_PLAYERS) {
      return null; // 真人已滿 4 位
    }

    // 尋找 0~3 中第一個未被占用的 slot
    const usedSlots = new Set([...this.players.values()].map((p) => p.slot));
    let slot = 0;
    while (slot < CONFIG.MAX_PLAYERS && usedSlots.has(slot)) {
      slot++;
    }

    const kartInfo = KARTS[slot] || KARTS[0];
    const playerId = 'p_' + this.nextPlayerId++;
    const inRace = (this._state === 'lobby');

    const player = {
      id: playerId,
      name: name || `玩家${slot + 1}`,
      kind,
      slot,
      color: kartInfo.color,
      input: input || new NullInput(),
      car: null,
      inRace,
      position: null,
      rank: null,
      item: null,
      rolling: false,
      rollingTimer: 0,
    };

    this.players.set(playerId, player);
    this.emit('playerJoined', { player });

    return player;
  }

  // 移除真人玩家
  removePlayer(playerId) {
    if (!this.players.has(playerId)) return false;

    const player = this.players.get(playerId);
    this.players.delete(playerId);

    // 若比賽進行中有人斷線離開，將該車改為 AI 接手繼續跑
    if (this._state === 'countdown' || this._state === 'racing') {
      const racer = this.racers.find((r) => r.id === playerId);
      if (racer) {
        racer.kind = 'ai';
        racer.name = `${racer.name}(AI)`;
        if (racer.car) {
          racer.input = new AIInput({
            car: racer.car,
            game: this,
            rng: this.rng,
          });
        }
      }
    }

    this.emit('playerLeft', { player });
    return true;
  }

  // 取得真人玩家列表（依 slot 排序）
  getPlayers() {
    return Array.from(this.players.values()).sort((a, b) => a.slot - b.slot);
  }

  // 取得玩家狀態（提供第二階段遠端控制器查詢）
  getStatus(playerId) {
    // 先從 racers 中找（比賽進行中），若無則從 players 中找
    const racer = this.racers.find((r) => r.id === playerId);
    const human = this.players.get(playerId);
    const p = racer || human;

    if (!p) return null;

    if (!p.inRace || !p.car || this._state === 'lobby') {
      return {
        item: null,
        position: null,
        lap: 0,
        totalLaps: CONFIG.LAPS,
        color: p.color,
        state: this._state,
        inRace: false,
      };
    }

    return {
      item: p.item,
      position: p.position,
      lap: p.car.lap,
      totalLaps: CONFIG.LAPS,
      color: p.color,
      state: this._state,
      inRace: true,
    };
  }

  // 開始比賽：從大廳切換至倒數階段，真人上場＋電腦補滿 4 台
  startRace() {
    if (this._state !== 'lobby') return;

    // 清空舊參賽車
    this.racers = [];

    // 1. 將目前已加入的真人標記為 inRace = true
    const humanList = this.getPlayers();
    for (const human of humanList) {
      human.inRace = true;
      human.item = null;
      human.rolling = false;
      human.rollingTimer = 0;
      human.position = null;
      human.rank = null;
      this.racers.push(human);
    }

    // 2. 空位由 AI 補滿 4 台
    const occupiedSlots = new Set(humanList.map((h) => h.slot));
    for (let slot = 0; slot < CONFIG.MAX_PLAYERS; slot++) {
      if (!occupiedSlots.has(slot)) {
        const kartInfo = KARTS[slot] || KARTS[0];
        const aiName = AI_NAMES[slot] || `電腦${slot + 1}`;
        const aiPlayer = {
          id: `ai_${slot}`,
          name: aiName,
          kind: 'ai',
          slot,
          color: kartInfo.color,
          input: null,
          car: null,
          inRace: true,
          position: null,
          rank: null,
          item: null,
          rolling: false,
          rollingTimer: 0,
        };
        this.racers.push(aiPlayer);
      }
    }

    // 3. 依發車位為所有參賽者建立車輛實例
    for (const racer of this.racers) {
      racer.car = new Car({
        slot: racer.slot,
        track: this.track,
        player: racer,
      });

      if (racer.kind === 'ai') {
        racer.input = new AIInput({
          car: racer.car,
          game: this,
          rng: this.rng,
        });
      }
    }

    // 4. 重設道具系統與碰撞冷卻
    this.itemSystem.reset();
    this.collisionCooldowns.clear();

    // 5. 設定倒數並切換狀態
    this.countdownTimer = 0;
    this.countdownValue = 3;
    this._state = 'countdown';

    this.emit('stateChanged', { state: 'countdown' });
    this.emit('sound', 'countdown');
  }

  // 返回大廳：清空比賽車輛與道具，保留已連線的真人玩家
  backToLobby() {
    this.emit('racersCleared', { racers: this.racers });

    for (const racer of this.racers) {
      if (racer.car && typeof racer.car.detachView === 'function') {
        racer.car.detachView();
      }
    }

    this.itemSystem.reset();
    this.collisionCooldowns.clear();
    this.racers = [];

    // 重設真人玩家狀態
    for (const human of this.players.values()) {
      human.inRace = false;
      human.car = null;
      human.item = null;
      human.rolling = false;
      human.rollingTimer = 0;
      human.position = null;
      human.rank = null;
    }

    this._state = 'lobby';
    this.emit('stateChanged', { state: 'lobby' });
  }

  // 設定房間資訊（供 HUD 顯示大廳房號與 QR Code）
  setRoomInfo({ code, url, qrSvg, message } = {}) {
    if (code !== undefined) this.roomInfo.code = code;
    if (url !== undefined) this.roomInfo.url = url;
    if (qrSvg !== undefined) this.roomInfo.qrSvg = qrSvg;
    if (message !== undefined) this.roomInfo.message = message;

    this.emit('roomInfoChanged', this.roomInfo);
  }
}
