import Phaser from 'phaser';
import employees from '../data/employees.json';
import bots from '../data/bots.json';

// Hotspots are aligned to the EMB office floor plan artwork (1440 × 1080).
const HOTSPOTS = [
  { id: 'executive-office', x: 22, y: 24, w: 405, h: 306, label: 'OFFICE OF THE REGIONAL DIRECTOR' },
  { id: 'gis-development', x: 438, y: 24, w: 390, h: 306, label: 'GIS / DEVELOPMENT / IT' },
  { id: 'mis-planning', x: 838, y: 24, w: 320, h: 306, label: 'MIS / PLANNING / PISMU' },
  { id: 'hazardous-waste-records', x: 1168, y: 24, w: 250, h: 306, label: 'HAZARDOUS WASTE RECORDS' },
  { id: 'ecc-cnc-records', x: 22, y: 346, w: 410, h: 242, label: 'ECC & CNC DATA OFFICE' },
  { id: 'central-lobby', x: 438, y: 346, w: 394, h: 242, label: 'CENTRAL LOBBY / RECEPTION' },
  { id: 'air-water-permits', x: 838, y: 346, w: 320, h: 242, label: 'AIR & WATER PERMITTING' },
  { id: 'server-security', x: 1168, y: 346, w: 250, h: 242, label: 'SERVER & DATABASE SECURITY' },
  { id: 'aqms-monitoring', x: 22, y: 604, w: 420, h: 332, label: 'AQMS DATA & MONITORING' },
  { id: 'swm-records', x: 450, y: 604, w: 412, h: 332, label: 'SWM DATA & ENCODING' },
  { id: 'staff-lounge', x: 870, y: 604, w: 548, h: 332, label: 'REGIONAL STAFF LOUNGE' }
];

const botMap = new Map(bots.map((bot) => [bot.id, bot]));

export class OfficeScene extends Phaser.Scene {
  constructor() {
    super('OfficeScene');
    this.workers = [];
    this.nightOverlay = null;
  }

  preload() {
    this.load.image('office-map', './assets/office-map-emb.png');
  }

  create() {
    this.add.image(720, 540, 'office-map').setDisplaySize(1440, 1080).setDepth(0);
    this.createWorkerTextures();
    this.createHotspots();
    this.createWorkers();
    this.createAmbience();

    const hint = this.add.text(720, 1060, 'CLICK A WALKING WORKER TO CHAT · CLICK A ROOM FOR DETAILS', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#f2fbff',
      backgroundColor: '#102b3ee8',
      padding: { x: 12, y: 7 },
      letterSpacing: 1.2
    }).setOrigin(0.5, 1).setDepth(9).setAlpha(0.9);
    this.tweens.add({ targets: hint, alpha: 0.55, duration: 1500, yoyo: true, repeat: -1 });

