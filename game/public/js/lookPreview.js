// ============================================================
//  lookPreview.js — 手機造型選擇面板的 3D 旋轉預覽
//  只載入 4 款卡丁車模型（不載入賽道素材），用 kartLook.js 組出「車款＋車手＋烤漆」，
//  在小畫布上慢慢旋轉展示。面板收起時停止算繪以節省手機電力。
//  WebGL 不支援或載入失敗時，預覽區會顯示文字提示，不影響選擇功能。
// ============================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KARTS } from './config.js';
import { buildKartLook } from './kartLook.js';

export class LookPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.templates = new Map();
    this.current = null;      // { model, materials }
    this.look = null;         // { kart, driver, color }
    this.running = false;
    this.angle = 0;

    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    } catch (e) {
      this.renderer = null;
      canvas.parentElement?.classList.add('no-webgl');
      return;
    }

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    this.camera.position.set(0, 1.7, 4.4);
    this.camera.lookAt(0, 0.75, 0);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(2, 4, 3);
    this.scene.add(sun);

    // 展示轉盤
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.15, 0.08, 40),
      new THREE.MeshStandardMaterial({ color: 0x2f3542, roughness: 0.6 })
    );
    disc.position.y = -0.04;
    this.scene.add(disc);

    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);

    this._loadKarts();
  }

  // 載入 4 款卡丁車（與大螢幕相同的 GLB 檔）
  async _loadKarts() {
    const loader = new GLTFLoader();
    await Promise.all(KARTS.map((k, i) => new Promise((resolve) => {
      loader.load(`models/karts/${k.file}`, (gltf) => {
        this.templates.set(i, gltf.scene);
        resolve();
      }, undefined, () => resolve());
    })));
    if (this.look) this.setLook(this.look, true);
  }

  // 更新預覽造型（同樣的造型不重建）
  setLook({ kart, driver, color }, force = false) {
    const same = this.look && this.look.kart === kart && this.look.driver === driver && this.look.color === color;
    this.look = { kart, driver, color };
    if (!this.renderer || (same && !force)) return;
    const template = this.templates.get(kart);
    if (!template) return;

    if (this.current) {
      this.pivot.remove(this.current.model);
      this.current.materials.forEach((m) => m.dispose());
      this.current.model.getObjectByName('driver')?.traverse((n) => n.geometry?.dispose?.());
    }
    const look = buildKartLook(template.clone(true), { driver, color });
    look.model.scale.setScalar(1.25);
    this.pivot.add(look.model);
    this.current = look;
  }

  start() {
    if (!this.renderer || this.running) return;
    this.running = true;
    let last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.angle += dt * 0.9;
      this.pivot.rotation.y = this.angle;
      this._resize();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
  }

  _resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width !== Math.floor(w * this.renderer.getPixelRatio()) || this.canvas.height !== Math.floor(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }
}
