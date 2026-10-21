// ============================================================
//  server.test.js — 伺服器房間管理與 WebSocket 協定自動化測試
//  測試大螢幕建立房間（4 位數房號）、手機加入、錯誤房號處理、
//  滿額阻擋（上限 4 人）、輸入數值伺服器端 clamp、toPlayer 定向轉發、
//  手機斷線 playerLeft 通知、大螢幕斷線 roomClosed 通知、
//  異常垃圾字串防崩潰容錯，以及 HTTPS 憑證自動生成。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { startServer, getLocalIp, getOrCreateCert } from '../server.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 工具：建立連線至伺服器的 WebSocket 客戶端
function connectClient(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', (err) => reject(err));
  });
}

// 工具：等待符合條件的下一筆訊息
function waitForMessage(ws, predicate = () => true, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`等待訊息逾時（${timeoutMs}ms）`));
    }, timeoutMs);

    function onMessage(data) {
      try {
        const msg = JSON.parse(data.toString());
        if (predicate(msg)) {
          clearTimeout(timer);
          ws.off('message', onMessage);
          resolve(msg);
        }
      } catch (e) {}
    }

    ws.on('message', onMessage);
  });
}

test('1. 大螢幕送出 {type: "host"} 能拿到 4 位數字不重複房號（1000~9999）', async () => {
  const server = await startServer({ httpPort: 0, httpsPort: null });
  await server.ready;
  const clients = [];

  try {
    const host = await connectClient(server.httpPort);
    clients.push(host);

    host.send(JSON.stringify({ type: 'host' }));
    const msg = await waitForMessage(host, (m) => m.type === 'roomCreated');

    assert.equal(typeof msg.code, 'string');
    assert.match(msg.code, /^\d{4}$/, '房號應為 4 位數字字串');
    const num = parseInt(msg.code, 10);
    assert.ok(num >= 1000 && num <= 9999, '房號數值應介於 1000 至 9999');
  } finally {
    for (const c of clients) {
      try { c.terminate(); } catch (e) {}
    }
    await server.close();
  }
});

test('2. 手機輸入錯誤房號時收到繁體中文 error 訊息', async () => {
  const server = await startServer({ httpPort: 0, httpsPort: null });
  await server.ready;
  const clients = [];

  try {
    const phone = await connectClient(server.httpPort);
    clients.push(phone);

    phone.send(JSON.stringify({ type: 'join', code: '0000', name: '測試手機' }));
    const msg = await waitForMessage(phone, (m) => m.type === 'error');

    assert.equal(msg.type, 'error');
    assert.ok(
      msg.message.includes('找不到') || msg.message.includes('錯誤'),
      `錯誤訊息應包含繁體中文提示，實際為：${msg.message}`
    );
  } finally {
    for (const c of clients) {
      try { c.terminate(); } catch (e) {}
    }
    await server.close();
  }
});

test('3. 一個房間最多 4 支手機加入，第 5 支手機收到「已滿」error', async () => {
  const server = await startServer({ httpPort: 0, httpsPort: null });
  await server.ready;
  const clients = [];

  try {
    // 建立大螢幕房間
    const host = await connectClient(server.httpPort);
    clients.push(host);
    host.send(JSON.stringify({ type: 'host' }));
    const { code } = await waitForMessage(host, (m) => m.type === 'roomCreated');

    // 連線 4 支手機加入
    for (let i = 1; i <= 4; i++) {
      const phone = await connectClient(server.httpPort);
      clients.push(phone);
      phone.send(JSON.stringify({ type: 'join', code, name: `手機${i}` }));
      const joinMsg = await waitForMessage(phone, (m) => m.type === 'joined');
      assert.ok(joinMsg.playerId, `手機 ${i} 應成功取得 playerId`);
    }

    // 第 5 支手機嘗試加入
    const phone5 = await connectClient(server.httpPort);
    clients.push(phone5);
    phone5.send(JSON.stringify({ type: 'join', code, name: '手機5' }));
    const err = await waitForMessage(phone5, (m) => m.type === 'error');

    assert.equal(err.type, 'error');
    assert.ok(
      err.message.includes('已滿'),
      `第 5 支手機應收到房間已滿通知，實際訊息為：${err.message}`
    );
  } finally {
    for (const c of clients) {
      try { c.terminate(); } catch (e) {}
    }
    await server.close();
  }
});

