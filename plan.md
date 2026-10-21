# 網頁 3D 道具賽車遊戲 — 計畫書（陸行鳥大賽車風格升級版）

> 文件日期：2026-10-20
> 用途：教學專案。老師先完成「第一階段」可玩的遊戲（陸行鳥大賽車風格）；學生把本文件第 7 節的提示詞貼到 AI 編碼工具（Claude Code / Cursor），讓遊戲升級為「第二階段」手機體感多人對戰。

---

## 1. 目標

| 階段 | 內容 | 誰來做 |
|---|---|---|
| 第一階段（`main` 分支） | 瀏覽器開啟就能玩的 3D 道具競速（陸行鳥大賽車風格）。自動分割畫面追尾視角、鍵盤操作（方向鍵 / WASD，同機雙人各自追尾）、甩尾迷你加速、魔石道具升級、跳台起飛與角色被動能力，AI 電腦車補到 4 台。已內建大廳、房號區、輸入抽象層與自動化測試，為第二階段先鋪好路。 | 老師（本專案直接完成，發給學生的起始專案） |
| 第二階段（`phase2` 分支） | 大螢幕顯示**房間號碼**與 QR Code，手機輸入房號後透過 **WebSocket** 加入。手機橫拿當方向盤，用**陀螺儀/重力感測**左右傾斜轉向；**右側**按鈕加速、**左側**按鈕倒退（同時按雙鍵可甩尾）、**中央**按鈕放道具（顯示等級星星）。 | 學生（貼上提示詞讓 AI 完成）＋老師的參考解答分支 |

---

## 2. 遊戲引擎選型

| 引擎 | 類型 | 優點 | 缺點 | 結論 |
|---|---|---|---|---|
| **Three.js** | 3D 繪圖函式庫（JS） | 最普及的網頁 3D 方案、檔案小、免建置工具（import map 即可）、AI 工具最熟悉、和 WebSocket／手機感測器 API 直接整合 | 物理與遊戲邏輯要自己寫（賽車用簡易街機物理即可） | ✅ **採用** |
| Babylon.js | 3D 遊戲引擎（JS） | 功能完整、內建物理（Havok） | 體積大、API 多，初學者與 AI 產生的程式較冗長 | 備選 |
| PlayCanvas | 3D 引擎＋線上編輯器 | 編輯器好用 | 依賴雲端編輯器，不利於「貼提示詞改程式」的教學流程 | 不採用 |
| Godot（Web 匯出） | 完整遊戲引擎 | 編輯器強大 | 匯出檔大、iOS Safari 相容性與手機感測器整合麻煩，學生無法用 AI 直接改 | 不採用 |
| Phaser | 2D 引擎 | 簡單 | 只有 2D；3D 可行就不需要退回 2D | 不採用 |

**結論：Three.js（固定版本 `three@0.186.1`）＋自寫街機物理＋Node.js 伺服器。** 3D 可行，不需要退回 2D。

---

## 3. 已確認的需求決策（陸行鳥大賽車風格）

| 項目 | 決定 |
|---|---|
| 畫面 | 大螢幕**自動分割畫面追尾鏡頭**（1 人全螢幕、2 人左右各半、3~4 人 2×2 四格；3 人時第 4 格為全場俯視），大廳慢速環繞起點，結算全場俯視 |
| 玩法 | **3 圈競速＋道具升級＋甩尾迷你加速**：起跑衝刺、倒數 3-2-1-GO → 甩尾積蓄火花 → 迷你加速衝刺；路面跳台飛越與落地衝刺 |
| 道具 | ⚡ 加速氮氣、🍌 香蕉皮、🚀 導彈、🛡️ 護盾，支援**魔石升級（Lv1 ~ Lv3）**；高度差 > 2.5 可跳躍避讓道具 |
| 角色 | 4 款卡丁車對應 4 種角色能力：衝刺手（起步與衝刺強）、極速王（最高速）、甩尾高手（集氣快/越野減速輕）、重戰車（抗撞/受創恢復快） |
| 人數 | 一場最多 **4** 台車，空位由 AI 補上 |
| 美術 | **Kenney 免費 3D 模型**（CC0）：Car Kit 卡丁車 4 款、Racing Kit 場景道具。賽道路面、路肩、裙邊、跳台用程式生成 |
| 第一階段預先內建 | 同機分割畫面雙人、AI 電腦車、**輸入抽象層（含 drift）**、大廳畫面＋房號顯示區、自動化測試（`tests/`） |
| 執行環境 | 教室電腦安裝 Node.js（≥ 18）；第一階段就用 `npm install` → `npm start` |
| 第二階段部署 | **教室區網**：老師電腦執行伺服器，手機連同一個 Wi-Fi；用自簽憑證提供 HTTPS（手機感測器必須在 HTTPS 下才能使用） |
| 手機道具鍵 | 手機橫拿時**畫面中央**的圓形按鈕，顯示目前持有道具與等級星號；同時按油門與倒退為甩尾；被擊中時手機震動 |
| 學生工具 | Claude Code / Cursor 等能直接讀寫專案檔案的 AI 工具 |
| 學生程度 | 初學者 → 程式碼加大量中文註解；每個提示詞附「怎麼確認成功」 |
| 分支策略 | 參考解答位於 `phase2` 分支，學生可直接 switch 體驗完整成品；兩分支共用 `game/` 目錄 |

