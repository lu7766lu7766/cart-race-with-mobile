// ============================================================
//  maps.js — 地圖（賽道）資料表
//  每張地圖定義：賽道控制點（形狀與高低起伏）、跳台位置、場景配色主題、
//  路邊裝飾物與背景配樂參數。想新增地圖，就在 MAPS 陣列多加一筆！
//  本模組為純資料定義，可在 Node.js 與瀏覽器環境中執行（無 DOM 依賴）。
//
//  新增地圖注意事項（tests/track.test.js 會自動檢查每一張地圖）：
//  1. 控制點 points 為 [x, y, z]，y 是路面高度（0 ~ 16），會再乘上 scale 放大 x、z。
//  2. 賽道總長建議 1150 ~ 1500，任兩段不相鄰的路面平面距離要 > 路寬 + 12，坡度 <= 0.2。
//  4. width：路面寬度（每張地圖可以不同，越窄越難開）。
//  5. zones：特殊路段，from / to 是賽道進度比例（0 ~ 1）：
//       'sand'   流沙：路面上的沙堆，最高速與加速變慢
//       'ice'    結冰：轉向抓地力變差、煞車變弱，但甩尾集氣更快
//       'canyon' 峽谷：兩側地形變成高聳岩壁（只影響外觀）
//       'tunnel' 隧道：賽道上方蓋一條隧道（只影響外觀）
//  6. stars：地圖難度（1 ~ 3 顆星，顯示在大廳地圖卡片）。
//  7. theme.terrain：賽道外的地形起伏（hills 山丘、dunes 沙丘、mountains 雪山谷地）。
//  3. 跳台 jumps 的 index（0 ~ 899）要離道具箱與加速板 15 單位以上，
//     道具箱在賽道 18% / 45% / 68% / 88% 處，加速板在 8% / 55% / 78% 處。
// ============================================================

