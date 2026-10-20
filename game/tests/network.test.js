// ============================================================
//  network.test.js — 遠端輸入控制器（RemoteInput）單元測試
//  測試 RemoteInput 在 Node.js 環境下的輸入抽象層邏輯：
//  正常輸入轉發、油門＋倒退雙鍵甩尾判定、道具累加計數器單次觸發、
//  500ms 逾時安全歸零防暴衝機制，以及 reset() 道具觸發重設。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteInput } from '../public/js/network.js';

test('1. RemoteInput 初始狀態：各項操控數值為 0，無道具觸發與甩尾', () => {
  const input = new RemoteInput();
  const state = input.getState();

  assert.equal(state.steer, 0);
  assert.equal(state.throttle, 0);
  assert.equal(state.brake, 0);
  assert.equal(state.drift, false);
  assert.equal(state.useItem, false);
});

test('2. 正常即時輸入更新與數值保存', () => {
  let currentTime = 1000;
  const input = new RemoteInput({ now: () => currentTime });

  input.update({ steer: 0.65, throttle: 1.0, brake: 0, item: 0 });
  const state = input.getState();

  assert.equal(state.steer, 0.65);
  assert.equal(state.throttle, 1.0);
  assert.equal(state.brake, 0);
  assert.equal(state.drift, false);
  assert.equal(state.useItem, false);
});

test('3. 同時按下油門與倒退時，drift 判定為 true 且油門/倒退不互相抵銷', () => {
  const input = new RemoteInput();

  input.update({ steer: 0.5, throttle: 1.0, brake: 1.0, item: 0 });
  const state = input.getState();

  assert.equal(state.throttle, 1.0, '油門數值應保留為 1.0');
  assert.equal(state.brake, 1.0, '倒退煞車數值應保留為 1.0');
  assert.equal(state.drift, true, '油門與煞車同時大於 0.5 時應自動標記 drift: true');
});

test('4. 道具累加計數器：數字增加時僅單次觸發 useItem: true，不重複發送', () => {
  const input = new RemoteInput();

  // 第一次增加：item 從 0 變 1
  input.update({ steer: 0, throttle: 1, brake: 0, item: 1 });

  // 第一次讀取：應觸發使用道具
  assert.equal(input.getState().useItem, true, '計數器增加後第一次讀取應為 useItem: true');

  // 第二次讀取：已消費，應回到 false
  assert.equal(input.getState().useItem, false, '第二次讀取應恢復為 useItem: false');

  // 若手機持續送出相同的 item: 1，不應再次觸發
  input.update({ steer: 0, throttle: 1, brake: 0, item: 1 });
  assert.equal(input.getState().useItem, false, '未累加時不應再次觸發');

  // 計數器再次累加至 2
  input.update({ steer: 0, throttle: 1, brake: 0, item: 2 });
  assert.equal(input.getState().useItem, true, '計數器累加至 2 時應再次觸發 useItem: true');
  assert.equal(input.getState().useItem, false, '再次消費後恢復為 false');
});

test('5. 逾時歸零機制：超過 500ms 未收到輸入時，操控值自動安全歸零避免車輛暴衝', () => {
  let currentTime = 10000;
  const input = new RemoteInput({ now: () => currentTime, timeoutMs: 500 });

  input.update({ steer: 0.8, throttle: 1.0, brake: 0 });

  // 經過 300ms（未超過 500ms）
  currentTime += 300;
  const stateMid = input.getState();
  assert.equal(stateMid.throttle, 1.0, '300ms 內尚未逾時，油門維持 1.0');
  assert.equal(stateMid.steer, 0.8, '300ms 內尚未逾時，轉向維持 0.8');

  // 再經過 300ms（累計經過 600ms，超過 500ms 閾值）
  currentTime += 300;
  const stateTimedOut = input.getState();
  assert.equal(stateTimedOut.throttle, 0, '超過 500ms 沒收到訊號，油門應歸零');
  assert.equal(stateTimedOut.steer, 0, '超過 500ms 沒收到訊號，轉向應歸零');
  assert.equal(stateTimedOut.brake, 0, '超過 500ms 沒收到訊號，煞車應歸零');
  assert.equal(stateTimedOut.drift, false, '超過 500ms 沒收到訊號，甩尾應重設為 false');
});

test('6. reset() 函式能清空尚未讀取的道具觸發', () => {
  const input = new RemoteInput();

  input.update({ steer: 0, throttle: 0, brake: 0, item: 1 });
  // 在讀取前呼叫 reset()（如 Game 在開賽瞬間清空輸入）
  input.reset();

  assert.equal(input.getState().useItem, false, '呼叫 reset() 後未讀取的道具觸發應被清除');
});
