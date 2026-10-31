// ============================================================
//  kartLook.js — 卡丁車造型組裝（車款模型 ＋ 車手人物 ＋ 烤漆顏色）
//  Kenney 的四款卡丁車共用同一個人物模型（character 節點），所以這裡把它拿掉，
//  改用 Three.js 基本幾何形狀組出 8 位不同的車手（見 config.js 的 DRIVERS），
//  車手的衣服顏色會跟著烤漆變化。
//  大螢幕（car.js）與手機造型預覽（controller.js）共用這個模組。
// ============================================================

import * as THREE from 'three';
import { DRIVERS } from './config.js';

const SKIN = 0xffd7b5;

// 組裝完整造型：template 為 assets.getKart() 複製出的車款模型
// 回傳 { model, materials }，materials 是這次新建立的材質（拆除時要 dispose）
export function buildKartLook(template, { driver = 0, color = '#ffffff' } = {}) {
  const model = template;
  const materials = [];

  // 1. 找出原本的人物節點，記下位置後移除
  let character = null;
  model.traverse((node) => {
    if (!character && node.name === 'character') character = node;
  });
  const anchorParent = character ? character.parent : model;
  const anchorPos = character ? character.position.clone() : new THREE.Vector3(0, 0.28, -0.07);
  if (character) character.parent.remove(character);

  // 2. 車身乘上烤漆顏色（輪胎保持原色）
  paintBody(model, color, materials);

  // 3. 放上車手
  const person = buildDriver(driver, color, materials);
  person.position.copy(anchorPos);
  anchorParent.add(person);

  return { model, materials };
}

// 依烤漆顏色重新上色車身（四款車共用同一張 colormap 貼圖，原本看起來都一樣灰）
function paintBody(model, colorHex, materials) {
  const tint = new THREE.Color(colorHex).multiplyScalar(1.35);
  const cache = new Map();
  model.traverse((node) => {
    if (!node.isMesh) return;
    for (let p = node; p && p !== model; p = p.parent) {
      if (p.name.startsWith('wheel')) return;
    }
    const swap = (mat) => {
      if (!cache.has(mat.uuid)) {
        const painted = mat.clone();
        painted.color = tint.clone();
        cache.set(mat.uuid, painted);
        materials.push(painted);
      }
      return cache.get(mat.uuid);
    };
    node.material = Array.isArray(node.material) ? node.material.map(swap) : swap(node.material);
  });
}

