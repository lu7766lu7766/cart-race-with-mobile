# 網頁 3D 道具賽車遊戲 — 計畫書

> 文件日期：2026-10-20
> 用途：教學專案。老師先完成「第一階段」可玩的遊戲；學生把本文件第 7 節的提示詞貼到 AI 編碼工具（Claude Code / Cursor），讓遊戲升級為「第二階段」手機體感多人對戰。

---

## 1. 目標

| 階段 | 內容 | 誰來做 |
|---|---|---|
| 第一階段（`main` 分支） | 瀏覽器開啟就能玩的 3D 卡丁車道具競速。鍵盤操作（方向鍵 / WASD，同一台電腦最多 2 人），AI 電腦車補到 4 台。已內建大廳、房號區、輸入抽象層與自動化測試，為第二階段先鋪好路。 | 老師（本專案直接完成，發給學生的起始專案） |
| 第二階段（`phase2` 分支） | 大螢幕顯示**房間號碼**與 QR Code，手機輸入房號後透過 **WebSocket** 加入。手機橫拿當方向盤，用**陀螺儀/重力感測**左右傾斜轉向；**右側**按鈕加速、**左側**按鈕倒退、**中央**按鈕放道具。 | 學生（貼上提示詞讓 AI 完成）＋老師的參考解答分支 |

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

## 3. 已確認的需求決策

| 項目 | 決定 |
|---|---|
| 畫面 | 大螢幕**共用一個畫面**，斜上方俯視、鏡頭自動移動與縮放，框住所有真人玩家（類似 Micro Machines） |
| 玩法 | **3 圈競速＋道具**：倒數 3-2-1 → 開跑 → 名次／圈數／完賽時間 |
| 道具 | ⚡ 加速氮氣、🍌 香蕉皮、🚀 導彈、🛡️ 護盾（另有固定加速板） |
| 人數 | 一場最多 **4** 台車，空位由 AI 補上 |
| 美術 | **Kenney 免費 3D 模型**（CC0）：Car Kit 卡丁車 4 款、Racing Kit 場景道具。賽道路面用程式生成 |
| 第一階段預先內建 | 同鍵盤雙人（方向鍵＋WASD）、AI 電腦車、**輸入抽象層**、大廳畫面＋房號顯示區、自動化測試（`tests/`） |
| 執行環境 | 教室電腦安裝 Node.js（≥ 18）；第一階段就用 `npm install` → `npm start` |
| 第二階段部署 | **教室區網**：老師電腦執行伺服器，手機連同一個 Wi-Fi；用自簽憑證提供 HTTPS（手機感測器必須在 HTTPS 下才能使用） |
| 手機道具鍵 | 手機橫拿時**畫面中央**的圓形按鈕，顯示目前持有的道具；被擊中時手機震動 |
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
   Three.js 渲染 + 遊戲邏輯（權威端）  ◀─ws─▶  陀螺儀方向 + 油門/倒退/道具按鈕
```

- **遊戲邏輯全部在大螢幕端執行**（權威端），手機只送輸入、只收少量狀態（道具、名次、震動）。伺服器只做房間管理與轉送，所以不需要伺服器端物理同步，延遲感最低、程式最簡單。
- 不使用打包工具（Vite/webpack），用瀏覽器原生 ES Modules ＋ import map，初學者看得懂。

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
         ├─ main.js           ← 啟動、渲染迴圈、事件掛載、window.game
         ├─ game.js           ← 遊戲核心邏輯、狀態機、固定步長模擬、對外 API
         ├─ config.js         ← 所有可調參數（圈數、速度、按鍵、顏色…）
         ├─ utils.js          ← clamp/lerp/角度差、mulberry32、事件系統 Emitter
         ├─ assets.js         ← GLB 載入（失敗時用方塊代替，不會整個壞掉）
         ├─ track.js          ← 賽道生成、位置投影、牆壁、裝飾
         ├─ car.js            ← 車輛物理與模型（輪子轉動、轉向、打滑、跳起）
         ├─ input.js          ← 輸入抽象層：KeyboardInput、NullInput
         ├─ ai.js             ← AIInput（AI 也是一種輸入來源）
         ├─ items.js          ← 道具箱、道具效果、香蕉、導彈、加速板
         ├─ camera.js         ← 共用追蹤鏡頭
         ├─ hud.js            ← 大廳、玩家卡片、倒數、結算、小地圖、車名標籤
         ├─ audio.js          ← WebAudio 合成音效（不需音檔）
         └─ network.js        ← 空殼：export function initNetwork(game) {}（第二階段實作）
```

