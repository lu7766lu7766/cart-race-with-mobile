// ============================================================
//  server.js — 遊戲伺服器
//  第一階段：只負責把 public/ 資料夾裡的網頁、程式、模型傳給瀏覽器。
//  第二階段：會在這裡加上 WebSocket（房間號碼、手機連線）與 HTTPS。
//
//  啟動方式：npm install（只要第一次）→ npm start
// ============================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// 網址開頭 → 實際資料夾
// /lib/three/... 會對應到 node_modules/three/...（3D 引擎 Three.js）
const ROUTES = [
  { prefix: '/lib/three/', dir: path.join(__dirname, 'node_modules', 'three') },
  { prefix: '/', dir: path.join(__dirname, 'public') },
];

// 副檔名 → 瀏覽器需要知道的檔案類型
const MIME = {
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

// 處理每一個網頁請求：找到檔案就送出，找不到就回 404
export function handleRequest(req, res) {
  let urlPath;
  // 1. 安全修復：處理惡意或不合法的 URL 編碼，避免例外崩潰
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
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
}

// 封裝啟動伺服器函式，支援測試與外部呼叫
export function startServer({ port = PORT } = {}) {
  const server = http.createServer(handleRequest);

  server.listen(port, () => {
    console.log('');
    console.log('  🏁 賽車遊戲伺服器已啟動！');
    console.log(`  👉 用瀏覽器打開：http://localhost:${port}`);
    console.log('  （要關閉伺服器請按 Ctrl + C）');
    console.log('');
  });

  return server;
}

// 僅在直接透過 node server.js 執行時自動啟動（若是測試 import 則不自動啟動）
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  startServer({ port: PORT });
}

// ------------------------------------------------------------
// 第二階段：WebSocket 與 HTTPS 會加在這下面
// ------------------------------------------------------------
