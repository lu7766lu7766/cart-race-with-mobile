// ============================================================
//  utils.test.js — 基礎數學與工具函式單元測試
//  測試 clamp、angleDiff、formatTime、Emitter 與 mulberry32 隨機種子生成。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { clamp, angleDiff, formatTime, Emitter, mulberry32, rand } from '../public/js/utils.js';

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
  // 59.996 秒應正確進位顯示為 1:00.00 而不是 0:60.00
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

  // 測試取消訂閱
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

  // 測試隨機值均在 [0, 1) 區間
  for (const v of seqA) {
    assert.ok(v >= 0 && v < 1);
  }

  // 測試 rand 搭配 mulberry32
  const rVal = rand(10, 20, rngA);
  assert.ok(rVal >= 10 && rVal <= 20);
});
