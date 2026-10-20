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

---

## 6. 第二階段規格（學生透過提示詞完成）

### 6.1 伺服器
- 套件：`ws`（WebSocket）、`selfsigned`（產生自簽憑證）、`qrcode`（產生 QR Code SVG）。
- 同時開 HTTP `:3000`（大螢幕用 localhost）與 HTTPS `:3443`（手機用），共用 `/ws`。
- 憑證存於 `cert/`，重複使用。
- `GET /api/server-info` → `{ controllerUrl: "https://<區網IP>:3443/controller.html", qrSvg }`。

### 6.2 WebSocket 訊息協定（JSON）

| 方向 | 訊息 | 說明 |
|---|---|---|
| 大螢幕→伺服器 | `{type:'host'}` | 建立房間 |
| 伺服器→大螢幕 | `{type:'roomCreated', code:'4821'}` | 4 位數房號 |
| 手機→伺服器 | `{type:'join', code, name}` | 加入房間 |
| 伺服器→手機 | `{type:'joined', playerId}` 或 `{type:'error', message}` | 錯誤訊息 |
| 伺服器→大螢幕 | `{type:'playerJoined', playerId, name}` / `{type:'playerLeft', playerId}` | |
| 手機→伺服器→大螢幕 | `{type:'input', steer, throttle, brake, item}` | 轉送給大螢幕；同時按油門與倒退為甩尾 |
| 大螢幕→伺服器→手機 | `{type:'toPlayer', playerId, data}` → 手機收到 `data` | `data`：`{type:'status', item, itemLevel, position, lap, totalLaps, color, state, inRace}`、`{type:'vibrate', ms}` |
| 伺服器→手機 | `{type:'roomClosed'}` | 大螢幕關閉 |

---

## 7. 學生用提示詞（第二階段）

> 使用方式：用 Claude Code 或 Cursor 開啟 `game` 資料夾，**依序**貼上提示詞 1 → 4，每一步都照「確認成功」做檢查，成功後再進行下一步。

### 提示詞 1：伺服器加入 WebSocket 房間與 HTTPS
（內容同前，保留完整規格與心跳機制）

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
4. 收到 playerJoined → game.addPlayer({ name, kind:'remote', input: new RemoteInput() })，用 Map<serverPlayerId, gamePlayer> 記住對應關係。
   - 加入成功後立刻送一次 status 給該手機：{type:'toPlayer', playerId, data: {type:'status', ...game.getStatus(player.id)}}（包含 itemLevel）
   - 如果 addPlayer 回傳 null（已滿額），就送 toPlayer 錯誤訊息給手機：{type:'toPlayer', playerId, data: {type:'error', message:'房間已滿（4 位真人）'}}
   - 收到 playerLeft → game.removePlayer(gamePlayer.id)
5. 用 game.on 訂閱事件傳送給手機：
   - itemChanged、positionChanged、lapChanged：只傳給該玩家 {type:'toPlayer', playerId, data: {type:'status', ...game.getStatus(player.id)}}（帶有最新 itemLevel）
   - stateChanged：對所有已連線的手機廣播目前狀態 {type:'status', ...game.getStatus(p.id)}
   - playerHit：另外送 {type:'toPlayer', playerId, data: {type:'vibrate', ms:300}}
6. WebSocket 斷線時：對所有遠端玩家呼叫 game.removePlayer 並清空 Map，大廳顯示「連線中斷，重新連線中…」（呼叫 game.setRoomInfo({ code: null, message: '連線中斷，重新連線中…' })），每 2 秒自動重連並重新建立房間。

不要修改遊戲物理與畫面邏輯，只改 network.js。請加詳細中文註解，完成後告訴我怎麼確認成功。
```

### 提示詞 3：手機方向盤控制器

```
接續上一步。請新增手機控制器頁面 public/controller.html（含 CSS）與 public/js/controller.js，手機要從 https://<電腦IP>:3443/controller.html 開啟。WebSocket 協定和 server.js 一致：送 {type:'join', code, name}、收 joined/error/roomClosed；之後每秒 30 次送 {type:'input', steer, throttle, brake, item}；收到 {type:'status', ...} 與 {type:'vibrate', ms} 時更新畫面。

畫面一「加入房間」：
- 房號輸入框（4 位數字，使用數字鍵盤）、暱稱輸入框（最多 8 字，記在 localStorage）、「開始」大按鈕。
- 按下「開始」時（一定要在點擊事件裡第一步執行）：先呼叫 DeviceMotionEvent.requestPermission() 與 DeviceOrientationEvent.requestPermission() 取得感測器權限（iOS）；之後嘗試進入全螢幕、鎖定橫向、使用 Wake Lock 讓螢幕不會變暗（各自包 try/catch，失敗不影響加入）。
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

其他：
- 收到 vibrate 時呼叫 navigator.vibrate(ms)；不支援震動（iPhone）時讓畫面閃紅色
- 斷線或收到 roomClosed 時回到畫面一並顯示原因
- 介面文字全部用繁體中文，按鈕要大、適合大拇指，不使用 Three.js

請加詳細中文註解，完成後告訴我手機要怎麼測試。
```

### 提示詞 4：整合測試與優化
（內容同前）

---

## 8. 參考解答與驗證流程（老師端分支管理）

1. 在 `main` 分支完成第一階段（陸行鳥大賽車風格）並通過第 9 節驗收後，打 tag `phase1-v2`。
2. 從 `main` 分支建立並切換至 `phase2` 分支製作參考解答：`git checkout -b phase2`。
3. 驗證提示詞：從 `main` 開拋棄式分支 `prompt-test`，逐字貼第 7 節提示詞模擬學生操作並記錄除錯。
4. 之後若 `main` 主分支修復 bug，執行 `git switch phase2 && git merge main`。

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