---

## 5. 第一階段規格（老師完成，可直接遊玩）

### 5.1 遊戲流程（狀態機）
`loading` → `lobby` → `countdown`（3-2-1-GO）→ `racing` → `results`（20 秒後或按 Enter 回大廳）→ `lobby`

### 5.2 操作

| 玩家 | 加速 | 倒退/煞車 | 轉向 | 道具 | 加入（大廳） |
|---|---|---|---|---|---|
| P1 | ↑ | ↓ | ← → | Enter / 右 Shift | 按 ↑ |
| P2 | W | S | A D | 空白鍵 / 左 Shift | 按 W |

大廳：按 Enter 開始（沒人加入時 P1 自動加入），空位由 AI 補滿 4 台；比賽中按 Esc 回大廳。

### 5.3 賽道（`track.js`）
- 13 個控制點組成封閉的 `CatmullRomCurve3`，約 280×150 單位，總長約 850～950 單位；平均取樣 N=600 點，存位置、切線、累積距離。
- 路面寬 16、兩側各 4 單位草地（減速 50%），外側為紅白條紋矮牆（硬牆，撞到時被推回並減速）。
- 起終點格紋線、路面中線、紅白路肩：用程式生成 mesh＋canvas 貼圖。
- Kenney 裝飾：起點門架（overheadLights）、看台、帳篷、旗子、路燈、樹（避開賽道隨機擺放）。
- `track.project(x, z, hintIndex)`：只在上一幀位置附近（±30 點）搜尋最近點，回傳 `{ index, lateral }`，快速又不會跳到別段賽道。

### 5.4 車輛物理（`car.js`，街機手感）
- 狀態：位置、朝向、速度、跳起高度；計時器：加速、護盾、打滑。
- 最高速 38；氮氣/加速板 58；草地上限減半。加速、煞車、倒退（上限 -12）、無油門時自然減速。
- 轉向速度隨車速變化（靜止不能原地轉、高速略鈍）；倒車時方向反轉。
- 車與車：圓形碰撞互推並各自減速。
- **圈數判定**：每幀累加索引差（換算到 ±N/2 範圍）得到連續的 `progress`。起跑時在線後方，`progress` 為負值；第一次過線開始第 1 圈；`progress ≥ 3N` 即完賽。名次直接依 `progress` 排序，倒著開也無法刷圈。
- 模型：Kenney 卡丁車放大約 2.2 倍，前輪依轉向角轉動、四輪依速度滾動，轉彎時車身側傾；車底有玩家顏色光圈，頭上有名字標籤。

### 5.5 道具（`items.js`）
- 道具箱 3 排×4 個，吃到後 3 秒重生；抽道具時 HUD 顯示 0.8 秒轉盤動畫。
- 依名次加權抽獎：第一名多拿香蕉/護盾，後段多拿導彈/氮氣（追趕機制）。

| 道具 | 效果 |
|---|---|
| ⚡ 氮氣 | 1.5 秒高速 |
| 🍌 香蕉皮 | 丟在車後，被踩到的車打滑旋轉 1.2 秒；場上最多 12 個 |
| 🚀 導彈 | 向前直線飛行 2.5 秒，撞牆消失；擊中的車彈起並停頓 1.5 秒 |
| 🛡️ 護盾 | 5 秒內擋下香蕉/導彈，車外顯示泡泡 |

- 賽道上另有 2 處固定加速板（1 秒加速）。

### 5.6 AI（`ai.js`）
- `AIInput` 與鍵盤一樣實作 `getState()`。朝前方 12～20 個取樣點（依車速）＋自己的車道偏移行駛，大轉角時收油門。
- 卡住超過 1.5 秒會倒車脫困。
- 道具：拿到後隨機等 1～4 秒；導彈等前方有車時才發射、香蕉等後方有車時才丟、氮氣在直線上用。
- AI 最高速為 92%～96%，讓學生有機會贏。

