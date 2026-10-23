// ============================================================
//  config.js — 遊戲的所有「可以調整的數字」都放在這裡
//  想讓車子更快、圈數更多？改這個檔案就好！
//  本模組為純常數定義，可在 Node.js 與瀏覽器環境中執行。
// ============================================================

export const CONFIG = {
  MAX_PLAYERS: 4,           // 一場最多幾台車（真人 + AI）
  LAPS: 3,                  // 要跑幾圈
  RESULTS_SECONDS: 20,      // 結算畫面停留幾秒後自動回大廳
  FINISH_GRACE_SECONDS: 25, // 第一位真人完賽後，最多再等幾秒就結束比賽
  MAX_RACE_SECONDS: 300,    // 比賽最長持續時間（秒），超時強制結算防止卡死

  // ---------- 賽道 ----------
  TRACK_WIDTH: 16,          // 路面寬度
  SHOULDER: 4,              // 路面外的草地寬度（開上去會變慢）
  TRACK_SAMPLES: 900,       // 賽道切成幾個點來計算（加長賽道至 1200~1500）
  TRACK_MAX_HEIGHT: 10,     // 賽道最高起伏高度
  GRAVITY: 40,              // 重力加速度

  // ---------- 車輛基礎物理 ----------
  KART_SCALE: 2.2,          // 卡丁車模型放大倍數
  CAR_RADIUS: 1.5,          // 碰撞用的車子半徑
  MAX_SPEED: 38,            // 最高速
  BOOST_SPEED: 58,          // 加速時的最高速
  REVERSE_SPEED: 12,        // 倒車最高速
  ACCEL: 28,                // 油門加速度
  BRAKE: 55,                // 煞車減速度
  COAST_DRAG: 9,            // 放開油門時的自然減速
  OFFROAD_FACTOR: 0.5,      // 預設草地上最高速剩幾成（粉色角色可覆寫）
  TURN_RATE: 2.6,           // 轉向速度（弧度/秒）
  KART_YAW_OFFSET: 0,       // 卡丁車模型朝向微調弧度（模型車頭朝 +Z，為 0）

  // ---------- 甩尾與迷你加速 ----------
  DRIFT_MIN_SPEED: 15,      // 觸發甩尾的最低車速
  DRIFT_T1: 0.8,            // 藍色迷你加速集氣門檻（秒）
  DRIFT_T2: 1.6,            // 橘色迷你加速集氣門檻（秒）
  DRIFT_T3: 2.6,            // 紫色迷你加速集氣門檻（秒）
  DRIFT_BOOST_T1: 0.5,      // 藍色加速持續時間（秒）
  DRIFT_BOOST_T2: 1.0,      // 橘色加速持續時間（秒）
  DRIFT_BOOST_T3: 1.5,      // 紫色加速持續時間（秒）

  // ---------- 起跑衝刺與跳台 ----------
  ROCKET_BOOST_TIME: 1.0,   // 起跑衝刺基礎加速時間（秒）
  ROCKET_SPIN_TIME: 0.5,    // 太早按油門空轉懲罰時間（秒）
  JUMP_MIN_AIR_BOOST: 0.4,  // 觸發落地加速所需的最低滯空時間（秒）
  JUMP_BOOST_TIME: 0.4,     // 跳台成功著地獲得的小衝刺時間（秒）

  // ---------- 逆向警告 ----------
  WRONG_WAY_MIN_SPEED: 4,   // 車頭朝反方向且前進速度超過此值才算逆向
  WRONG_WAY_DELAY: 0.6,     // 逆向持續幾秒才跳出警告（避免打滑、碰撞瞬間誤判）

  // ---------- 追尾鏡頭參數 ----------
  CHASE_DISTANCE: 10,       // 追尾鏡頭在車身後方的水平距離
  CHASE_HEIGHT: 4.5,        // 追尾鏡頭在車身上方的基準高度
  CHASE_LOOK_AHEAD: 6,      // 追尾鏡頭向前看向焦點的距離
  CHASE_POS_DAMP: 8,        // 鏡頭位置跟隨平滑率
  CHASE_ROT_DAMP: 5,        // 鏡頭朝向跟隨平滑率（較慢以體現甩尾側滑感）
  CHASE_FOV_MIN: 60,        // 靜止或低速時的相機視野 FOV
  CHASE_FOV_MAX: 72,        // 極速行駛時的動態相機視野 FOV
  CHASE_FOV_BOOST: 6,       // 加速時額外增加的 FOV

  // ---------- 道具 ----------
  ITEM_ROLL_TIME: 0.8,      // 抽道具動畫秒數
  ITEM_BOX_RESPAWN: 3,      // 道具箱幾秒後重新出現
  NITRO_TIME: 1.5,          // Lv1 氮氣加速秒數
  PAD_BOOST_TIME: 1.0,      // 加速板加速秒數
  SHIELD_TIME: 5,           // Lv1 護盾秒數
  SPIN_TIME: 1.2,           // 踩到香蕉打滑秒數
  HIT_TIME: 1.5,            // 被導彈打中停頓秒數
  MISSILE_SPEED: 80,        // 導彈速度
  MISSILE_LIFE: 2.5,        // 導彈飛行秒數
  MAX_BANANAS: 12,          // 場上最多幾個香蕉

  // ---------- 道具等級效果參數 ----------
  ITEM_LEVELS: {
    nitro: [1.5, 2.5, 3.5],          // 各等級加速時間（Lv3 加速碰撞可撞飛對方）
    shield: [5.0, 8.0, 8.0],         // 各等級持續時間（Lv3 無限次阻擋且彈飛撞碰者）
    bananaSpinTime: [1.2, 1.2, 2.0], // 打滑時間（Lv3 巨大香蕉 2.0 秒）
  },

  // ---------- 道具名次加權 ----------
  // 名次從第 1 名（索引 0）到第 4 名（索引 3）
  ITEM_WEIGHTS: [
    { banana: 45, shield: 35, nitro: 15, missile: 5 },  // 第 1 名
    { banana: 25, shield: 25, nitro: 30, missile: 20 }, // 第 2 名
    { banana: 10, shield: 20, nitro: 40, missile: 30 }, // 第 3 名
    { banana: 5,  shield: 10, nitro: 40, missile: 45 }, // 第 4 名
  ],

  // ---------- 場景物件縮放 ----------
  PROP_SCALE: 8,

  // ---------- AI ----------
  AI_SPEED_MIN: 0.92,       // AI 最高速是玩家的幾成（最低）
  AI_SPEED_MAX: 0.96,       // AI 最高速是玩家的幾成（最高）
};

