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
const PORT = process.env.PORT || 3000;

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
function handleRequest(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (urlPath.endsWith('/')) urlPath += 'index.html';

  const route = ROUTES.find((r) => urlPath.startsWith(r.prefix));
  const filePath = path.join(route.dir, urlPath.slice(route.prefix.length));

  // 安全檢查：不允許用 ../ 讀到資料夾外面的檔案
  if (!filePath.startsWith(route.dir)) {
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

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log('');
  console.log('  🏁 賽車遊戲伺服器已啟動！');
  console.log(`  👉 用瀏覽器打開：http://localhost:${PORT}`);
  console.log('  （要關閉伺服器請按 Ctrl + C）');
  console.log('');
});

// ------------------------------------------------------------
// 第二階段：WebSocket 與 HTTPS 會加在這下面
// ------------------------------------------------------------