---

## 4. 技術架構

```
             ┌─────────────── 老師電腦（Node.js server.js）───────────────┐
             │  HTTP  :3000  → 大螢幕遊戲（localhost）                     │
             │  HTTPS :3443  → 手機控制器（自簽憑證，第二階段）             │
             │  WebSocket /ws → 房間管理、轉送手機輸入（第二階段）          │
             └────────────────────────────────────────────────────────────┘
    大螢幕瀏覽器 (index.html)                    手機瀏覽器 (controller.html)
    Three.js 分割畫面渲染 + 物理核心（權威端）  ◀─ws─▶  陀螺儀方向 + 油門/倒退/甩尾/道具按鈕
```

- **遊戲邏輯全部在大螢幕端執行**（權威端），手機只送輸入、只收少量狀態（道具等級、名次、圈數、震動）。
- 不使用打包工具（Vite/webpack），用瀏覽器原生 ES Modules ＋ import map。

### 資料夾結構

```
cart-race-with-mobile/
├─ plan.md                    ← 本文件
├─ README.md                  ← 學生指引（含分支切換說明）
└─ game/                      ← 遊戲主專案（main 分支為第一階段，phase2 分支為第二階段完成版）
   ├─ package.json            ← 依賴：three@0.186.1、測試腳本
   ├─ server.js               ← 靜態檔案伺服器，零額外依賴
   ├─ tests/                  ← 自動化測試（npm test）
   │  ├─ utils.test.js
   │  ├─ track.test.js
   │  ├─ car.test.js
   │  ├─ drift.test.js
   │  ├─ items.test.js
   │  ├─ jump.test.js
   │  └─ race.test.js
   └─ public/
      ├─ index.html           ← 大螢幕遊戲頁（import map 指向 /lib/three/）
      ├─ css/style.css
      ├─ models/              ← Kenney 模型＋授權檔（已放好）
      │  ├─ karts/kart-oobi|oodi|ooli|oopi.glb + Textures/colormap.png
      │  └─ props/ treeLarge, treeSmall, grandStand, grandStandCovered, overheadLights,
      │            barrierRed, barrierWhite, flagCheckers, flagRed, flagGreen, tent,
      │            lightPostModern, billboard, pylon, cone
      └─ js/
         ├─ main.js           ← 啟動、分割畫面渲染迴圈、事件掛載、window.game
         ├─ game.js           ← 遊戲核心邏輯、狀態機、固定步長模擬、起跑衝刺、對外 API
         ├─ config.js         ← 所有可調參數（圈數、速度、追尾相機、甩尾集氣、道具等級、角色能力）
         ├─ utils.js          ← clamp/lerp/角度差、mulberry32、getViewportRects、事件系統 Emitter
         ├─ assets.js         ← GLB 載入（失敗時用方塊代替，不會整個壞掉）
         ├─ track.js          ← 賽道幾何、高度連續地面、跳台、路面、路肩、裙邊、矮牆
         ├─ car.js            ← 車輛物理、角色能力乘數、空中重力、甩尾集氣、視圖同步
         ├─ input.js          ← 輸入抽象層：KeyboardInput（支援 drift）、NullInput
         ├─ ai.js             ← AIInput（含 60% 保留道具等升級策略）
         ├─ items.js          ← 魔石道具升級（Lv1~Lv3）、追蹤導彈、香蕉、護盾、加速板
         ├─ camera.js         ← ChaseCamera 追尾相機、OverviewCamera 全場相機、getViewportRects
         ├─ hud.js            ← 分割畫面專屬 HUD 面板、大廳角色說明、小地圖、Sprite 名字
         ├─ audio.js          ← WebAudio 合成音效（甩尾摩擦、迷你加速、道具升級、跳台起飛與落地）
         └─ network.js        ← 空殼：export function initNetwork(game) {}（第二階段實作）
```

---

## 5. 第一階段規格（老師完成，可直接遊玩）

### 5.1 遊戲流程（狀態機）
`loading` → `lobby` → `countdown`（3-2-1-GO，含起跑衝刺檢測）→ `racing` → `results`（20 秒後或按 Enter 回大廳）→ `lobby`

### 5.2 操作

| 玩家 | 加速 | 倒退/煞車 | 轉向 | 甩尾集氣 | 道具 | 加入（大廳） |
|---|---|---|---|---|---|---|
| P1 | ↑ | ↓ | ← → | 右 Shift | Enter / 小鍵盤 Enter | 按 ↑ |
| P2 | W | S | A D | 左 Shift | 空白鍵 | 按 W |