export const MAPS = [
  {
    id: 'meadow',
    name: '陽光草原',
    emoji: '🌳',
    stars: 1,
    description: '綠草丘陵間的經典賽道：長上坡、坡頂跳台、S 彎與髮夾彎',
    features: ['🌿 標準路寬', '⛰️ 起伏丘陵', '🛣️ 一般路面', '🔄 大環線'],
    width: 16,
    zones: [],
    scale: 1.15,
    points: [
      [0, 0, 110],      // 0: 起終點大直道（平坦 y=0）
      [80, 0, 110],     // 1: 直道加速段
      [160, 2.0, 100],  // 2: 第 1 彎進彎，開始緩上坡
      [210, 5.0, 60],   // 3: 高速弧形右彎長上坡
      [230, 8.5, 0],    // 4: 接近坡頂
      [210, 9.5, -60],  // 5: 坡頂至高點
      [160, 7.5, -100], // 6: 坡頂下坡直道（跳台設置處）
      [90, 4.0, -115],  // 7: 快速下坡衝刺
      [20, 2.0, -100],  // 8: 緩衝平緩彎道
      [-40, 1.0, -125], // 9: S 彎入口
      [-100, 3.0, -145],// 10: S 彎中段切換
      [-165, 5.0, -130],// 11: 髮夾彎前置坡道
      [-215, 4.0, -80], // 12: 髮夾急彎煞車點
      [-230, 2.0, -20], // 13: 髮夾急彎頂點（180 度）
      [-210, 0.5, 40],  // 14: 髮夾彎出彎下坡
      [-160, 0, 80],    // 15: 接回低處平原直道
      [-110, 0, 105],   // 16: 回歸大直道前 S 緩彎
      [-50, 0, 110],    // 17: 接回起終點直道
    ],
    jumps: [340],
    theme: {
      sky: 0x87ceeb,          // 天空背景色
      fogDensity: 0.0022,     // 霧的濃度（越大越霧）
      ambient: { color: 0xffffff, intensity: 0.65 },
      sun: { color: 0xffffff, intensity: 1.25 },
      ground: 0x27ae60,       // 大地面顏色
      shoulder: 0x1e824c,     // 路邊草皮減速帶顏色
      road: 0x2c3e50,         // 路面顏色
      roadLine: 0xffffff,     // 中線虛線顏色
      curb: [0xe63333, 0xffffff], // 路肩紅白交替
      wall: [0xd92626, 0xf2f2f2], // 矮牆交替顏色
      ramp: 0xf39c12,         // 跳台顏色
      props: ['treeLarge', 'treeSmall', 'grandStand', 'grandStandCovered', 'tent', 'billboard', 'lightPostModern'],
      scenery: null,          // 額外程式生成的遠景（null 表示沒有）
      terrain: { type: 'hills', amp: 9, colorLow: 0x2ecc71, colorHigh: 0x1e8449 }, // 賽道外地形
      weather: null,          // 天氣粒子（null 表示晴天）
    },
    // 背景音樂：bpm 速度、root 主音（MIDI 編號）、scale 音階、progression 每小節和弦（音階級數）
    music: {
      bpm: 138,
      root: 60,                         // C
      scale: [0, 2, 4, 5, 7, 9, 11],    // 大調
      progression: [0, 4, 5, 3],        // I - V - vi - IV（開朗流行感）
      lead: [0, null, 2, null, 4, 2, null, 4, 7, null, 4, null, 2, 4, 2, null],
      leadWave: 'square',
      bassWave: 'triangle',
    },
  },
  {
    id: 'desert',
    name: '沙漠峽谷',
    emoji: '🏜️',
    stars: 2,
    description: '超長直線衝上 16 米高原，下坡連續雙跳台，最後鑽進峽谷 S 彎',
    features: ['🛣️ 超寬路面', '💨 超長直線', '⛰️ 落差 16 米', '🟫 流沙減速', '🪨 峽谷 S 彎'],
    width: 20,
    zones: [
      { from: 0.13, to: 0.17, type: 'sand' },
      { from: 0.92, to: 0.95, type: 'sand' },
      { from: 0.75, to: 0.92, type: 'canyon' },
    ],
    scale: 1.0,
    // 形狀：回力鏢形，起點是 300 米長直線，接大迴轉爬上高原，高原下坡雙跳台，最後峽谷 S 彎
    points: [
      [0, 0, 0],        // 0: 起終點直道
      [150, 0, 0],      // 1: 超長直線
      [300, 1, 0],      // 2: 直線末端
      [390, 3, -10],    // 3: 大迴轉入口
      [440, 6, -50],    // 4: 大迴轉（邊轉邊爬坡）
      [445, 9, -100],   // 5: 大迴轉頂點
      [400, 12, -140],  // 6: 大迴轉出口
      [300, 14, -155],  // 7: 高原長上坡
      [180, 16, -170],  // 8: 高原最高點（16 米）
      [60, 13, -190],   // 9: 高原下坡（雙跳台）
      [-30, 9, -212],   // 10: 下坡衝刺
      [-110, 6, -215],  // 11: 進入峽谷前
      [-168, 4, -185],  // 12: 峽谷入口彎
      [-188, 3, -135],  // 13: 峽谷 S 彎（左）
      [-170, 3, -88],   // 14: 峽谷 S 彎（右）
      [-172, 2, -45],   // 15: 峽谷出口
      [-125, 0, -8],    // 16: 終點前彎
      [-55, 0, 0],      // 17: 回到起終點直道
    ],
    jumps: [522, 576],
    theme: {
      sky: 0xf6c28b,
      fogDensity: 0.0026,
      ambient: { color: 0xffe2c0, intensity: 0.7 },
      sun: { color: 0xffc58a, intensity: 1.35 },
      ground: 0xe0b46c,
      shoulder: 0xc99a55,
      road: 0x5b4636,
      roadLine: 0xffe08a,
      curb: [0xd35400, 0xfff3e0],
      wall: [0xe67e22, 0xfff3e0],
      ramp: 0xc0392b,
      props: ['tent', 'billboard', 'flagRed', 'grandStand', 'pylon', 'flagCheckers', 'cone'],
      scenery: 'mesas',
      weather: null,
      terrain: { type: 'dunes', amp: 6, cliff: 34, colorLow: 0xe6bd78, colorHigh: 0xa9512a },
    },
    music: {
      bpm: 126,
      root: 57,                          // A
      scale: [0, 1, 4, 5, 7, 8, 10],     // 弗里吉亞屬音階（中東沙漠風）
      progression: [0, 1, 0, 6],         // i - bII - i - bVII
      lead: [0, 1, 2, null, 1, 0, null, 2, 3, null, 2, 1, 0, null, 1, null],
      leadWave: 'sawtooth',
      bassWave: 'square',
    },
  },
  {
    id: 'snow',
    name: '冰雪山道',
    emoji: '❄️',
    stars: 3,
    description: '窄路之字形連續三個髮夾彎爬上 14 米雪山隘口，結冰彎道與山中隧道',
    features: ['↔️ 窄路', '🔁 三連髮夾彎', '🧊 結冰打滑', '🚇 山中隧道', '🏔️ 下山跳台'],
    width: 13,
    zones: [
      { from: 0.13, to: 0.19, type: 'ice' },
      { from: 0.84, to: 0.89, type: 'ice' },
      { from: 0.38, to: 0.45, type: 'tunnel' },
    ],
    scale: 1.0,
    // 形狀：之字形山路，三個半徑約 23 的髮夾彎一路往上爬，從隘口沿西側長下坡回到起點
    points: [
      [-40, 0, 5],      // 0: 起終點直道
      [0, 0, 0],
      [60, 0, 0],
      [100, 1, -5],     // 3~7: 第 1 個髮夾彎（右側，結冰）
      [121, 1.5, -14],
      [130, 2, -35],
      [121, 2.5, -56],
      [100, 3, -65],
      [45, 4, -68],     // 8: 第 1 段之字路
      [-5, 5, -70],     // 9~13: 第 2 個髮夾彎（左側）
      [-26, 5.5, -79],
      [-35, 6, -100],
      [-26, 6.5, -121],
      [-5, 7, -130],
      [55, 8, -132],    // 14: 第 2 段之字路（隧道）
      [115, 9, -135],   // 15~19: 第 3 個髮夾彎（右側）
      [136, 9.5, -144],
      [145, 10, -165],
      [136, 10.5, -186],
      [115, 11, -195],
      [60, 12, -200],   // 20: 第 3 段之字路
      [0, 13, -205],
      [-50, 14, -215],  // 22: 雪山隘口（14 米）
      [-110, 12, -200], // 23: 開始下山
      [-150, 9, -150],  // 24: 長下坡（跳台）
      [-162, 5, -90],   // 25: 下坡彎（結冰）
      [-145, 2, -35],   // 26: 山腳
      [-100, 0, -5],    // 27: 回到起終點直道
    ],
    jumps: [729],
    theme: {
      sky: 0x0c1a3a,
      fogDensity: 0.003,
      ambient: { color: 0x9fb3e6, intensity: 0.6 },
      sun: { color: 0xb8c8ff, intensity: 0.85 },
      ground: 0xdfe8f5,
      shoulder: 0xc2d0e4,
      road: 0x3a4250,
      roadLine: 0x9fe8ff,
      curb: [0x2e86de, 0xffffff],
      wall: [0x2e86de, 0xeef4ff],
      ramp: 0x48dbfb,
      props: ['lightPostModern', 'grandStandCovered', 'billboard', 'lightPostModern', 'tent', 'flagCheckers'],
      scenery: 'pines',
      weather: 'snow',
      terrain: { type: 'mountains', amp: 5, rise: 0.32, max: 70, colorLow: 0xe8f0fa, colorHigh: 0x7f8fa6 },
    },
    music: {
      bpm: 150,
      root: 62,                          // D
      scale: [0, 2, 3, 5, 7, 8, 10],     // 自然小調
      progression: [0, 5, 2, 6],         // i - VI - III - VII（冷冽緊張感）
      lead: [4, 2, 0, 2, 4, null, 7, null, 4, 2, 0, null, 2, null, 0, null],
      leadWave: 'triangle',
      bassWave: 'sawtooth',
    },
  },
];

export const DEFAULT_MAP_ID = MAPS[0].id;

// 依 id 取得地圖，找不到時回傳預設地圖
export function getMap(id) {
  return MAPS.find((m) => m.id === id) || MAPS[0];
}

// 取得地圖在 MAPS 中的索引（找不到回傳 0）
export function getMapIndex(id) {
  const idx = MAPS.findIndex((m) => m.id === id);
  return idx >= 0 ? idx : 0;
}
