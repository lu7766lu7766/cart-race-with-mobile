// ============================================================
//  assets.js — 3D 模型與素材非同步載入器
//  使用 GLTFLoader 載入 Kenney 卡丁車與賽道裝飾模型。
//  具備進度回報、8 秒逾時機制與防呆備用模型（模型遺失或載入失敗時
//  自動使用彩色方塊替代，確保遊戲永遠不會卡死）。
// ============================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KARTS } from './config.js';

export class AssetManager {
  constructor() {
    this.loader = new GLTFLoader();
    this.karts = new Map();
    this.props = new Map();
    this.loaded = false;
  }

  // 載入所有 3D 模型
  async loadAll(onProgress = null) {
    const propFiles = [
      'treeLarge',
      'treeSmall',
      'grandStand',
      'grandStandCovered',
      'overheadLights',
      'barrierRed',
      'barrierWhite',
      'flagCheckers',
      'flagRed',
      'flagGreen',
      'tent',
      'lightPostModern',
      'billboard',
      'pylon',
      'cone',
    ];

    const tasks = [];

    // 4 款卡丁車
    for (let slot = 0; slot < KARTS.length; slot++) {
      const file = KARTS[slot].file;
      tasks.push({
        type: 'kart',
        key: slot,
        url: `models/karts/${file}`,
      });
    }

    // 場景裝飾
    for (const name of propFiles) {
      tasks.push({
        type: 'prop',
        key: name,
        url: `models/props/${name}.glb`,
      });
    }

    const total = tasks.length;
    let completed = 0;

    // 8 秒逾時保護
    let timedOut = false;
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        timedOut = true;
        resolve();
      }, 8000);
    });

    const loadSingleTask = async (task) => {
      if (timedOut) return;
      try {
        const gltf = await this._loadGLTF(task.url);
        // 設定陰影投射與接收
        gltf.scene.traverse((node) => {
          if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;
          }
        });

        if (task.type === 'kart') {
          this.karts.set(task.key, gltf.scene);
        } else {
          this.props.set(task.key, gltf.scene);
        }
      } catch (err) {
        console.warn(`載入模型失敗：${task.url}，將使用簡易替代模型。`, err);
      } finally {
        completed++;
        if (onProgress) {
          onProgress(completed / total);
        }
      }
    };

    const allLoads = Promise.all(tasks.map(loadSingleTask));
    await Promise.race([allLoads, timeoutPromise]);

    this.loaded = true;
    if (onProgress) onProgress(1.0);
  }

  _loadGLTF(url) {
    return new Promise((resolve, reject) => {
      this.loader.load(url, resolve, undefined, reject);
    });
  }

  // 取得卡丁車模型副本（若載入失敗則回傳 null 由 Car 建立方塊替代）
  getKart(slot) {
    const template = this.karts.get(slot);
    if (!template) return null;
    return template.clone(true);
  }

  // 取得裝飾物件模型副本（原點平移至模型「底部中心」）
  getProp(name) {
    const template = this.props.get(name);
    if (!template) return null;
    const clone = template.clone(true);

    // 用 Box3 計算包圍盒，把模型包在一個 Group 裡並平移，讓 Group 原點在模型「底部中心」
    const box = new THREE.Box3().setFromObject(clone);
    const center = new THREE.Vector3();
    box.getCenter(center);

    clone.position.x -= center.x;
    clone.position.y -= box.min.y;
    clone.position.z -= center.z;

    const wrapper = new THREE.Group();
    wrapper.add(clone);
    return wrapper;
  }
}