大廳：按 Enter 開始（沒人加入時 P1 自動加入），空位由 AI 補滿 4 台；比賽中按 Esc 回大廳。

### 5.3 賽道（`track.js`）
- 18 個控制點組成封閉的 `CatmullRomCurve3`，總長 1200～1500 單位；平均取樣 N=900 點，具備長上坡、坡頂高點、下坡跳台、S 彎與髮夾彎。
- 路面寬 16、兩側各 4 單位草地（減速），外側為紅白條紋矮牆，牆外有向地面 y=0 延伸之斜坡裙邊。
- `track.groundHeight(index, t)` 連續高度計算；`track.project(x, z, hintIndex)` 回傳 `{ index, lateral, t }`。
- 跳台設置於坡頂下坡處（楔形斜坡，長 6、高 1.5），正向高速通過會起飛滯空。

### 5.4 車輛物理與角色能力（`car.js`）
- 街機手感駕駛物理（6.0 修正：steer=+1 往右轉，heading 減少）。
- 4 款角色被動能力（透過 `car.stats` 乘數套用）：
  - 🟢 衝刺手（綠）：accel × 1.25，起跑衝刺時間 × 1.5。
  - 🟣 極速王（紫）：最高速 × 1.05，accel × 0.9。
  - 🌸 甩尾高手（粉）：甩尾集氣速度 × 1.35，草地減速僅剩 × 0.65。
  - 🟠 重戰車（橘）：碰撞推開對方 × 2、自己 × 0.5；被導彈停頓時間 × 0.6。
- 起跑衝刺：倒數最後 1 秒按下油門並持續按住可在 GO 時衝刺；太早按住受到 0.5 秒空轉懲罰。
- 甩尾迷你加速：入彎按住甩尾，集氣至藍色（Lv1: 0.5s）、橘色（Lv2: 1.0s）、紫色（Lv3: 1.5s），放開即噴射加速；往外打方向盤拉成大弧，離地或撞牆中斷集氣，草地不中斷。
- 垂直物理：在地面跟隨路面高度與坡度俯仰；離地（跳台或導彈）受重力作用，滯空 > 0.4 秒著地獲落地小衝刺。

### 5.5 道具系統與魔石升級（`items.js`）
- 道具箱 4 排 × 4 個，吃到後 3 秒重生。
- 持有道具時再吃箱子可將道具升級至最高 Lv3：
  - ⚡ **氮氣**：Lv1: 1.5s；Lv2: 2.5s；Lv3: 3.5s 且衝撞可撞翻對手。
  - 🍌 **香蕉**：Lv1: 後方 1 個；Lv2: 後方扇形 3 個；Lv3: 巨大香蕉 1 個（半徑×2、打滑2秒）＋前方 15 單位 1 個香蕉（免疫時間 1.5 秒）。
  - 🚀 **導彈**：Lv1: 直線飛行；Lv2: 追蹤鎖定前方最近賽車；Lv3: 多重鎖定前方所有賽車發射導彈（最多 3 枚）。
  - 🛡️ **護盾**：Lv1: 5s 擋一次；Lv2: 8s 擋一次；Lv3: 8s 無限次阻擋且碰撞彈飛對手。
- 高度差判定：車輛與道具高度差 > 2.5 單位時不發生碰撞（可跳躍避開香蕉）。

### 5.6 AI（`ai.js`）
- 依據 6.0 左右轉向定義導航，遇急彎減速，卡住脫困。
- 魔石升級策略：拿到 Lv1/Lv2 道具後以 60% 機率留到通過下一排道具箱後再施放；Lv2/Lv3 導彈前方有車即發射。

### 5.7 鏡頭（`camera.js`）
- `ChaseCamera`（每位真人各一）：動態 FOV（60~72，加速+6）、甩尾側滑朝向平滑跟隨、防穿地高程保護、圖層隔離（不顯示自己的名字 Sprite）。
- `OverviewCamera`：大廳慢速環繞起點直道、結算全場俯視、3 人對戰第 4 格全場俯視。
- `getViewportRects(count, W, H)`：支援 1~4 人分割畫面 WebGL 與 CSS 座標計算。

### 5.8 HUD（`hud.js`）
- 分割畫面每格專屬面板：左上名次大字與圈數、右上道具格（圖示＋星號 ★/★★/★★★）、左下速度表、下方中央甩尾火花集氣條、受擊紅框閃爍、完賽徽章。
- 大廳：顯示 4 款角色名稱與被動能力說明、房號與 QR Code 區。
- 小地圖：單人置於右下，多人置於十字交界正中央。

### 5.9 對外介面（重點）