### 5.7 共用鏡頭（`camera.js`）
- 固定朝向的斜俯視角（不跟著車旋轉，多人共用螢幕才不會暈）。
- 以真人玩家的包圍框計算中心與高度（沒有真人時框全部車），並加上速度前瞻，平滑插值；高度 35～260，最遠可看到整條賽道。
- 陰影相機跟著鏡頭目標移動。

### 5.8 HUD（`hud.js`）
- **大廳**：標題、**房間號碼區**（第一階段顯示 `----`「本機模式：第二階段開放手機加入」）、4 個玩家欄位（⌨️／🤖／📱 圖示＋顏色）、按鍵說明。
- **比賽中**：四個角落各一張玩家卡（名次、圈數、道具格）、上方計時、下方小地圖（canvas 2D）、車頭名字標籤（CSS2DRenderer）。
- 倒數大字、結算排名表（名次／名字／總時間／最佳單圈）。

### 5.9 為第二階段預留的介面（重點）

```js
// 輸入抽象層：任何輸入來源都只要提供 getState()
//   steer: -1（左）～ +1（右），throttle: 0～1，brake: 0～1（倒退），
//   useItem: true 只在「按下的那一刻」出現一次
input.getState() → { steer, throttle, brake, useItem }

window.game = game;                             // 方便在瀏覽器 Console 除錯
game.state                                      // 'loading'|'lobby'|'countdown'|'racing'|'results'
game.addPlayer({ name, kind: 'remote', input }) // → player，或 null（4 位真人已滿）
                                                //   lobby 時加入：開賽就上場；比賽中加入：下一場上場（player.inRace=false）
game.removePlayer(playerId)                     // 比賽中離開：該車改由 AI 接手
game.getPlayers()                               // 取得真人玩家陣列（依 slot 排序）
game.getStatus(playerId)                        // → { item, position, lap, totalLaps, color, state, inRace } 或 null
game.setRoomInfo({ code, url, qrSvg, message }) // 大廳顯示房號、網址、QR Code 與狀態訊息（message）
game.on('itemChanged', ({ player, item }) => …) // item: 'nitro'|'banana'|'missile'|'shield'|null
game.on('playerHit',  ({ player, by }) => …)    // 給手機震動用
game.on('lapChanged', ({ player, lap }) => …)
game.on('positionChanged', ({ player, position }) => …)
game.on('stateChanged', ({ state }) => …)       // lobby/countdown/racing/results
game.on('playerFinished', ({ player, rank, time }) => …)
```

`network.js` 只有一個空函式 `initNetwork(game)`，已由 `main.js` 呼叫，學生只需要實作它。

### 5.10 第一階段工作項目

1. ✅ 下載 Kenney Car Kit／Racing Kit，挑選模型放進 `public/models/`（含 CC0 授權檔）
2. ✅ `package.json`、`server.js`（零依賴靜態伺服器，`/lib/three/` 對應 `node_modules/three`）
3. ✅ `index.html`＋import map、`style.css`、`config.js`、`utils.js`、`assets.js`
4. ✅ `track.js`（路面、牆、投影、裝飾）
5. ✅ `car.js`＋`input.js`（先讓一台車能開）
6. ✅ `camera.js`、`hud.js`（大廳/倒數/比賽/結算）、狀態機與遊戲核心（`game.js`、`main.js`）
7. ✅ `ai.js`、圈數與名次
8. ✅ `items.js`、`audio.js`
9. ✅ `network.js` 空殼、事件系統、手感調整
10. ✅ 自動化測試（`tests/*.test.js`）與瀏覽器實際遊玩驗收（見第 9 節）

---

## 6. 第二階段規格（學生透過提示詞完成）

### 6.1 伺服器
- 套件：`ws`（WebSocket）、`selfsigned`（產生自簽憑證）、`qrcode`（產生 QR Code SVG）。
- 同時開 HTTP `:3000`（大螢幕用 localhost）與 HTTPS `:3443`（手機用），兩者共用同一套 WebSocket 處理（路徑 `/ws`）。
- 憑證第一次啟動時產生，存在 `cert/`，之後重複使用（手機只需要信任一次）。
- `GET /api/server-info` → `{ controllerUrl: "https://<區網IP>:3443/controller.html", qrSvg }`
- 啟動時在終端機印出區網 IP 與手機網址。

