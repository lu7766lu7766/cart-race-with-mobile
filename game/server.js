// ============================================================
//  server.js — 遊戲伺服器（第二階段：WebSocket 房間與 HTTPS 自簽憑證）
//  負責傳送 public/ 前端靜態資源、提供 /api/server-info（QR Code 與控制器網址）、
//  同時開啟 HTTP（:3000，大螢幕端）與 HTTPS（:3443，手機端）伺服器，
//  並於 /ws 路徑提供 WebSocket 房間轉發服務（大螢幕建立房間、手機加入與輸入轉送）。
//
//  啟動方式：npm install（只要第一次）→ npm start
// ============================================================
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import selfsigned from 'selfsigned';
import QRCode from 'qrcode';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
export const HTTPS_PORT = process.env.HTTPS_PORT ? parseInt(process.env.HTTPS_PORT, 10) : 3443;

// 網址開頭 → 實際資料夾
// /lib/three/... 會對應到 node_modules/three/...（3D 引擎 Three.js）
export const ROUTES = [
  { prefix: '/lib/three/', dir: path.join(__dirname, 'node_modules', 'three') },
  { prefix: '/', dir: path.join(__dirname, 'public') },
];

// 副檔名 → 瀏覽器需要知道的檔案類型
export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
};

// ------------------------------------------------------------
// 1. 本機區網 IPv4 偵測
// ------------------------------------------------------------
export function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const netInfo of nets[name] || []) {
      // 排除非 IPv4、內部迴路 (127.0.0.1)
      if (netInfo.family === 'IPv4' && !netInfo.internal) {
        return netInfo.address;
      }
    }
  }
  return '127.0.0.1';
}

// ------------------------------------------------------------
// 2. HTTPS 自簽憑證管理（儲存於 cert/ 資料夾）
// ------------------------------------------------------------
const CERT_VERSION = 'selfsigned5-sha256-730d';

export async function getOrCreateCert({ certDir = path.join(__dirname, 'cert'), localIp = getLocalIp() } = {}) {
  const keyPath = path.join(certDir, 'key.pem');
  const certPath = path.join(certDir, 'cert.pem');
  const versionPath = path.join(certDir, 'version.txt');

  if (fs.existsSync(keyPath) && fs.existsSync(certPath) && fs.existsSync(versionPath)) {
    try {
      const version = fs.readFileSync(versionPath, 'utf8').trim();
      if (version === CERT_VERSION) {
        const key = fs.readFileSync(keyPath, 'utf8');
        const cert = fs.readFileSync(certPath, 'utf8');
        if (key && cert) {
          return { key, cert };
        }
      }
    } catch (e) {}
  }

  // 舊版憑證或缺少 version.txt 時，重新產生並提示使用者
  if (fs.existsSync(keyPath) || fs.existsSync(certPath)) {
    console.log('已重新產生 HTTPS 憑證，手機需要重新同意一次憑證警告');
  }

  // 憑證 subjectAltName 只放入合法的 IP（type 7）與 localhost（type 2）
  const attrs = [{ name: 'commonName', value: localIp }];
  const altNames = [{ type: 2, value: 'localhost' }];

  if (net.isIP(localIp)) {
    altNames.push({ type: 7, ip: localIp });
  }
  if (localIp !== '127.0.0.1' && net.isIP('127.0.0.1')) {
    altNames.push({ type: 7, ip: '127.0.0.1' });
  }

  const notBeforeDate = new Date();
  const notAfterDate = new Date(notBeforeDate);
  notAfterDate.setDate(notAfterDate.getDate() + 730); // 2 年（iPhone 對自簽憑證有效期較嚴格，不要超過 825 天）

  const pems = await selfsigned.generate(attrs, {
    keySize: 2048,
    algorithm: 'sha256', // 預設是 sha1，iPhone 會拒絕，一定要指定
    notBeforeDate,
    notAfterDate,
    extensions: [{ name: 'subjectAltName', altNames }],
  });

  try {
    fs.mkdirSync(certDir, { recursive: true });
    fs.writeFileSync(keyPath, pems.private, 'utf8');
    fs.writeFileSync(certPath, pems.cert, 'utf8');
    fs.writeFileSync(versionPath, CERT_VERSION, 'utf8');
  } catch (e) {}

  return { key: pems.private, cert: pems.cert };
}