```js
input.getState() → { steer, throttle, brake, drift, useItem }

window.game = game;                             // 供瀏覽器 Console 除錯
game.state                                      // 'loading'|'lobby'|'countdown'|'racing'|'results'
game.addPlayer({ name, kind: 'remote', input }) // → player，或 null（滿 4 人）
game.removePlayer(playerId)                     // 比賽中離開：該車改由 AI 接手
game.getPlayers()                               // 取得真人玩家陣列（依 slot 排序）
game.getStatus(playerId)                        // → { item, itemLevel, position, lap, totalLaps, color, state, inRace } 或 null
game.setRoomInfo({ code, url, qrSvg, message }) // 大廳顯示房號、網址、QR Code 與狀態訊息
game.on('itemChanged', ({ player, item, level }) => …) // level: 1~3 或 0
game.on('playerHit',  ({ player, by }) => …)    // 給手機震動用
game.on('miniTurbo',  ({ player, level }) => …) // 迷你加速事件
game.on('jumped',     ({ player }) => …)
game.on('landed',     ({ player, airTime }) => …)
game.on('wallHit',    ({ player }) => …)
game.on('lapChanged', ({ player, lap }) => …)
game.on('positionChanged', ({ player, position }) => …)
game.on('stateChanged', ({ state }) => …)
game.on('playerFinished', ({ player, rank, time }) => …)
```

### 5.10 實作工作拆解（老師端完成）

- [x] 1. 空殼伺服器與 HTML 架構
- [x] 2. 賽道幾何計算與 3D 渲染（`track.js`）
- [x] 3. 車輛物理核心與輸入控制（`car.js`, `input.js`）
- [x] 4. 甩尾迷你加速與角色被動能力
- [x] 5. 賽道起伏、跳台與滯空重力
- [x] 6. 魔石道具升級系統（`items.js`）
- [x] 7. AI 電腦玩家與升級策略（`ai.js`）
- [x] 8. 自動分割畫面追尾相機（`camera.js`）
- [x] 9. 分割畫面專屬 HUD 面板與小地圖（`hud.js`）
- [x] 10. WebAudio 音效系統（`audio.js`）
- [x] 11. 自動化測試全數通過（`tests/`）

---

## 6. 第二階段規格（學生透過提示詞完成）

### 6.1 伺服器
- 套件：`ws`（WebSocket）、`selfsigned`（產生自簽憑證）、`qrcode`（產生 QR Code SVG）。
- 同時開 HTTP `:3000`（大螢幕用 localhost）與 HTTPS `:3443`（手機用），兩者共用同一套 WebSocket 處理（路徑 `/ws`）。
- 憑證第一次啟動時產生，存在 `cert/`，之後重複使用（手機只需要信任一次）。
- `GET /api/server-info` → `{ controllerUrl: "https://<區網IP>:3443/controller.html", qrSvg }`
- 啟動時在終端機印出區網 IP 與手機網址。
- 每 15 秒對每個連線送 ping，沒有回 pong 的連線就關閉（處理手機休眠的半開連線）。

### 6.2 WebSocket 訊息協定（JSON）

| 方向 | 訊息 | 說明 |
|---|---|---|
| 大螢幕→伺服器 | `{type:'host'}` | 建立房間 |
| 伺服器→大螢幕 | `{type:'roomCreated', code:'4821'}` | 4 位數房號，不與現有房間重複 |
| 手機→伺服器 | `{type:'join', code, name}` | 加入房間 |
| 伺服器→手機 | `{type:'joined', playerId}` 或 `{type:'error', message}` | 房號錯誤、房間已滿（4 人）等 |
| 伺服器→大螢幕 | `{type:'playerJoined', playerId, name}` / `{type:'playerLeft', playerId}` | |
| 手機→伺服器→大螢幕 | `{type:'input', steer, throttle, brake, item}`（大螢幕收到時多一個 `playerId`） | 每秒 30 次；`item` 為累加計數器，大螢幕比對數字增加時才觸發一次道具，封包遺失也不會重複觸發；`throttle` 與 `brake` 同時為 1 時大螢幕當成甩尾 |
| 大螢幕→伺服器→手機 | `{type:'toPlayer', playerId, data}` → 手機收到 `data` | `data`：`{type:'status', item, itemLevel, position, lap, totalLaps, color, state, inRace}`、`{type:'vibrate', ms}` |
| 伺服器→手機 | `{type:'roomClosed'}` | 大螢幕關閉或重新整理 |

### 6.3 大螢幕（`network.js`）
- 連線 `ws(s)://<目前網址>/ws`，送出 `host`，用 `game.setRoomInfo` 顯示房號＋QR Code＋網址。
- `RemoteInput` 類別（實作 `getState()`）：保存最新輸入；超過 500 ms 沒收到就自動歸零（避免斷線暴衝）。
- `playerJoined` → `game.addPlayer({kind:'remote'})`；`playerLeft` → `game.removePlayer`。
- 訂閱 `game.on(...)` 事件，把道具（status 多 itemLevel）、名次、圈數、車色、震動傳給對應手機。
- 斷線時每 2 秒自動重連。