### 6.2 WebSocket 訊息協定（JSON）

| 方向 | 訊息 | 說明 |
|---|---|---|
| 大螢幕→伺服器 | `{type:'host'}` | 建立房間 |
| 伺服器→大螢幕 | `{type:'roomCreated', code:'4821'}` | 4 位數房號，不與現有房間重複 |
| 手機→伺服器 | `{type:'join', code, name}` | 加入房間 |
| 伺服器→手機 | `{type:'joined', playerId}` 或 `{type:'error', message}` | 房號錯誤、房間已滿（4 人）等 |
| 伺服器→大螢幕 | `{type:'playerJoined', playerId, name}` / `{type:'playerLeft', playerId}` | |
| 手機→伺服器→大螢幕 | `{type:'input', steer, throttle, brake, item}`（大螢幕收到時多一個 `playerId`） | 每秒 30 次；`item` 為累加計數器，大螢幕比對數字增加時才觸發一次道具，封包遺失也不會重複觸發 |
| 大螢幕→伺服器→手機 | `{type:'toPlayer', playerId, data}` → 手機收到 `data` | `data`：`{type:'status', item, position, lap, totalLaps, color, state, inRace}`、`{type:'vibrate', ms}` |
| 伺服器→手機 | `{type:'roomClosed'}` | 大螢幕關閉或重新整理 |

### 6.3 大螢幕（`network.js`）
- 連線 `ws(s)://<目前網址>/ws`，送出 `host`，用 `game.setRoomInfo` 顯示房號＋QR Code＋網址。
- `RemoteInput` 類別（實作 `getState()`）：保存最新輸入；超過 500 ms 沒收到就自動歸零（避免斷線暴衝）。
- `playerJoined` → `game.addPlayer({kind:'remote'})`；`playerLeft` → `game.removePlayer`。
- 訂閱 `game.on(...)` 事件，把道具、名次、圈數、車色、震動傳給對應手機。
- 斷線時每 2 秒自動重連。

### 6.4 手機控制器（`public/controller.html`＋`js/controller.js`）
- **步驟 1**：輸入房號（數字鍵盤）＋暱稱 →「開始」按鈕。按下時（必須在使用者點擊當下）呼叫 `DeviceMotionEvent.requestPermission()` / `DeviceOrientationEvent.requestPermission()`（iOS），並嘗試全螢幕、鎖定橫向、Wake Lock 防止螢幕變暗。
- **步驟 2（橫向）**：左半邊大按鈕「倒退」、右半邊大按鈕「油門」、中央圓形道具鈕（顯示 ⚡🍌🚀🛡️ 或空）；上方顯示名次/圈數，背景為車色；方向盤圖示即時顯示傾斜角度；「校正」與「反轉方向」小按鈕。直拿時顯示「請把手機轉橫」。
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

1. 安裝並使用套件：ws（WebSocket）、selfsigned（自簽憑證）、qrcode（產生 QR Code），更新 package.json。
2. 保留原本 HTTP 3000 埠；另外開 HTTPS 3443 埠，用 selfsigned 產生憑證並存到 cert/ 資料夾，下次啟動直接讀取。兩個埠提供相同的網頁，也都在路徑 /ws 接受 WebSocket 連線（共用同一套處理程式）。
3. 新增 GET /api/server-info，回傳 JSON：{ controllerUrl: "https://<本機區網IPv4>:3443/controller.html", qrSvg: <controllerUrl 的 QR Code SVG 字串> }。區網 IP 用 os.networkInterfaces() 找，排除 127.0.0.1 和虛擬網卡。
4. 房間功能，訊息一律是 JSON：
   - 大螢幕送 {type:'host'} → 建立 4 位數字不重複的房號，回 {type:'roomCreated', code}
   - 手機送 {type:'join', code, name} → 成功回 {type:'joined', playerId}，並通知大螢幕 {type:'playerJoined', playerId, name}；房號不存在或已有 4 位手機玩家就回 {type:'error', message:'中文錯誤訊息'}
   - 手機送 {type:'input', steer, throttle, brake, item} → 伺服器端將數值 clamp 到合法範圍後，加上 playerId 轉給該房間的大螢幕
   - 大螢幕送 {type:'toPlayer', playerId, data} → 把 data 原封不動轉給那支手機（限制同一房間）
   - 手機斷線 → 通知大螢幕 {type:'playerLeft', playerId}；大螢幕斷線 → 通知所有手機 {type:'roomClosed'} 並刪除房間
   - 收到格式錯誤的訊息要忽略，不能讓伺服器當掉