// ------------------------------------------------------------
// 3. 靜態檔案與 API 請求處理
// ------------------------------------------------------------
export function createRequestHandler({ getControllerUrl = null } = {}) {
  let cachedControllerUrl = null;
  let cachedQrSvg = null;

  return async function handleRequest(req, res) {
    let urlPath;
    // 1. 安全修復：處理惡意或不合法的 URL 編碼，避免例外崩潰
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Request');
      return;
    }

    // 解碼後若路徑包含空字元（Null Byte \0），回傳 400 Bad Request
    if (urlPath.includes('\0')) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Request');
      return;
    }

    // GET /api/server-info：回傳手機連線網址與 QR Code SVG
    if (urlPath === '/api/server-info') {
      let controllerUrl = typeof getControllerUrl === 'function' ? getControllerUrl() : `https://${getLocalIp()}:${HTTPS_PORT}/controller.html`;
      // 帶 ?code=1234 時把房號附在網址上，手機掃碼後會自動填好房號
      const code = new URL(req.url, 'http://localhost').searchParams.get('code');
      if (code && /^\d{4}$/.test(code)) {
        controllerUrl += `?code=${code}`;
      }
      try {
        if (cachedControllerUrl !== controllerUrl || !cachedQrSvg) {
          cachedControllerUrl = controllerUrl;
          cachedQrSvg = await QRCode.toString(controllerUrl, { type: 'svg' });
        }
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-cache',
        });
        res.end(JSON.stringify({ controllerUrl, qrSvg: cachedQrSvg }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Failed to generate QR Code' }));
      }
      return;
    }

    if (urlPath.endsWith('/')) urlPath += 'index.html';

    const route = ROUTES.find((r) => urlPath.startsWith(r.prefix));
    if (!route) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('找不到檔案：' + urlPath);
      return;
    }

    const filePath = path.join(route.dir, urlPath.slice(route.prefix.length));

    // 2. 安全修復：不允許用 ../ 讀取目標資料夾外部或同名前綴之兄弟資料夾
    if (filePath !== route.dir && !filePath.startsWith(route.dir + path.sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // 3. 安全防護：將 fs.readFile 包於 try/catch 內，防止同步丟出之例外導致伺服器崩潰
    try {
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('找不到檔案：' + urlPath);
          return;
        }
        const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
        res.end(data);
      });
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Request');
    }
  };
}

// 預設請求處理函式（相容第一階段）
export const handleRequest = createRequestHandler();

