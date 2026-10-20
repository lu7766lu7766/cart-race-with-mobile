// ============================================================
//  utils.test.js — 基礎數學與工具函式單元測試
//  測試 clamp、angleDiff、formatTime、Emitter、mulberry32 與 getViewportRects。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { clamp, angleDiff, formatTime, Emitter, mulberry32, rand, getViewportRects } from '../public/js/utils.js';

test('clamp 限制數值在上下限區間', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(15, 0, 10), 10);
});

test('angleDiff 計算兩角度最短差（落於 -π ~ π）', () => {
  const diff1 = angleDiff(0, Math.PI / 2);
  assert.ok(Math.abs(diff1 - Math.PI / 2) < 1e-6);

  const diff2 = angleDiff(Math.PI * 0.9, -Math.PI * 0.9);
  assert.ok(Math.abs(diff2 - Math.PI * 0.2) < 1e-6);
});

test('formatTime 時間格式化與進位修復', () => {
  assert.equal(formatTime(0), '0:00.00');
  assert.equal(formatTime(65.43), '1:05.43');
  assert.equal(formatTime(59.996), '1:00.00');
  assert.equal(formatTime(null), '--:--.--');
  assert.equal(formatTime(Infinity), '--:--.--');
});

test('Emitter 訂閱、發送與取消訂閱', () => {
  const emitter = new Emitter();
  let callCount = 0;
  let receivedData = null;

  const unsubscribe = emitter.on('testEvent', (data) => {
    callCount++;
    receivedData = data;
  });

  emitter.emit('testEvent', { value: 42 });
  assert.equal(callCount, 1);
  assert.deepEqual(receivedData, { value: 42 });

  unsubscribe();
  emitter.emit('testEvent', { value: 99 });
  assert.equal(callCount, 1, '取消訂閱後處理函式不應再被呼叫');
});

test('mulberry32 相同種子產生完全一致的隨機序列', () => {
  const rngA = mulberry32(12345);
  const rngB = mulberry32(12345);

  const seqA = [rngA(), rngA(), rngA(), rngA()];
  const seqB = [rngB(), rngB(), rngB(), rngB()];

  assert.deepEqual(seqA, seqB);

  for (const v of seqA) {
    assert.ok(v >= 0 && v < 1);
  }

  const rVal = rand(10, 20, rngA);
  assert.ok(rVal >= 10 && rVal <= 20);
});

test('6.8 分割畫面配置：getViewportRects 對 1/2/3/4 人回傳正確格數與 WebGL y (2x2 上排 y = H/2)', () => {
  const W = 1920;
  const H = 1080;

  // 1 人：1 格全螢幕
  const r1 = getViewportRects(1, W, H);
  assert.equal(r1.length, 1);
  assert.deepEqual(r1[0], { x: 0, y: 0, top: 0, w: 1920, h: 1080 });

  // 2 人：左右分割兩格
  const r2 = getViewportRects(2, W, H);
  assert.equal(r2.length, 2);
  assert.deepEqual(r2[0], { x: 0, y: 0, top: 0, w: 960, h: 1080 });
  assert.deepEqual(r2[1], { x: 960, y: 0, top: 0, w: 960, h: 1080 });

  // 3 人：2×2 四格（第 4 格全場俯視）
  const r3 = getViewportRects(3, W, H);
  assert.equal(r3.length, 4);
  assert.equal(r3[0].y, 540, '2×2 上排 WebGL y 應為 H/2 (540)');
  assert.equal(r3[1].y, 540, '2×2 上排 WebGL y 應為 H/2 (540)');
  assert.equal(r3[2].y, 0, '2×2 下排 WebGL y 應為 0');
  assert.equal(r3[3].y, 0, '2×2 下排 WebGL y 應為 0');

  // 4 人：2×2 四格
  const r4 = getViewportRects(4, W, H);
  assert.equal(r4.length, 4);
  assert.equal(r4[0].y, 540);
  assert.equal(r4[1].y, 540);
  assert.equal(r4[2].y, 0);
  assert.equal(r4[3].y, 0);
});