5. 加入 WebSocket 心跳機制：每 15 秒 ping，逾期未回應就斷線，處理手機休眠半開連線；伺服器關閉時清掉定時器。
6. 啟動時在終端機用中文印出：大螢幕網址 http://localhost:3000 與手機網址 https://<區網IP>:3443/controller.html。

請在程式裡加詳細的中文註解。完成後告訴我要執行哪些指令，以及怎麼確認成功。
```

**確認成功**：`npm install` → `npm start`，終端機印出兩個網址；瀏覽器開 `http://localhost:3000/api/server-info` 看到 JSON；原本的遊戲照常能玩。

### 提示詞 2：大螢幕顯示房號並接收手機玩家

```
接續上一步。請閱讀 public/js/game.js、input.js、hud.js 了解遊戲對外提供的 API（game.addPlayer、game.removePlayer、game.getStatus、game.setRoomInfo、game.state、game.on 事件），以及輸入來源的介面 getState() → { steer, throttle, brake, useItem }。
現在請實作 public/js/network.js 裡的 initNetwork(game)：

1. 依照目前網頁的通訊協定連線 WebSocket（http 用 ws://、https 用 wss://，路徑 /ws），連上後送 {type:'host'}。
2. 收到 {type:'roomCreated', code} 後，fetch /api/server-info，呼叫 game.setRoomInfo({ code, url: controllerUrl, qrSvg })，讓大廳顯示房號、手機網址與 QR Code。
3. 建立 RemoteInput 類別（和 KeyboardInput 一樣提供 getState()）：
   - 收到 {type:'input', playerId, steer, throttle, brake, item} 時更新對應玩家的輸入
   - item 是手機端的累加計數器，數字比上次大時，下一次 getState() 回傳 useItem:true（只出現一次）
   - 超過 500 毫秒沒收到輸入就把 steer/throttle/brake 歸零（避免斷線時車子一直衝）
4. 收到 playerJoined → game.addPlayer({ name, kind:'remote', input: new RemoteInput() })，用 Map<serverPlayerId, gamePlayer> 記住對應關係。
   - 加入成功後立刻送一次 status 給該手機：{type:'toPlayer', playerId, data: {type:'status', ...game.getStatus(player.id)}}
   - 如果 addPlayer 回傳 null（已滿額），就送 toPlayer 錯誤訊息給手機：{type:'toPlayer', playerId, data: {type:'error', message:'房間已滿（4 位真人）'}}
   - 收到 playerLeft → game.removePlayer(gamePlayer.id)
5. 用 game.on 訂閱事件傳送給手機：
   - itemChanged、positionChanged、lapChanged：只傳給該玩家 {type:'toPlayer', playerId, data: {type:'status', ...game.getStatus(player.id)}}
   - stateChanged：對所有已連線的手機廣播目前狀態 {type:'status', ...game.getStatus(p.id)}
   - playerHit：另外送 {type:'toPlayer', playerId, data: {type:'vibrate', ms:300}}
6. WebSocket 斷線時：對所有遠端玩家呼叫 game.removePlayer 並清空 Map，大廳顯示「連線中斷，重新連線中…」（呼叫 game.setRoomInfo({ code: null, message: '連線中斷，重新連線中…' })），每 2 秒自動重連並重新建立房間。

不要修改遊戲物理與畫面邏輯，只改 network.js（必要時可以小幅修改 hud.js 的顯示）。請加詳細中文註解，完成後告訴我怎麼確認成功。
```