// ------------------------------------------------------------
// 4. 房間管理核心（Room Hub）
// ------------------------------------------------------------
export function createRoomHub({ rng = Math.random } = {}) {
  // code -> { code, hostSocket, players: Map<playerId, { id, name, socket }>, playerSeq: number }
  const rooms = new Map();

  function send(socket, data) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(typeof data === 'string' ? data : JSON.stringify(data));
    } catch (e) {}
  }

  // 產生 1000 ~ 9999 不重複的 4 位數房號
  function generateRoomCode() {
    for (let attempts = 0; attempts < 10000; attempts++) {
      const code = String(Math.floor(1000 + rng() * 9000));
      if (!rooms.has(code)) return code;
    }
    throw new Error('無法產生不重複的 4 位數房號');
  }

  function handleMessage(socket, raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      // 收到格式錯誤或非 JSON 字串時直接忽略，確保伺服器永不崩潰
      return;
    }

    if (!msg || typeof msg !== 'object') return;

    // --------------------------------------------------------
    // (A) 大螢幕建立房間：{ type: 'host' }
    // --------------------------------------------------------
    if (msg.type === 'host') {
      // 若該 socket 過去已建立過房間或為玩家身分，先清理舊身分
      if (socket.roomRole === 'player' || socket.roomRole === 'host' || (socket.roomCode && rooms.has(socket.roomCode))) {
        handleClose(socket);
      }

      const code = generateRoomCode();
      const room = {
        code,
        hostSocket: socket,
        players: new Map(),
        playerSeq: 0,
      };

      rooms.set(code, room);
      socket.roomRole = 'host';
      socket.roomCode = code;

      send(socket, { type: 'roomCreated', code });
      return;
    }

    // --------------------------------------------------------
    // (B) 手機加入房間：{ type: 'join', code, name }
    // --------------------------------------------------------
    if (msg.type === 'join') {
      // 若該 socket 過去已有玩家或主機身分，先呼叫 handleClose 清理舊身分（避免重複 join 留下幽靈玩家）
      if (socket.roomRole === 'player' || socket.roomRole === 'host') {
        handleClose(socket);
      }

      const code = String(msg.code || '').trim();
      const room = rooms.get(code);

      if (!room || !room.hostSocket || room.hostSocket.readyState !== WebSocket.OPEN) {
        send(socket, { type: 'error', message: '找不到房間或房號錯誤' });
        return;
      }

      // 每房最多 4 支手機玩家
      if (room.players.size >= 4) {
        send(socket, { type: 'error', message: '房間已滿（4 位真人）' });
        return;
      }

      // 暱稱修剪空白、最多 8 字；空白時自動指派「玩家N」
      let cleanName = typeof msg.name === 'string' ? msg.name.trim().slice(0, 8) : '';
      if (!cleanName) {
        cleanName = `玩家${room.players.size + 1}`;
      }

      const playerId = `phone_${++room.playerSeq}`;
      const playerInfo = {
        id: playerId,
        name: cleanName,
        socket,
      };

      room.players.set(playerId, playerInfo);
      socket.roomRole = 'player';
      socket.roomCode = code;
      socket.playerId = playerId;

      // 通知手機加入成功
      send(socket, { type: 'joined', playerId });

      // 通知大螢幕有新玩家加入
      send(room.hostSocket, { type: 'playerJoined', playerId, name: cleanName });
      return;
    }

    // --------------------------------------------------------
    // (C) 手機傳送即時輸入：{ type: 'input', steer, throttle, brake, item }
    // --------------------------------------------------------
    if (msg.type === 'input') {
      if (socket.roomRole !== 'player' || !socket.roomCode || !socket.playerId) return;
      const room = rooms.get(socket.roomCode);
      if (!room || !room.hostSocket) return;

      // 伺服器端數值 clamp，防止不合法數值破壞遊戲
      const rawSteer = typeof msg.steer === 'number' && Number.isFinite(msg.steer) ? msg.steer : 0;
      const rawThrottle = typeof msg.throttle === 'number' && Number.isFinite(msg.throttle) ? msg.throttle : 0;
      const rawBrake = typeof msg.brake === 'number' && Number.isFinite(msg.brake) ? msg.brake : 0;
      const rawItem = typeof msg.item === 'number' && Number.isFinite(msg.item) ? Math.floor(msg.item) : 0;

      const steer = Math.max(-1, Math.min(1, rawSteer));
      const throttle = Math.max(0, Math.min(1, rawThrottle));
      const brake = Math.max(0, Math.min(1, rawBrake));

      // 轉送給大螢幕，並附加發送者之 playerId
      send(room.hostSocket, {
        type: 'input',
        playerId: socket.playerId,
        steer,
        throttle,
        brake,
        item: rawItem,
      });
      return;
    }

    // --------------------------------------------------------
    // (D) 大螢幕回傳給指定手機：{ type: 'toPlayer', playerId, data }
    // --------------------------------------------------------
    if (msg.type === 'toPlayer') {
      if (socket.roomRole !== 'host' || !socket.roomCode) return;
      const room = rooms.get(socket.roomCode);
      if (!room) return;

      // 限制只能轉送給同一房間內的手機
      const targetPlayer = room.players.get(msg.playerId);
      if (targetPlayer && targetPlayer.socket) {
        send(targetPlayer.socket, msg.data);
      }
      return;
    }
  }

  function handleClose(socket) {
    if (!socket || !socket.roomCode) return;
    const room = rooms.get(socket.roomCode);
    if (!room) {
      socket.roomRole = null;
      socket.roomCode = null;
      socket.playerId = null;
      return;
    }

    if (socket.roomRole === 'host') {
      // 大螢幕斷線：通知該房間所有手機 roomClosed，並清理房間
      for (const player of room.players.values()) {
        send(player.socket, { type: 'roomClosed' });
        player.socket.roomCode = null;
        player.socket.roomRole = null;
        player.socket.playerId = null;
      }
      rooms.delete(socket.roomCode);
      socket.roomRole = null;
      socket.roomCode = null;
      socket.playerId = null;
    } else if (socket.roomRole === 'player') {
      // 手機玩家斷線：從房間移除並通知大螢幕
      if (room.players.has(socket.playerId)) {
        room.players.delete(socket.playerId);
        send(room.hostSocket, { type: 'playerLeft', playerId: socket.playerId });
      }
      socket.roomRole = null;
      socket.roomCode = null;
      socket.playerId = null;
    }
  }

  return {
    rooms,
    handleMessage,
    handleClose,
  };
}

