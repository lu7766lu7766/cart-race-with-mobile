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
  TRACK_SAMPLES: 600,       // 賽道切成幾個點來計算（越多越精準）

  // ---------- 車輛 ----------
  KART_SCALE: 2.2,          // 卡丁車模型放大倍數
  CAR_RADIUS: 1.5,          // 碰撞用的車子半徑
  MAX_SPEED: 38,            // 最高速
  BOOST_SPEED: 58,          // 加速時的最高速
  REVERSE_SPEED: 12,        // 倒車最高速
  ACCEL: 28,                // 油門加速度
  BRAKE: 55,                // 煞車減速度
  COAST_DRAG: 9,            // 放開油門時的自然減速
  OFFROAD_FACTOR: 0.5,      // 草地上最高速剩幾成
  TURN_RATE: 2.6,           // 轉向速度（弧度/秒）
  KART_YAW_OFFSET: 0,       // 卡丁車模型朝向微調弧度（預設模型車頭朝 +Z，為 0）

  // ---------- 道具 ----------
  ITEM_ROLL_TIME: 0.8,      // 抽道具動畫秒數
  ITEM_BOX_RESPAWN: 3,      // 道具箱幾秒後重新出現
  NITRO_TIME: 1.5,          // 氮氣加速秒數
  PAD_BOOST_TIME: 1.0,      // 加速板加速秒數
  SHIELD_TIME: 5,           // 護盾秒數
  SPIN_TIME: 1.2,           // 踩到香蕉打滑秒數
  HIT_TIME: 1.5,            // 被導彈打中停頓秒數
  MISSILE_SPEED: 80,        // 導彈速度
  MISSILE_LIFE: 2.5,        // 導彈飛行秒數
  MAX_BANANAS: 12,          // 場上最多幾個香蕉

  // ---------- 道具名次加權 ----------
  // 名次從第 1 名（索引 0）到第 4 名（索引 3）
  // 第 1 名偏香蕉與護盾防禦；後段名次偏導彈與氮氣追趕
  ITEM_WEIGHTS: [
    { banana: 45, shield: 35, nitro: 15, missile: 5 },  // 第 1 名
    { banana: 25, shield: 25, nitro: 30, missile: 20 }, // 第 2 名
    { banana: 10, shield: 20, nitro: 40, missile: 30 }, // 第 3 名
    { banana: 5,  shield: 10, nitro: 40, missile: 45 }, // 第 4 名
  ],

  // ---------- 場景物件縮放 ----------
  // Kenney Racing Kit 模型原始單位很小（如 barrier 寬僅 0.25、billboard 高 1），
  // 因此放入 3D 場景時需要放大 8~10 倍與卡丁車尺寸匹配。
  PROP_SCALE: 8,

  // ---------- AI ----------
  AI_SPEED_MIN: 0.92,       // AI 最高速是玩家的幾成（最低）
  AI_SPEED_MAX: 0.96,       // AI 最高速是玩家的幾成（最高）
};

// 四款卡丁車（Kenney Car Kit），依照玩家欄位 0~3 分配
export const KARTS = [
  { file: 'kart-oobi.glb', color: '#2ecc71', colorName: '綠' },
  { file: 'kart-oodi.glb', color: '#a66bff', colorName: '紫' },
  { file: 'kart-ooli.glb', color: '#ff5c8a', colorName: '粉' },
  { file: 'kart-oopi.glb', color: '#ffa41b', colorName: '橘' },
];

// 鍵盤配置：同一台電腦最多兩人
//   KeyboardEvent.code 的名稱可以在 https://keycode.info 查到
export const KEYBOARD_LAYOUTS = [
  {
    id: 'arrows',
    name: '玩家1',
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    item: ['Enter', 'NumpadEnter', 'ShiftRight'],
    help: '↑ 加速　↓ 倒退　← → 轉向　Enter 道具',
  },
  {
    id: 'wasd',
    name: '玩家2',
    up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
    item: ['Space', 'ShiftLeft'],
    help: 'W 加速　S 倒退　A D 轉向　空白鍵 道具',
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