**確認成功**：`npm start` 後開 `http://localhost:3000`，大廳出現 4 位數房號與 QR Code；鍵盤遊玩不受影響。

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
- 正中央：圓形道具按鈕，顯示目前道具（nitro⚡ banana🍌 missile🚀 shield🛡️，沒有就顯示灰色），按一下讓 item 計數器 +1
- 上方：名次與圈數；背景使用伺服器傳來的玩家顏色；顯示一個會跟著傾斜旋轉的方向盤圖示
- 小按鈕「校正」（把目前角度設為正中）與「反轉方向」
- 若收到 status.inRace === false 且 status.state !== 'lobby'，在方向盤畫面上方蓋上「比賽進行中，下一場再上場」提示。
- 手機直拿時蓋上「請把手機轉成橫向」
- 用 touchstart/touchend/touchcancel 並 preventDefault，支援多指同時按，禁止縮放、捲動、長按選字

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

**確認成功**：電腦與手機連同一個 Wi-Fi → 手機掃大廳的 QR Code → 出現憑證警告時選「進階 → 繼續前往」（iPhone：「顯示詳細資訊 → 瀏覽此網站」）→ 輸入房號 → 大螢幕大廳出現 📱 玩家 → 開賽後傾斜手機可以轉向。

### 提示詞 4：整合測試與優化

```
請幫我檢查整個多人連線流程並修正問題：
1. 2 支手機加 1 位鍵盤玩家一起比賽，空位要由 AI 補滿 4 台。
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

1. 在 `main` 分支完成第一階段並通過第 9 節第一階段驗收後，打 tag `phase1-v1`。
2. 從 `main` 分支建立並切換至 `phase2` 分支製作參考解答：`git checkout -b phase2`。
3. 驗證提示詞：從 `main` 開拋棄式分支 `prompt-test`，**逐字**貼第 7 節提示詞 1~4 模擬學生操作，記錄 AI 卡住或誤解之處並反饋修正提示詞，最後與 `phase2` 比對。
4. 之後若 `main` 主分支修復 bug，執行 `git switch phase2 && git merge main`，讓第二階段完成版也能拿到核心邏輯修正。

---

## 9. 驗收標準

### 第一階段
- [ ] `npm install && npm start` 後開 `http://localhost:3000`，3 秒內進入大廳，Console 沒有錯誤
- [ ] 單人：按 Enter 開始，與 3 台 AI 跑完 3 圈，出現結算畫面
- [ ] 雙人：方向鍵＋WASD 同時操作，鏡頭會框住兩台車
- [ ] 4 種道具與加速板都正常作用，護盾可擋香蕉/導彈
- [ ] 撞牆不會穿出賽道；倒著開不會增加圈數
- [ ] AI 能自行跑完 3 圈，卡住會脫困
- [ ] 教室一般電腦 1080p 下維持約 60 FPS
- [ ] 在 Console 執行 `game.addPlayer({name:'測試', kind:'remote', input:{getState:()=>({steer:0,throttle:1,brake:0,useItem:false})}})`，下一場會有一台一直直衝的車（證明介面可以接手機）

### 第二階段
- [ ] 大廳顯示房號＋QR Code；手機輸入錯誤房號會看到中文錯誤
- [ ] 4 支手機同時連線，傾斜轉向、油門、倒退、道具都能用，延遲體感 < 100 ms
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

---

## 11. 目前進度

- ✅ 引擎選型：Three.js 0.186.1
- ✅ Kenney Car Kit 3.1／Racing Kit 素材已下載並挑選到 `game/public/models/`（CC0 授權檔一併附上）
- ✅ `game/package.json`、`game/server.js`（含安全修復與測試匯出）
- ✅ `game/public/js/config.js`、`game/public/js/utils.js`（含 mulberry32 與時間修復）
- ✅ 第一階段核心程式與前端渲染全數完成（`index.html`、`style.css`、`track.js`、`car.js`、`input.js`、`ai.js`、`items.js`、`game.js`、`assets.js`、`camera.js`、`hud.js`、`audio.js`、`network.js`、`main.js`）
- ✅ 第一階段自動化測試（`game/tests/utils.test.js`、`track.test.js`、`race.test.js`）
- ✅ 根目錄 `README.md` 與 `plan.md` 計畫書更新
- ⬜ 第二階段參考解答與提示詞實測（`phase2` 分支）