### 6.4 手機控制器（`public/controller.html`＋`js/controller.js`）
- **步驟 1**：輸入房號（數字鍵盤）＋暱稱 →「開始」按鈕。按下時（必須在使用者點擊當下）呼叫 `DeviceMotionEvent.requestPermission()` / `DeviceOrientationEvent.requestPermission()`（iOS），並嘗試全螢幕、鎖定橫向、Wake Lock 防止螢幕變暗。
- **步驟 2（橫向）**：左半邊大按鈕「倒退」、右半邊大按鈕「油門」、中央圓形道具鈕（顯示 ⚡🍌🚀🛡️ 或空，道具鈕顯示 ★ 等級）；同時按油門＋倒退時兩個都送 1，大螢幕會當成甩尾；上方顯示名次/圈數，背景為車色；方向盤圖示即時顯示傾斜角度；「校正」與「反轉方向」小按鈕。直拿時顯示「請把手機轉橫」。
- **轉向演算法**：用 `devicemotion` 的 `accelerationIncludingGravity`（重力向量），依 `screen.orientation.angle` 換算成螢幕座標，算出 `atan2` 傾斜角；扣掉校正值、3° 死區，±35° 對應 steer -1～+1，並做低通濾波。沒有 devicemotion 時退回 `deviceorientation`。
- 觸控用 `touchstart/touchend`＋`preventDefault`，支援多指同時按（油門＋道具），並停用縮放與長按選取。
- 收到 `vibrate` 時呼叫 `navigator.vibrate`（iOS 不支援時改用畫面閃紅）。

---

## 7. 學生用提示詞（第二階段）

> 使用方式：用 Claude Code 或 Cursor 開啟 `game` 資料夾，**依序**貼上提示詞 1 → 4，每一步都照「確認成功」做檢查，成功後再進行下一步。出錯時貼上「提示詞 Ⓐ 除錯」。

### 提示詞 1：伺服器加入 WebSocket 房間與 HTTPS

```
你是我的程式老師，我是初學者。這是一個用 Three.js 寫的網頁賽車遊戲專案（第一階段已完成，可用鍵盤玩）。
請先閱讀 server.js、public/js/game.js、public/js/network.js 了解專案，然後修改 server.js，加入手機多人連線需要的伺服器功能：

1. 安裝並使用套件：ws（WebSocket）、selfsigned（自簽憑證）、qrcode（產生 QR Code），更新 package.json。安裝後執行 npm audit，確認沒有 high 等級的安全漏洞。注意：selfsigned 5 版以後的 generate() 是 async，要用 await 取得結果；簽章演算法要指定 algorithm:'sha256'（預設的 sha1 會被 iPhone 拒絕），有效期設 2 年（notAfterDate），不要超過 825 天。
2. 保留原本 HTTP 3000 埠；另外開 HTTPS 3443 埠，用 selfsigned 產生憑證並存到 cert/ 資料夾，下次啟動直接讀取。兩個埠提供相同的網頁，也都在路徑 /ws 接受 WebSocket 連線（共用同一套處理程式）。
3. 新增 GET /api/server-info，回傳 JSON：{ controllerUrl: "https://<本機區網IPv4>:3443/controller.html", qrSvg: <controllerUrl 的 QR Code SVG 字串> }。區網 IP 用 os.networkInterfaces() 找，排除 127.0.0.1 和虛擬網卡。
4. 房間功能，訊息一律是 JSON：
   - 大螢幕送 {type:'host'} → 建立 4 位數字不重複的房號，回 {type:'roomCreated', code}
   - 手機送 {type:'join', code, name} → 成功回 {type:'joined', playerId}，並通知大螢幕 {type:'playerJoined', playerId, name}；房號不存在或已有 4 位手機玩家就回 {type:'error', message:'中文錯誤訊息'}
   - 手機送 {type:'input', steer, throttle, brake, item} → 加上 playerId 轉給該房間的大螢幕
   - 大螢幕送 {type:'toPlayer', playerId, data} → 把 data 原封不動轉給那支手機
   - 手機斷線 → 通知大螢幕 {type:'playerLeft', playerId}；大螢幕斷線 → 通知所有手機 {type:'roomClosed'} 並刪除房間
   - 每 15 秒對每個連線送 ping，沒有回 pong 的連線就關閉（處理手機休眠的半開連線）；關閉伺服器時要 clearInterval 清掉這個計時器，否則程式（和測試）結束不了
   - 同一個連線重複送 host 或 join 時，先清掉它原本的身分再處理，避免房間裡留下沒人操作的玩家
   - 收到格式錯誤的訊息要忽略，不能讓伺服器當掉
5. 啟動時在終端機用中文印出：大螢幕網址 http://localhost:3000 與手機網址 https://<區網IP>:3443/controller.html。如果 3000 或 3443 埠已被使用（例如上一個伺服器沒關），用中文提示「連接埠已被使用，請先關閉另一個伺服器」後結束，不要丟出英文錯誤堆疊。

請在程式裡加詳細的中文註解。完成後告訴我要執行哪些指令，以及怎麼確認成功。
```