test('4. 手機送出 input 轉給大螢幕且帶有 playerId，且數值在伺服器端被 clamp 限制', async () => {
  const server = await startServer({ httpPort: 0, httpsPort: null });
  await server.ready;
  const clients = [];

  try {
    const host = await connectClient(server.httpPort);
    clients.push(host);
    host.send(JSON.stringify({ type: 'host' }));
    const { code } = await waitForMessage(host, (m) => m.type === 'roomCreated');

    const phone = await connectClient(server.httpPort);
    clients.push(phone);
    phone.send(JSON.stringify({ type: 'join', code, name: '飆速玩家' }));
    const { playerId } = await waitForMessage(phone, (m) => m.type === 'joined');

    // 送出極端/違規數值測試伺服器 clamp 防護
    phone.send(JSON.stringify({
      type: 'input',
      steer: 99.5,
      throttle: -5.0,
      brake: 10.0,
      item: 4.8,
    }));

    const inputMsg = await waitForMessage(host, (m) => m.type === 'input');

    assert.equal(inputMsg.playerId, playerId);
    assert.equal(inputMsg.steer, 1, 'steer: 99.5 應被限制為 1');
    assert.equal(inputMsg.throttle, 0, 'throttle: -5.0 應被限制為 0');
    assert.equal(inputMsg.brake, 1, 'brake: 10.0 應被限制為 1');
    assert.equal(inputMsg.item, 4, 'item 應向下取整數 4');
  } finally {
    for (const c of clients) {
      try { c.terminate(); } catch (e) {}
    }
    await server.close();
  }
});

test('5. 大螢幕送出 toPlayer 只能送達同一房間的指定手機', async () => {
  const server = await startServer({ httpPort: 0, httpsPort: null });
  await server.ready;
  const clients = [];

  try {
    const host = await connectClient(server.httpPort);
    clients.push(host);
    host.send(JSON.stringify({ type: 'host' }));
    const { code } = await waitForMessage(host, (m) => m.type === 'roomCreated');

    const phone1 = await connectClient(server.httpPort);
    clients.push(phone1);
    phone1.send(JSON.stringify({ type: 'join', code, name: '玩家一' }));
    const { playerId: p1Id } = await waitForMessage(phone1, (m) => m.type === 'joined');

    const phone2 = await connectClient(server.httpPort);
    clients.push(phone2);
    phone2.send(JSON.stringify({ type: 'join', code, name: '玩家二' }));
    await waitForMessage(phone2, (m) => m.type === 'joined');

    let phone2ReceivedVibrate = false;
    phone2.on('message', (raw) => {
      try {
        const m = JSON.parse(raw.toString());
        if (m.type === 'vibrate') phone2ReceivedVibrate = true;
      } catch (e) {}
    });

    // 大螢幕定向只送給玩家一
    host.send(JSON.stringify({
      type: 'toPlayer',
      playerId: p1Id,
      data: { type: 'vibrate', ms: 300 },
    }));

    const p1Msg = await waitForMessage(phone1, (m) => m.type === 'vibrate');
    assert.equal(p1Msg.type, 'vibrate');
    assert.equal(p1Msg.ms, 300);

    // 等待 100ms 確認玩家二確實未收到震動
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(phone2ReceivedVibrate, false, '玩家二不應收到指定傳送給玩家一的訊息');
  } finally {
    for (const c of clients) {
      try { c.terminate(); } catch (e) {}
    }
    await server.close();
  }
});