// 建立車手人物（座標單位與 Kenney 模型相同：人物約 1 單位高，臉朝 +Z 車頭方向）
export function buildDriver(driverIndex, colorHex, materials = []) {
  const id = (DRIVERS[driverIndex] || DRIVERS[0]).id;
  const group = new THREE.Group();
  group.name = 'driver';

  const suitColor = new THREE.Color(colorHex);
  const accentColor = suitColor.clone().lerp(new THREE.Color(0xffffff), 0.45);

  // 材質工廠（同一位車手共用，最後統一回收）
  const matCache = new Map();
  const mat = (color, opts = {}) => {
    const key = `${new THREE.Color(color).getHexString()}_${JSON.stringify(opts)}`;
    if (!matCache.has(key)) {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opts });
      matCache.set(key, m);
      materials.push(m);
    }
    return matCache.get(key);
  };
  const add = (geo, material, [x, y, z], { rot = null, scale = null } = {}) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };

  // ---------- 共用身體 ----------
  const suit = id === 'astronaut' ? mat(0xf1f2f6) : (id === 'ninja' ? mat(0x2d3436) : (id === 'robot' ? mat(0xa4b0be, { metalness: 0.6, roughness: 0.35 }) : mat(suitColor)));
  add(new THREE.CapsuleGeometry(0.21, 0.2, 4, 10), suit, [0, 0.34, 0]);
  // 手臂往前伸向方向盤＋手套
  for (const side of [-1, 1]) {
    add(new THREE.CapsuleGeometry(0.06, 0.24, 3, 6), suit, [side * 0.22, 0.4, 0.15], { rot: [1.15, 0, -side * 0.2] });
    add(new THREE.SphereGeometry(0.075, 8, 6), mat(id === 'robot' ? 0x57606f : 0x2f3542), [side * 0.17, 0.36, 0.3]);
  }
  // 身上的烤漆色腰帶 / 胸口標誌
  add(new THREE.TorusGeometry(0.205, 0.035, 6, 16), mat(id === 'ninja' || id === 'robot' || id === 'astronaut' ? suitColor : accentColor), [0, 0.27, 0], { rot: [Math.PI / 2, 0, 0] });

  const headY = 0.78;
  const eyes = (z = 0.215, y = headY + 0.02, color = 0x1e272e, r = 0.035) => {
    for (const side of [-1, 1]) add(new THREE.SphereGeometry(r, 8, 6), mat(color), [side * 0.085, y, z]);
  };

  // ---------- 各車手專屬造型 ----------
  switch (id) {
    case 'racer': {
      // 全罩安全帽（烤漆色）＋深色護目鏡＋白色條紋
      add(new THREE.SphereGeometry(0.285, 16, 12), mat(suitColor, { roughness: 0.3, metalness: 0.2 }), [0, headY, 0], { scale: [1, 1, 1.05] });
      add(new THREE.BoxGeometry(0.4, 0.13, 0.12), mat(0x1e272e, { roughness: 0.1, metalness: 0.5 }), [0, headY + 0.02, 0.24]);
      add(new THREE.BoxGeometry(0.07, 0.02, 0.56), mat(0xffffff), [0, headY + 0.27, -0.02], { rot: [0.05, 0, 0] });
      break;
    }
    case 'astronaut': {
      add(new THREE.SphereGeometry(0.22, 14, 10), mat(SKIN), [0, headY, 0]);
      eyes(0.2);
      add(new THREE.SphereGeometry(0.33, 18, 14), mat(0xc7ecee, { transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.2 }), [0, headY, 0]);
      add(new THREE.TorusGeometry(0.26, 0.04, 6, 18), mat(0xdfe4ea, { metalness: 0.5 }), [0, headY - 0.26, 0], { rot: [Math.PI / 2, 0, 0] });
      add(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 6), mat(0xdfe4ea), [0.14, headY + 0.4, -0.05]);
      add(new THREE.SphereGeometry(0.05, 8, 6), mat(0xff4757, { emissive: 0xff4757, emissiveIntensity: 0.6 }), [0.14, headY + 0.56, -0.05]);
      add(new THREE.BoxGeometry(0.16, 0.12, 0.04), mat(suitColor), [0, 0.42, 0.2]);
      break;
    }
    case 'ninja': {
      add(new THREE.SphereGeometry(0.26, 14, 10), mat(0x2d3436), [0, headY, 0]);
      add(new THREE.BoxGeometry(0.36, 0.1, 0.1), mat(SKIN), [0, headY + 0.02, 0.2]);
      eyes(0.26, headY + 0.02, 0x1e272e, 0.03);
      add(new THREE.TorusGeometry(0.255, 0.035, 6, 18), mat(suitColor), [0, headY + 0.1, 0], { rot: [Math.PI / 2 - 0.15, 0, 0] });
      // 頭巾飄帶
      for (const side of [-1, 1]) {
        add(new THREE.BoxGeometry(0.06, 0.03, 0.4), mat(suitColor), [side * 0.07, headY + 0.07, -0.42], { rot: [0.35, side * 0.25, 0] });
      }
      break;
    }
    case 'robot': {
      add(new THREE.BoxGeometry(0.42, 0.36, 0.38), mat(0xa4b0be, { metalness: 0.7, roughness: 0.3 }), [0, headY, 0]);
      for (const side of [-1, 1]) {
        add(new THREE.BoxGeometry(0.09, 0.06, 0.03), mat(0x48dbfb, { emissive: 0x48dbfb, emissiveIntensity: 1 }), [side * 0.1, headY + 0.04, 0.2]);
        add(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 10), mat(suitColor, { metalness: 0.5 }), [side * 0.23, headY, 0], { rot: [0, 0, Math.PI / 2] });
      }
      add(new THREE.BoxGeometry(0.2, 0.05, 0.03), mat(0x2f3542), [0, headY - 0.09, 0.2]);
      add(new THREE.CylinderGeometry(0.015, 0.015, 0.22, 6), mat(0x57606f), [0, headY + 0.29, 0]);
      add(new THREE.SphereGeometry(0.045, 8, 6), mat(suitColor, { emissive: suitColor, emissiveIntensity: 0.5 }), [0, headY + 0.42, 0]);
      break;
    }
    case 'cowboy': {
      add(new THREE.SphereGeometry(0.24, 14, 10), mat(SKIN), [0, headY, 0]);
      eyes();
      add(new THREE.CylinderGeometry(0.44, 0.44, 0.03, 18), mat(0x8e5b3a), [0, headY + 0.2, 0]);
      add(new THREE.CylinderGeometry(0.19, 0.23, 0.2, 14), mat(0x8e5b3a), [0, headY + 0.31, 0]);
      add(new THREE.CylinderGeometry(0.235, 0.235, 0.05, 14), mat(suitColor), [0, headY + 0.23, 0]);
      // 領巾
      add(new THREE.ConeGeometry(0.16, 0.18, 4), mat(0xe74c3c), [0, headY - 0.3, 0.13], { rot: [Math.PI + 0.4, 0, 0] });
      break;
    }
    case 'bunny': {
      add(new THREE.SphereGeometry(0.25, 14, 10), mat(0xffffff), [0, headY, 0]);
      eyes(0.225);
      add(new THREE.SphereGeometry(0.04, 8, 6), mat(0xff6b9d), [0, headY - 0.05, 0.24]);
      for (const side of [-1, 1]) {
        add(new THREE.SphereGeometry(0.2, 10, 8), mat(0xffffff), [side * 0.11, headY + 0.38, -0.02], { scale: [0.33, 1.15, 0.22], rot: [0, 0, -side * 0.15] });
        add(new THREE.SphereGeometry(0.2, 10, 8), mat(0xffb8d1), [side * 0.11, headY + 0.38, 0.015], { scale: [0.18, 0.95, 0.12], rot: [0, 0, -side * 0.15] });
        add(new THREE.SphereGeometry(0.05, 8, 6), mat(0xffb8d1), [side * 0.15, headY - 0.06, 0.2]);
      }
      break;
    }
    case 'princess': {
      add(new THREE.SphereGeometry(0.24, 14, 10), mat(SKIN), [0, headY, 0]);
      eyes();
      add(new THREE.SphereGeometry(0.27, 14, 10), mat(0x8b5a2b), [0, headY + 0.04, -0.05], { scale: [1.05, 1, 0.95] });
      add(new THREE.BoxGeometry(0.42, 0.42, 0.12), mat(0x8b5a2b), [0, headY - 0.18, -0.2]);
      // 皇冠
      add(new THREE.CylinderGeometry(0.14, 0.15, 0.09, 12, 1, true), mat(0xf9ca24, { metalness: 0.7, roughness: 0.25, side: THREE.DoubleSide }), [0, headY + 0.28, 0]);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        add(new THREE.ConeGeometry(0.03, 0.08, 5), mat(0xf9ca24, { metalness: 0.7, roughness: 0.25 }), [Math.sin(a) * 0.14, headY + 0.36, Math.cos(a) * 0.14]);
      }
      add(new THREE.SphereGeometry(0.03, 8, 6), mat(suitColor, { emissive: suitColor, emissiveIntensity: 0.4 }), [0, headY + 0.29, 0.15]);
      break;
    }
    case 'dino': {
      const hood = mat(accentColor);
      add(new THREE.SphereGeometry(0.27, 14, 10), hood, [0, headY, -0.02]);
      add(new THREE.SphereGeometry(0.17, 12, 8), hood, [0, headY - 0.04, 0.2], { scale: [1.1, 0.75, 1.2] });
      add(new THREE.BoxGeometry(0.28, 0.12, 0.06), mat(SKIN), [0, headY - 0.02, 0.29]);
      eyes(0.18, headY + 0.13, 0x1e272e, 0.04);
      for (let k = 0; k < 5; k++) {
        add(new THREE.ConeGeometry(0.06, 0.14, 5), mat(0xff9f43), [0, headY + 0.28 - k * 0.15, -0.12 - k * 0.07], { rot: [-0.5 - k * 0.2, 0, 0] });
      }
      for (const side of [-1, 1]) {
        add(new THREE.ConeGeometry(0.02, 0.05, 4), mat(0xffffff), [side * 0.08, headY - 0.09, 0.32], { rot: [Math.PI, 0, 0] });
      }
      break;
    }
  }

  return group;
}
