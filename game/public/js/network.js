// ============================================================
//  network.js — 網路多人連線介面（第一階段空殼）
//
//  【給學生的說明】：
//  在第一階段中，本檔案為空殼函式，遊戲完全在本機單機執行（支援同一鍵盤雙人）。
//
//  進入【第二階段】時，你將使用 AI 提示詞在此檔案實作：
//  1. 連線至伺服器的 WebSocket 服務（ws:// 或 wss://）。
//  2. 建立房間（送出 { type: 'host' }），並取得 4 位數房號與 QR Code。
//  3. 透過 game.setRoomInfo({ code, url, qrSvg }) 將房號顯示於大螢幕大廳。
//  4. 接收手機端加入通知，呼叫 game.addPlayer({ name, kind: 'remote', input: new RemoteInput() })。
//  5. 訂閱 game 的狀態與道具事件，透過 WebSocket 即時回傳給各玩家手機。
// ============================================================

export function initNetwork(game) {
  // 第一階段為空實作，保留 API 入口供 main.js 呼叫
  console.log('[Network] 第一階段單機模式：網路通訊介面就緒（第二階段將在此加入 WebSocket 連線）');
}