test('6. 手機斷線時，大螢幕收到 playerLeft 通知', async () => {
  const server = await startServer({ httpPort: 0, httpsPort: null });
  await server.ready;
  const clients = [];

  try {
    const host = await connectClient(server.httpPort);
    clients.push(host);
    host.send(JSON.stringify({ type: 'host' }));
    const { code } = await waitForMessage(host, (m) => m.type === 'roomCreated');

    const phone = await connectClient(server.httpPort);
    clients.push(phone);
    phone.send(JSON.stringify({ type: 'join', code, name: '離線玩家' }));
    const { playerId } = await waitForMessage(phone, (m) => m.type === 'joined');

    // 手機斷開連線
    phone.terminate();

    const leftMsg = await waitForMessage(host, (m) => m.type === 'playerLeft');
    assert.equal(leftMsg.playerId, playerId);
  } finally {
    for (const c of clients) {
      try { c.terminate(); } catch (e) {}
    }
    await server.close();
  }
});

test('7. 大螢幕斷線時，手機收到 roomClosed 通知', async () => {
  const server = await startServer({ httpPort: 0, httpsPort: null });
  await server.ready;
  const clients = [];

  try {
    const host = await connectClient(server.httpPort);
    clients.push(host);
    host.send(JSON.stringify({ type: 'host' }));
    const { code } = await waitForMessage(host, (m) => m.type === 'roomCreated');

    const phone = await connectClient(server.httpPort);
    clients.push(phone);
    phone.send(JSON.stringify({ type: 'join', code, name: '留守手機' }));
    await waitForMessage(phone, (m) => m.type === 'joined');

    // 大螢幕主動斷線
    host.terminate();

    const closedMsg = await waitForMessage(phone, (m) => m.type === 'roomClosed');
    assert.equal(closedMsg.type, 'roomClosed');
  } finally {
    for (const c of clients) {
      try { c.terminate(); } catch (e) {}
    }
    await server.close();
  }
});

test('8. 送出惡意非 JSON 垃圾字串或畸形資料時，伺服器不崩潰且能正常處理後續連線', async () => {
  const server = await startServer({ httpPort: 0, httpsPort: null });
  await server.ready;
  const clients = [];

  try {
    const badClient = await connectClient(server.httpPort);
    clients.push(badClient);

    // 送出各種非 JSON 垃圾字串與空物件
    badClient.send('GARBAGE_NOT_JSON {{{');
    badClient.send('123456');
    badClient.send('null');
    badClient.send('');
    badClient.send(Buffer.from([0x00, 0xff, 0xfe, 0x12]));

    // 隨後正常的客戶端連線仍能正常開房
    const normalHost = await connectClient(server.httpPort);
    clients.push(normalHost);
    normalHost.send(JSON.stringify({ type: 'host' }));

    const msg = await waitForMessage(normalHost, (m) => m.type === 'roomCreated');
    assert.ok(msg.code, '伺服器遭遇垃圾字串後仍穩定運行並成功開房');
  } finally {
    for (const c of clients) {
      try { c.terminate(); } catch (e) {}
    }
    await server.close();
  }
});

test('9. 自動產生自簽憑證並成功啟動 HTTPS 伺服器', async () => {
  const testCertDir = path.join(__dirname, 'test_cert');
  try {
    // 測試自簽憑證產生
    const { key, cert } = await getOrCreateCert({ certDir: testCertDir, localIp: '127.0.0.1' });
    assert.ok(key.includes('BEGIN PRIVATE KEY') || key.includes('BEGIN RSA PRIVATE KEY'));
    assert.ok(cert.includes('BEGIN CERTIFICATE'));
    assert.ok(fs.existsSync(path.join(testCertDir, 'version.txt')), '應建立 version.txt');

    // 啟動含 HTTPS 隨機埠之伺服器
    const server = await startServer({ httpPort: 0, httpsPort: 0, certDir: testCertDir });
    await server.ready;
    assert.ok(server.httpsPort > 0, 'HTTPS 伺服器應綁定大於 0 之埠號');
    await server.close();
  } finally {
    try {
      fs.rmSync(testCertDir, { recursive: true, force: true });
    } catch (e) {}
  }
});