**確認成功**：`npm install` → `npm start`，終端機印出兩個網址；瀏覽器開 `http://localhost:3000/api/server-info` 看到 JSON；原本的遊戲照常能玩。

### 提示詞 2：大螢幕顯示房號並接收手機玩家

```
接續上一步。請閱讀 public/js/game.js、input.js、hud.js 了解遊戲對外提供的 API（game.addPlayer、game.removePlayer、game.getStatus、game.setRoomInfo、game.state、game.on 事件），以及輸入來源的介面 getState() → { steer, throttle, brake, drift, useItem }。
現在請實作 public/js/network.js 裡的 initNetwork(game)：

1. 依照目前網頁的通訊協定連線 WebSocket（http 用 ws://、https 用 wss://，路徑 /ws），連上後送 {type:'host'}。
2. 收到 {type:'roomCreated', code} 後，fetch /api/server-info，呼叫 game.setRoomInfo({ code, url: controllerUrl, qrSvg })，讓大廳顯示房號、手機網址與 QR Code。
3. 建立 RemoteInput 類別（和 KeyboardInput 一樣提供 getState()）：
   - 收到 {type:'input', playerId, steer, throttle, brake, item} 時更新對應玩家的輸入
   - 若 throttle > 0.5 且 brake > 0.5，視為按住甩尾（drift = true）
   - item 是手機端的累加計數器，數字比上次大時，下一次 getState() 回傳 useItem:true（只出現一次）
   - 超過 500 毫秒沒收到輸入就把 steer/throttle/brake 歸零（避免斷線時車子一直衝）
   - 提供 reset() 函式，只清掉還沒被讀取的道具觸發（遊戲在 GO 開跑那一刻會呼叫它）
4. 收到 playerJoined → game.addPlayer({ name, kind:'remote', input: new RemoteInput() })，用 Map<serverPlayerId, gamePlayer> 記住對應關係。
   - 加入成功後立刻送一次 status 給該手機：{type:'toPlayer', playerId, data: {type:'status', ...game.getStatus(player.id)}}（包含 itemLevel）
   - 如果 addPlayer 回傳 null（已滿額），就送 toPlayer 錯誤訊息給手機：{type:'toPlayer', playerId, data: {type:'error', message:'房間已滿（4 位真人）'}}
   - 收到 playerLeft → game.removePlayer(gamePlayer.id)
5. 用 game.on 訂閱事件傳送給手機：
   - itemChanged、positionChanged、lapChanged：只傳給該玩家 {type:'toPlayer', playerId, data: {type:'status', ...game.getStatus(player.id)}}（帶有最新 itemLevel）
   - stateChanged：對所有已連線的手機廣播目前狀態 {type:'status', ...game.getStatus(p.id)}
   - playerHit：另外送 {type:'toPlayer', playerId, data: {type:'vibrate', ms:300}}
6. WebSocket 斷線時（一定要做，否則重連後大廳會殘留舊玩家）：對所有遠端玩家呼叫 game.removePlayer 並清空 Map，大廳顯示「連線中斷，重新連線中…」並清掉舊的 QR Code（呼叫 game.setRoomInfo({ code: null, url: null, qrSvg: null, message: '連線中斷，重新連線中…' })），每 2 秒自動重連並重新建立房間。

不要修改遊戲物理與畫面邏輯，只改 network.js。請加詳細中文註解，完成後告訴我怎麼確認成功。
```

**確認成功**：`npm start` 後開 `http://localhost:3000`，大廳出現 4 位數房號與 QR Code；鍵盤遊玩不受影響；用另一個分頁開 `http://localhost:3000/controller.html`（第 3 步完成後）加入時，大廳出現 📱 玩家。

### 提示詞 3：手機方向盤控制器