// ------------------------------------------------------------
// 5. 啟動伺服器（支援 HTTP、HTTPS 與 /ws WebSocket 轉發）
// ------------------------------------------------------------
export async function startServer({
  port,
  httpPort = port ?? PORT,
  httpsPort = HTTPS_PORT,
  certDir = path.join(__dirname, 'cert'),
} = {}) {
  const localIp = getLocalIp();
  const hub = createRoomHub();

  // 建立 WebSocket 伺服器（noServer 模式，共用 HTTP 與 HTTPS 的升級請求）
  const wss = new WebSocketServer({ noServer: true });

  // 15 秒心跳檢測（處理手機休眠或網路斷開之半開連線）
  const heartbeatInterval = setInterval(() => {
    for (const client of wss.clients) {
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, 15000);

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (raw) => {
      hub.handleMessage(ws, raw);
    });

    ws.on('close', () => {
      hub.handleClose(ws);
    });

    ws.on('error', () => {
      hub.handleClose(ws);
    });
  });

  function handleUpgrade(req, socket, head) {
    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch (err) {
      socket.destroy();
      return;
    }

    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  }

  // 取得實際的 HTTPS 通訊埠（若以隨機埠 0 啟動則取 address().port）
  let actualHttpsPort = httpsPort;
  function getControllerUrl() {
    return `https://${localIp}:${actualHttpsPort}/controller.html`;
  }

  const reqHandler = createRequestHandler({ getControllerUrl });

  // (A) HTTP 伺服器（主要供大螢幕遊戲 localhost 遊玩）
  const httpServer = http.createServer(reqHandler);
  httpServer.on('upgrade', handleUpgrade);

  // (B) HTTPS 伺服器（供手機端載入控制器，以支援陀螺儀感測器）
  let httpsServer = null;
  const enableHttps = httpsPort !== false && httpsPort !== null;
  if (enableHttps) {
    try {
      const { key, cert } = await getOrCreateCert({ certDir, localIp });
      httpsServer = https.createServer({ key, cert }, reqHandler);
      httpsServer.on('upgrade', handleUpgrade);
    } catch (err) {
      console.warn('⚠️ 警告：無法載入或建立 HTTPS 憑證，將僅提供 HTTP 服務：', err.message);
    }
  }

  let isHttpListening = false;
  let isHttpsListening = false;

  const readyPromise = new Promise((resolve, reject) => {
    let pending = enableHttps && httpsServer ? 2 : 1;
    let settled = false;

    function cleanupOnError() {
      clearInterval(heartbeatInterval);
      for (const client of wss.clients) {
        try { client.terminate(); } catch (e) {}
      }
      try { wss.close(); } catch (e) {}
      if (isHttpListening) {
        try { httpServer.close(); } catch (e) {}
      }
      if (isHttpsListening && httpsServer) {
        try { httpsServer.close(); } catch (e) {}
      }
    }

    function handleError(targetPort, err) {
      if (settled) return;
      settled = true;

      cleanupOnError();

      if (err && err.code === 'EADDRINUSE') {
        console.error(`連接埠 ${targetPort} 已被使用：可能已經有一個遊戲伺服器在執行，請先關閉它（Ctrl + C）或重新開機`);
      }

      reject(err);
    }

    httpServer.on('error', (err) => {
      handleError(httpPort, err);
    });

    if (enableHttps && httpsServer) {
      httpsServer.on('error', (err) => {
        handleError(httpsPort, err);
      });
    }

    const checkDone = () => {
      if (settled) return;
      pending--;
      if (pending === 0) {
        settled = true;
        resolve();
      }
    };

    httpServer.listen(httpPort, () => {
      isHttpListening = true;
      checkDone();
    });

    if (enableHttps && httpsServer) {
      httpsServer.listen(httpsPort, () => {
        isHttpsListening = true;
        actualHttpsPort = httpsServer.address().port;
        checkDone();
      });
    }
  });

  await readyPromise;

  const actualHttpPort = httpServer.address()?.port;
  console.log('');
  console.log('  🏁 賽車遊戲伺服器已啟動！');
  console.log(`  👉 大螢幕用瀏覽器打開：http://localhost:${actualHttpPort}`);
  if (httpsServer && isHttpsListening) {
    console.log(`  📱 手機控制器網址：https://${localIp}:${actualHttpsPort}/controller.html`);
  }
  console.log('  （要關閉伺服器請按 Ctrl + C）');
  console.log('');

  const handle = {
    httpServer,
    httpsServer,
    wss,
    hub,
    get ready() {
      return readyPromise;
    },
    get httpPort() {
      return httpServer.address()?.port ?? httpPort;
    },
    get httpsPort() {
      return httpsServer?.address()?.port ?? actualHttpsPort;
    },
    close(callback) {
      clearInterval(heartbeatInterval);
      for (const client of wss.clients) {
        try {
          client.terminate();
        } catch (e) {}
      }

      return new Promise((resolve) => {
        let pending = (httpsServer ? 2 : 1) + 1;
        const done = () => {
          pending--;
          if (pending === 0) {
            if (typeof callback === 'function') callback();
            resolve();
          }
        };

        wss.close(() => done());
        httpServer.close(() => done());
        if (httpsServer) {
          httpsServer.close(() => done());
        }
      });
    },
  };

  return handle;
}

// 僅在直接透過 node server.js 執行時自動啟動（若是測試 import 則不自動啟動）
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  try {
    await startServer({ port: PORT, httpsPort: HTTPS_PORT });
  } catch (err) {
    if (err?.code !== 'EADDRINUSE') {
      console.error('伺服器啟動失敗：', err);
    }
    process.exit(1);
  }
}