test('10. 憑證資料夾缺少 version.txt 或版本不符時，自動重新產生新版憑證與 version.txt', async () => {
  const testCertDir = path.join(__dirname, 'test_cert_version');
  try {
    fs.mkdirSync(testCertDir, { recursive: true });
    // 建立模擬舊版憑證（無 version.txt）
    fs.writeFileSync(path.join(testCertDir, 'key.pem'), 'OLD_KEY', 'utf8');
    fs.writeFileSync(path.join(testCertDir, 'cert.pem'), 'OLD_CERT', 'utf8');

    const { key, cert } = await getOrCreateCert({ certDir: testCertDir, localIp: '127.0.0.1' });
    assert.notEqual(key, 'OLD_KEY', '舊憑證應被覆蓋');
    assert.notEqual(cert, 'OLD_CERT', '舊憑證應被覆蓋');
    assert.ok(fs.existsSync(path.join(testCertDir, 'version.txt')), '應建立 version.txt');
    const version = fs.readFileSync(path.join(testCertDir, 'version.txt'), 'utf8').trim();
    assert.equal(version, 'selfsigned5-sha256-730d');

    // 再次讀取時應直接重用（不重新產生）
    const cached = await getOrCreateCert({ certDir: testCertDir, localIp: '127.0.0.1' });
    assert.equal(cached.key, key);
    assert.equal(cached.cert, cert);
  } finally {
    try {
      fs.rmSync(testCertDir, { recursive: true, force: true });
    } catch (e) {}
  }
});

test('11. 同一個手機 socket 連續送兩次 join，大螢幕只保留一個玩家且斷線後人數為 0', async () => {
  const server = await startServer({ httpPort: 0, httpsPort: null });
  await server.ready;
  const clients = [];

  try {
    const host = await connectClient(server.httpPort);
    clients.push(host);
    host.send(JSON.stringify({ type: 'host' }));
    const { code } = await waitForMessage(host, (m) => m.type === 'roomCreated');

    const phone = await connectClient(server.httpPort);
    clients.push(phone);

    // 第一次 join
    phone.send(JSON.stringify({ type: 'join', code, name: '測試玩家1' }));
    const join1 = await waitForMessage(phone, (m) => m.type === 'joined');
    const hostJoin1 = await waitForMessage(host, (m) => m.type === 'playerJoined');
    assert.equal(join1.playerId, hostJoin1.playerId);

    const room = server.hub.rooms.get(code);
    assert.equal(room.players.size, 1);

    // 第二次 join（同一個 socket 連線）
    phone.send(JSON.stringify({ type: 'join', code, name: '測試玩家2' }));
    const join2 = await waitForMessage(phone, (m) => m.type === 'joined');
    assert.notEqual(join2.playerId, join1.playerId, '重新 join 應取得新的 playerId');

    // 檢查房內人數維持 1，沒有殘留幽靈玩家
    assert.equal(room.players.size, 1, '房內玩家數應維持 1 人');
    assert.ok(room.players.has(join2.playerId), '房內應只保留最新 join 的玩家');
    assert.equal(room.players.has(join1.playerId), false, '舊 playerId 應已被清除');

    // 手機斷線
    phone.terminate();
    const leftMsg = await waitForMessage(host, (m) => m.type === 'playerLeft');
    assert.equal(leftMsg.playerId, join2.playerId);

    // 確認斷線後房內人數為 0
    assert.equal(room.players.size, 0, '斷線後房內人數應為 0');
  } finally {
    for (const c of clients) {
      try { c.terminate(); } catch (e) {}
    }
    await server.close();
  }
});

test('12. 通訊埠被占用（EADDRINUSE）時，startServer 應 reject 而非拋出未處理例外崩潰', async () => {
  // 先建立一個原生 HTTP 伺服器占用一個隨機通訊埠
  const dummyServer = http.createServer();
  await new Promise((resolve) => dummyServer.listen(0, resolve));
  const occupiedPort = dummyServer.address().port;

  try {
    // 以同一個已占用的埠啟動 startServer，應 reject
    await assert.rejects(
      async () => {
        const s = await startServer({ httpPort: occupiedPort, httpsPort: null });
        await s.ready;
      },
      (err) => {
        assert.equal(err.code, 'EADDRINUSE');
        return true;
      },
      'startServer 遇到通訊埠被占用時應 reject EADDRINUSE 錯誤'
    );
  } finally {
    await new Promise((resolve) => dummyServer.close(resolve));
  }
});