```
接續上一步。請新增手機控制器頁面 public/controller.html（含 CSS）與 public/js/controller.js，手機要從 https://<電腦IP>:3443/controller.html 開啟。WebSocket 協定和 server.js 一致：送 {type:'join', code, name}、收 joined/error/roomClosed；之後每秒 30 次送 {type:'input', steer, throttle, brake, item}；收到 {type:'status', ...} 與 {type:'vibrate', ms} 時更新畫面。

畫面一「加入房間」：
- 房號輸入框（4 位數字，使用數字鍵盤）、暱稱輸入框（最多 8 字，記在 localStorage）、「開始」大按鈕。
- 按下「開始」時（一定要在點擊事件裡第一步執行）：先呼叫 DeviceMotionEvent.requestPermission() 與 DeviceOrientationEvent.requestPermission() 取得感測器權限（iOS；呼叫前先檢查 typeof DeviceMotionEvent.requestPermission === 'function'，Android 和電腦沒有這個函式）。「開始」按鈕在這一步之前就先停用，避免連點重複加入；之後嘗試進入全螢幕、鎖定橫向、使用 Wake Lock 讓螢幕不會變暗（各自包 try/catch，失敗不影響加入）。
- 如果 window.isSecureContext 是 false，顯示中文提示：必須用 https 網址開啟。
- 加入後任何時候收到 error，都要停止發送 input、關閉 WebSocket、回到畫面一並顯示錯誤訊息。

畫面二「方向盤」（手機橫拿）：
- 左半邊：大按鈕「倒退」（按住時 brake=1）
- 右半邊：大按鈕「油門」（按住時 throttle=1）
- 【甩尾操作說明】：手機同時按住「油門」與「倒退」按鈕，大螢幕即會觸發甩尾迷你加速！
- 正中央：圓形道具按鈕，顯示目前道具圖示（⚡🍌🚀🛡️）以及等級星號（★/★★/★★★，依 status.itemLevel 顯示），按一下讓 item 計數器 +1
- 上方：名次與圈數；背景使用伺服器傳來的玩家顏色；顯示一個會跟著傾斜旋轉的方向盤圖示
- 小按鈕「校正」（把目前角度設為正中）與「反轉方向」
- 若收到 status.inRace === false 且 status.state !== 'lobby'，在方向盤畫面上方蓋上「比賽進行中，下一場再上場」提示。
- 手機直拿時蓋上「請把手機轉成橫向」
- 用 touchstart/touchend/touchcancel 並 preventDefault，支援多指同時按（油門＋倒退甩尾、油門＋道具），禁止縮放、捲動、長按選字

轉向計算：
- 用 devicemotion 的 accelerationIncludingGravity（重力方向）。依 screen.orientation.angle（0/90/-90/270）把 x、y 轉成螢幕座標，再用 Math.atan2 算出手機像方向盤一樣左右轉的角度
- 扣掉校正角度，3 度以內當 0，±35 度對應 steer -1 ～ +1，並做平滑處理（低通濾波）
- 不支援 devicemotion 時，改用 deviceorientation 的 beta/gamma 估算
- 重力的 x、y 不是有效數字（null）或重力在螢幕平面上很小（手機平放）時，忽略這次讀數；收到第一筆有效讀數前 steer 一律是 0（否則 atan2(0,0) 會算出 180°，車子一開跑就滿舵打轉）
- 道具按鈕不要加 disabled（disabled 的按鈕按不到）；沒有道具時用灰色表示即可。每次加入成功時把道具計數器與按鈕狀態歸零

其他：
- 收到 vibrate 時呼叫 navigator.vibrate(ms)；不支援震動（iPhone）時讓畫面閃紅色
- 斷線或收到 roomClosed 時回到畫面一並顯示原因
- 介面文字全部用繁體中文，按鈕要大、適合大拇指，不使用 Three.js

請加詳細中文註解，完成後告訴我手機要怎麼測試。
```

**確認成功**：電腦與手機連同一個 Wi-Fi → 手機掃大廳的 QR Code → 出現憑證警告時選「進階 → 繼續前往」（iPhone：「顯示詳細資訊 → 瀏覽此網站」）→ 輸入房號 → 大螢幕大廳出現 📱 玩家 → 開賽後傾斜手機可以轉向；同時按油門＋倒退會甩尾；吃到道具箱時道具鈕的星星會增加；比賽中才加入的手機顯示「比賽進行中，下一場再上場」。

### 提示詞 4：整合測試與優化

```
請幫我檢查整個多人連線流程並修正問題：
1. 2 支手機加 1 位鍵盤玩家一起比賽，空位要由 AI 補滿 4 台（2 支手機用左右分割、3～4 人用四格）。
2. 比賽中有手機斷線，那台車要改由 AI 接手，比賽不能中斷；手機重新加入後，下一場可以繼續玩。
3. 比賽中才加入的手機要顯示「比賽進行中，下一場再上場」。
4. 一場結束回到大廳後，手機玩家要保留在大廳，不用重新輸入房號。
5. 確認手機送出的 input 數值都有限制在合理範圍（steer -1～1、throttle/brake 0～1），避免作弊或錯誤資料。
請列出你檢查的項目、發現的問題與修改內容。
```

### 提示詞 Ⓐ：除錯（遇到問題時使用）

```
我的手機連不上（或方向盤沒反應）。我的狀況是：＿＿＿＿（例如：手機顯示什麼錯誤、電腦終端機出現什麼訊息）。
請一步一步帶我檢查：Windows 防火牆是否允許 Node.js 的 3000/3443 埠、手機和電腦是否在同一個 Wi-Fi、
網址是否為 https、憑證警告是否已經同意、iPhone 的動作與方向權限是否允許、瀏覽器 Console 的錯誤訊息。
每一步告訴我要看哪裡、看到什麼代表正常。
```