// 四款卡丁車與角色被動能力（依玩家欄位 0~3 分配）
export const KARTS = [
  {
    file: 'kart-oobi.glb',
    color: '#2ecc71',
    colorName: '綠',
    character: '衝刺手',
    ability: '起步快、起跑衝刺更久',
    abilityText: '加速度 ×1.25；起跑衝刺時間 ×1.5',
    stats: {
      accelMult: 1.25,
      maxSpeedMult: 1.0,
      boostSpeedMult: 1.0,
      driftChargeRate: 1.0,
      offroadFactor: 0.5,
      pushMultOther: 1.0,
      pushMultSelf: 1.0,
      hitStunMult: 1.0,
      startBoostTime: 1.5,
    },
  },
  {
    file: 'kart-oodi.glb',
    color: '#a66bff',
    colorName: '紫',
    character: '極速王',
    ability: '極速最快，起步稍慢',
    abilityText: '最高速 ×1.05；加速度 ×0.9',
    stats: {
      accelMult: 0.9,
      maxSpeedMult: 1.05,
      boostSpeedMult: 1.05,
      driftChargeRate: 1.0,
      offroadFactor: 0.5,
      pushMultOther: 1.0,
      pushMultSelf: 1.0,
      hitStunMult: 1.0,
      startBoostTime: 1.0,
    },
  },
  {
    file: 'kart-ooli.glb',
    color: '#ff5c8a',
    colorName: '粉',
    character: '甩尾高手',
    ability: '甩尾集氣快，越野不怕草地',
    abilityText: '甩尾集氣速度 ×1.35；草地減速僅剩 ×0.65',
    stats: {
      accelMult: 1.0,
      maxSpeedMult: 1.0,
      boostSpeedMult: 1.0,
      driftChargeRate: 1.35,
      offroadFactor: 0.65,
      pushMultOther: 1.0,
      pushMultSelf: 1.0,
      hitStunMult: 1.0,
      startBoostTime: 1.0,
    },
  },
  {
    file: 'kart-oopi.glb',
    color: '#ffa41b',
    colorName: '橘',
    character: '重戰車',
    ability: '撞不倒，被打中恢復快',
    abilityText: '碰撞推開對方 ×2、自己 ×0.5；被導彈停頓時間 ×0.6',
    stats: {
      accelMult: 1.0,
      maxSpeedMult: 1.0,
      boostSpeedMult: 1.0,
      driftChargeRate: 1.0,
      offroadFactor: 0.5,
      pushMultOther: 2.0,
      pushMultSelf: 0.5,
      hitStunMult: 0.6,
      startBoostTime: 1.0,
    },
  },
];

// 鍵盤配置：支援甩尾按鍵
export const KEYBOARD_LAYOUTS = [
  {
    id: 'arrows',
    name: '玩家1',
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    drift: ['ShiftRight'],
    item: ['Enter', 'NumpadEnter'],
    help: '↑ 加速　↓ 倒退　← → 轉向　右Shift 甩尾　Enter 道具',
  },
  {
    id: 'wasd',
    name: '玩家2',
    up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
    drift: ['ShiftLeft'],
    item: ['Space'],
    help: 'W 加速　S 倒退　A D 轉向　左Shift 甩尾　空白鍵 道具',
  },
];

// 道具資訊：名稱與圖示
export const ITEMS = {
  nitro:   { icon: '⚡', name: '氮氣加速' },
  banana:  { icon: '🍌', name: '香蕉皮' },
  missile: { icon: '🚀', name: '導彈' },
  shield:  { icon: '🛡️', name: '護盾' },
};

// AI 的名字
export const AI_NAMES = ['電腦阿光', '電腦小美', '電腦阿強', '電腦小雨'];