    this.nightOverlay = this.add.rectangle(720, 540, 1440, 1080, 0x061826, 0).setDepth(8);
    window.addEventListener('envis:pixel-night', this.toggleNight);
    this.events.once('shutdown', () => window.removeEventListener('envis:pixel-night', this.toggleNight));
  }

  toggleNight = (event) => {
    const on = Boolean(event?.detail);
    if (this.nightOverlay) {
      this.tweens.add({ targets: this.nightOverlay, fillAlpha: on ? 0.34 : 0, duration: 600 });
    }
  };

  createWorkerTextures() {
    for (const employee of employees) {
      const bot = botMap.get(employee.id);
      const color = parseInt((bot?.color ?? '#34d399').replace('#', ''), 16);
      for (let frame = 0; frame < 2; frame += 1) {
        const graphics = this.make.graphics({ x: 0, y: 0, add: false });
        graphics.fillStyle(0x071820, 1);
        graphics.fillRect(2, 1, 12, 21);
        graphics.fillStyle(color, 1);
        graphics.fillRect(3, 3, 10, 12);
        graphics.fillStyle(0xf1c9a5, 1);
        graphics.fillRect(5, 3, 6, 6);
        graphics.fillStyle(0x071820, 1);
        graphics.fillRect(6, 5, 1, 1);
        graphics.fillRect(9, 5, 1, 1);
        graphics.fillStyle(0x0b3d3a, 1);
        if (frame === 0) {
          graphics.fillRect(5, 15, 2, 6);
          graphics.fillRect(9, 15, 2, 6);
        } else {
          graphics.fillRect(4, 15, 2, 6);
          graphics.fillRect(10, 15, 2, 6);
        }
        graphics.generateTexture(`worker-${employee.id}-${frame}`, 16, 22);
        graphics.destroy();
      }
      this.anims.create({
        key: `walk-${employee.id}`,
        frames: [
          { key: `worker-${employee.id}-0` },
          { key: `worker-${employee.id}-1` },
        ],
        frameRate: 6 + Math.floor(Math.random() * 3),
        repeat: -1,
      });
    }
  }

  createHotspots() {
    HOTSPOTS.forEach((spot, index) => {
      const hit = this.add.rectangle(
        spot.x + spot.w / 2,
        spot.y + spot.h / 2,
        spot.w,
        spot.h,
        0x0b9b92,
        0.001
      )
        .setDepth(2)
        .setInteractive({ useHandCursor: true });

      const label = this.add.text(spot.x + spot.w / 2, spot.y + 8, spot.label, {
        fontFamily: 'monospace',
        fontSize: spot.w < 280 ? '10px' : '12px',
        color: '#f2fbff',
        backgroundColor: '#102b3ee8',
        padding: { x: 8, y: 6 },
        fontStyle: 'bold',
        align: 'center',
        letterSpacing: 0.8,
        wordWrap: { width: Math.max(spot.w - 24, 120) }
      }).setOrigin(0.5, 0).setDepth(3).setAlpha(0.94);

      const marker = this.add.text(spot.x + 13, spot.y + 12, String(index + 1).padStart(2, '0'), {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#d7fffa',
        backgroundColor: '#087c73',
        padding: { x: 5, y: 4 },
        fontStyle: 'bold'
      }).setOrigin(0, 0).setDepth(4);

      hit.on('pointerover', () => {
        hit.setFillStyle(0x16b8a6, 0.15);
        label.setAlpha(1);
        marker.setScale(1.08);
      });
      hit.on('pointerout', () => {
        hit.setFillStyle(0x16b8a6, 0.001);
        label.setAlpha(0.94);
        marker.setScale(1);
      });
      hit.on('pointerdown', () => {
        window.dispatchEvent(new CustomEvent('envis:room-selected', { detail: spot.id }));
      });
    });
  }

  createWorkers() {
    employees.forEach((employee, index) => {
      const bot = botMap.get(employee.id);
      const spot = HOTSPOTS.find((item) => item.id === employee.room) ?? HOTSPOTS[5];
      const startX = spot.x + 40 + ((index * 71) % Math.max(80, spot.w - 80));
      const startY = spot.y + 90 + ((index * 53) % Math.max(80, spot.h - 120));

      const sprite = this.add.sprite(0, 0, `worker-${employee.id}-0`).setScale(2).setDepth(6);
      sprite.play(`walk-${employee.id}`);
      const nameTag = this.add.text(0, -30, bot?.short ?? employee.name.split(' ')[0], {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#eafff9',
        backgroundColor: '#071820dd',
        padding: { x: 4, y: 2 }
      }).setOrigin(0.5, 1).setDepth(7);

      const worker = this.add.container(startX, startY, [sprite, nameTag]).setDepth(6);
      worker.setData('lastX', startX);
      worker.setData('employee', employee);
      sprite.setInteractive({ useHandCursor: true });
      sprite.on('pointerover', () => nameTag.setColor('#ffffff').setScale(1.08));
      sprite.on('pointerout', () => nameTag.setColor('#eafff9').setScale(1));
      sprite.on('pointerdown', () => {
        this.showBubble(worker, bot?.greeting ?? 'Hello!');
        window.dispatchEvent(new CustomEvent('envis:bot-open', { detail: employee.id }));
      });

      this.workers.push(worker);
      this.wander(worker, spot, index);
    });
  }

  wander(worker, spot, seed) {
    const marginX = Math.min(60, spot.w / 4);
    const marginY = Math.min(70, spot.h / 4);
    const targetX = spot.x + marginX + Math.random() * Math.max(20, spot.w - marginX * 2);
    const targetY = spot.y + marginY + 50 + Math.random() * Math.max(20, spot.h - marginY * 2 - 60);
    const duration = 2800 + Math.random() * 4200 + seed * 40;

    this.tweens.add({
      targets: worker,
      x: targetX,
      y: targetY,
      delay: seed * 120,
      duration,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        const last = worker.getData('lastX') ?? worker.x;
        if (Math.abs(worker.x - last) > 0.6) {
          const sprite = worker.list[0];
          if (sprite) sprite.setFlipX(worker.x < last);
          worker.setData('lastX', worker.x);
        }
      },
      onComplete: () => this.wander(worker, spot, seed),
    });
  }

  showBubble(worker, text) {
    const bubble = this.add.text(0, -58, text, {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#eafff9',
      backgroundColor: '#0b3d3aef',
      padding: { x: 8, y: 6 },
      wordWrap: { width: 236 }
    }).setOrigin(0.5, 1).setDepth(12).setAlpha(0);
    worker.add(bubble);
    this.tweens.add({ targets: bubble, alpha: 1, duration: 180 });
    this.time.delayedCall(3600, () => {
      this.tweens.add({ targets: bubble, alpha: 0, duration: 400, onComplete: () => bubble.destroy() });
    });
  }

  createAmbience() {
    // Small "data packets" drift through the lobby and staff lounge.
    for (let i = 0; i < 8; i += 1) {
      const dot = this.add.rectangle(470 + i * 54, 470, 5, 5, 0x6ff2d0, 0.7).setDepth(5);
      this.tweens.add({
        targets: dot,
        y: 470 + (i % 2 ? 70 : -50),
        x: dot.x + (i % 2 ? 110 : -80),
        duration: 2200 + i * 260,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }
}