### 加分挑戰（選做）
- 手機上選擇卡丁車角色、顯示自己的完賽時間與最佳單圈
- 新增第二條賽道與賽道選擇
- 手機畫面顯示小地圖或被瞄準警告

---

## 8. 參考解答與驗證流程（老師端分支管理）

1. 在 `main` 分支完成第一階段（陸行鳥大賽車風格）並通過第 9 節驗收後，打 tag `phase1-v1`。
2. 從 `main` 分支建立並切換至 `phase2` 分支製作參考解答：`git checkout -b phase2`，**照第 7 節提示詞逐字**依序執行（模擬學生操作），記錄 AI 卡住或誤解的地方，回頭修改提示詞的措辭。
3. 實機測試：Android Chrome、iPhone Safari 各一支，確認權限流程、轉向方向、多指觸控與震動。
4. 修改後的提示詞回寫本文件第 7 節。
5. 之後若 `main` 主分支修復 bug，執行 `git switch phase2 && git merge main`。

---

## 9. 驗收標準

### 第一階段（陸行鳥大賽車風格）
- [ ] `npm install && npm start` 後開 `http://localhost:3000`，3 秒內進入大廳，Console 沒有錯誤
- [ ] 單人：按 Enter 開始，全螢幕追尾視角，與 3 台 AI 跑完 3 圈，出現結算畫面
- [ ] 雙人：方向鍵＋WASD 同時加入開賽，自動切換為「左右分割畫面各自追尾鏡頭」
- [ ] 4 款卡丁車角色被動能力正常生效，大廳清楚顯示能力文字
- [ ] 甩尾迷你加速：入彎按住甩尾噴出藍/橘/紫火花，放開獲得噴射加速
- [ ] 起跑衝刺：倒數最後 1 秒按下獲加速，太早按受空轉懲罰
- [ ] 賽道起伏與跳台飛越著地獲得落地小衝刺；高度差 > 2.5 單位跳躍可避讓香蕉
- [ ] 魔石道具升級：Lv1~Lv3 道具箱升級，Lv2/Lv3 追蹤導彈、扇形/巨大香蕉正常觸發
- [ ] 撞牆不會穿出賽道；倒著開不會增加圈數；AI 能跑完 3 圈且單圈 < 70 秒
- [ ] 教室一般電腦 1080p 下維持約 60 FPS
- [ ] 自動化測試（`npm test`）全數通過（`utils.test.js`, `track.test.js`, `car.test.js`, `drift.test.js`, `items.test.js`, `jump.test.js`, `race.test.js`）

### 第二階段
- [ ] 大廳顯示房號＋QR Code；手機輸入錯誤房號會看到中文錯誤
- [ ] 4 支手機同時連線，傾斜轉向、油門、倒退（雙鍵甩尾）、道具（等級星號）都能用
- [ ] 手機收到道具圖示、名次、圈數；被擊中時震動
- [ ] 比賽中手機斷線由 AI 接手；大螢幕重新整理時手機顯示「房間已關閉」

---

## 10. 風險與對策

| 風險 | 對策 |
|---|---|
| 手機感測器必須在 HTTPS 下使用 | 伺服器內建自簽憑證（HTTPS 3443）。若 iPhone 仍拒絕，備案為 `cloudflared tunnel --url http://localhost:3000`（免帳號、提供正式 HTTPS 網址，需要能連外網） |
| iOS 需要使用者點擊才能取得感測器權限 | 權限要求放在「開始」按鈕的點擊事件中 |
| 校園 Wi-Fi 開啟「用戶端隔離」，手機連不到電腦 | 改用老師手機熱點或獨立的 AP；計畫書與除錯提示詞都有寫 |
| Windows 防火牆擋住 Node.js | 第一次啟動時在防火牆提示中允許「私人網路」；除錯提示詞有說明 |
| 各廠牌手機重力軸方向不一致 | 提供「校正」與「反轉方向」按鈕 |
| 手機進入休眠或切到背景 | 使用 Wake Lock；RemoteInput 500 ms 沒有輸入就歸零；斷線改由 AI 接手 |
| AI 產生的程式和原架構衝突 | 第一階段先把 API（addPlayer/removePlayer/setRoomInfo/事件）與 `network.js` 空殼準備好，提示詞明確要求「只改 network.js」 |
| 模型載入失敗 | `assets.js` 自動用方塊模型代替，遊戲照常可玩 |
| 分割畫面效能 | 陰影每幀只更新一次、pixelRatio 上限 1.5 |

---

## 11. 目前進度

- ✅ 引擎選型：Three.js 0.186.1
- ✅ Kenney Car Kit 3.1／Racing Kit 素材已下載並挑選到 `game/public/models/`（CC0 授權檔一併附上）
- ✅ `game/package.json`、`game/server.js`
- ✅ `game/public/js/config.js`、`game/public/js/utils.js`
- ✅ 第一階段（含陸行鳥大賽車風格升級）
- ⬜ 第二階段參考解答與提示詞實測（第 8 節）
