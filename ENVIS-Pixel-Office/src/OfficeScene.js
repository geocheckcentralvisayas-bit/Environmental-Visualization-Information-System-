import Phaser from 'phaser';
import employees from '../data/employees.json';
import bots from '../data/bots.json';
import characterFiles from '../data/characters.json';

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
const TALK_LINES = [
  'Any updates on the data?',
  'The dashboard looks good today.',
  'Let me check that register.',
  'I will encode it shortly.',
  'Can you review this with me?',
  'Meeting at the lobby in a bit.'
];

export class OfficeScene extends Phaser.Scene {
  constructor() {
    super('OfficeScene');
    this.workers = [];
    this.nightOverlay = null;
    this.stepTimer = 0;
  }

  preload() {
    this.load.image('office-map', './assets/office-map-emb.png');
    for (const [id, file] of Object.entries(characterFiles)) {
      if (file) this.load.image(`char-${id}`, `./characters/${encodeURIComponent(file)}`);
    }
  }

  create() {
    this.add.image(720, 540, 'office-map').setDisplaySize(1440, 1080).setDepth(0);
    this.createFallbackTexture();
    this.createHotspots();
    this.createWorkers();
    this.createAmbience();

    const hint = this.add.text(720, 1060, 'WORKERS WALK, WORK AND TALK · CLICK ONE TO OPEN ITS BOT CHAT', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#f2fbff',
      backgroundColor: '#102b3ee8',
      padding: { x: 12, y: 7 },
      letterSpacing: 1.1
    }).setOrigin(0.5, 1).setDepth(20).setAlpha(0.9);
    this.tweens.add({ targets: hint, alpha: 0.55, duration: 1500, yoyo: true, repeat: -1 });

    this.nightOverlay = this.add.rectangle(720, 540, 1440, 1080, 0x061826, 0).setDepth(18);
    window.addEventListener('envis:pixel-night', this.toggleNight);
    this.events.once('shutdown', () => window.removeEventListener('envis:pixel-night', this.toggleNight));
  }

  toggleNight = (event) => {
    const on = Boolean(event?.detail);
    if (this.nightOverlay) {
      this.tweens.add({ targets: this.nightOverlay, fillAlpha: on ? 0.34 : 0, duration: 600 });
    }
  };

  createFallbackTexture() {
    // Christine has no supplied portrait; generate a matching pixel stand-in.
    const graphics = this.make.graphics({ x: 0, y: 0, add: false });
    graphics.fillStyle(0x071820, 1);
    graphics.fillRect(2, 1, 12, 21);
    graphics.fillStyle(0xf472b6, 1);
    graphics.fillRect(3, 3, 10, 12);
    graphics.fillStyle(0xf1c9a5, 1);
    graphics.fillRect(5, 3, 6, 6);
    graphics.fillStyle(0x071820, 1);
    graphics.fillRect(6, 5, 1, 1);
    graphics.fillRect(9, 5, 1, 1);
    graphics.fillRect(5, 15, 2, 6);
    graphics.fillRect(9, 15, 2, 6);
    graphics.generateTexture('char-fallback', 16, 22);
    graphics.destroy();
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
      ).setDepth(2).setInteractive({ useHandCursor: true });

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
      const hasPortrait = Boolean(characterFiles[employee.id]);
      const textureKey = hasPortrait ? `char-${employee.id}` : 'char-fallback';
      const startX = spot.x + 50 + ((index * 73) % Math.max(60, spot.w - 100));
      const startY = spot.y + 120 + ((index * 47) % Math.max(40, spot.h - 170));

      const shadow = this.add.ellipse(0, 2, hasPortrait ? 42 : 30, 11, 0x031417, 0.42).setDepth(5);
      const sprite = this.add.sprite(0, 0, textureKey).setDepth(7);
      if (hasPortrait) sprite.setDisplaySize(78, 78);
      else sprite.setScale(3.8);
      sprite.setOrigin(0.5, 1);
      sprite.y = 0;

      const nameTag = this.add.text(0, -88, bot?.short ?? employee.name.split(' ')[0], {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#eafff9',
        backgroundColor: '#071820dd',
        padding: { x: 4, y: 2 }
      }).setOrigin(0.5, 1).setDepth(9);

      const status = this.add.text(0, -108, '', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#9ff5d8',
        backgroundColor: '#0b3d3ae0',
        padding: { x: 4, y: 2 }
      }).setOrigin(0.5, 1).setDepth(9);

      const worker = this.add.container(startX, startY, [shadow, sprite, nameTag, status]).setDepth(6);
      worker.workerData = {
        employee,
        bot,
        spot,
        sprite,
        shadow,
        status,
        nameTag,
        state: 'working',
        moveTween: null,
        bobTween: null,
        lastX: startX,
        hasPortrait,
      };

      sprite.setInteractive({ useHandCursor: true });
      sprite.on('pointerover', () => nameTag.setColor('#ffffff').setScale(1.08));
      sprite.on('pointerout', () => nameTag.setColor('#eafff9').setScale(1));
      sprite.on('pointerdown', () => {
        this.showBubble(worker, bot?.greeting ?? 'Hello!');
        window.dispatchEvent(new CustomEvent('envis:bot-open', { detail: employee.id }));
      });

      this.workers.push(worker);
      this.setState(worker, 'working', 2200 + index * 380);
    });
  }

  setState(worker, state, duration = 3000) {
    const data = worker.workerData;
    if (data.moveTween) { data.moveTween.stop(); data.moveTween = null; }
    if (data.bobTween) { data.bobTween.stop(); data.bobTween = null; }
    data.sprite.y = 0;
    data.status.setText('');
    data.state = state;
    data.shadow.setScale(1, 1);

    if (state === 'working') {
      data.status.setText('▮▮▮').setColor('#8fe3c6');
      data.bobTween = this.tweens.add({
        targets: data.sprite,
        y: -2,
        duration: 170,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      this.time.delayedCall(duration, () => {
        if (worker.active && data.state === 'working') this.setState(worker, 'walking');
      });
      return;
    }

    if (state === 'talking') {
      data.status.setText('•••').setColor('#fbbf24');
      const line = TALK_LINES[Phaser.Math.Between(0, TALK_LINES.length - 1)];
      this.showBubble(worker, line);
      data.bobTween = this.tweens.add({
        targets: data.sprite,
        y: -4,
        angle: -2,
        duration: 240,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      this.time.delayedCall(duration, () => {
        if (worker.active && data.state === 'talking') this.setState(worker, 'walking');
      });
      return;
    }

    // Walking: move to a point inside the assigned room with a real bob/step.
    const spot = data.spot;
    const targetX = spot.x + 38 + Math.random() * Math.max(20, spot.w - 76);
    const targetY = spot.y + 118 + Math.random() * Math.max(20, spot.h - 176);
    const travel = Phaser.Math.Distance.Between(worker.x, worker.y, targetX, targetY);
    const speed = 58 + Math.random() * 28;
    const travelMs = Math.max(1100, (travel / speed) * 1000);
    data.status.setText('→').setColor('#a7f3d0');
    data.bobTween = this.tweens.add({
      targets: data.sprite,
      y: -8,
      duration: 140,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.stepTimer = 0;

    data.moveTween = this.tweens.add({
      targets: worker,
      x: targetX,
      y: targetY,
      duration: travelMs,
      ease: 'Linear',
      onUpdate: () => {
        const delta = worker.x - data.lastX;
        if (Math.abs(delta) > 0.4) {
          data.sprite.setFlipX(delta < 0);
          data.lastX = worker.x;
        }
        data.shadow.setScale(1 - Math.abs(data.sprite.y) / 40, 1 - Math.abs(data.sprite.y) / 60);
        this.stepTimer += 16;
        if (this.stepTimer > 260) {
          this.stepTimer = 0;
          this.footstep(worker.x, worker.y + 2);
        }
      },
      onComplete: () => {
        if (!worker.active) return;
        const roll = Math.random();
        if (roll < 0.34) this.setState(worker, 'talking', 2600 + Math.random() * 2600);
        else this.setState(worker, 'working', 2800 + Math.random() * 4200);
      },
    });
  }

  footstep(x, y) {
    const dust = this.add.circle(x, y, 2, 0xb8f0d8, 0.45).setDepth(6);
    this.tweens.add({
      targets: dust,
      y: y - 9,
      alpha: 0,
      duration: 420,
      ease: 'Sine.easeOut',
      onComplete: () => dust.destroy(),
    });
  }

  showBubble(worker, text) {
    const bubble = this.add.text(0, -128, text, {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#eafff9',
      backgroundColor: '#0b3d3aef',
      padding: { x: 7, y: 5 },
      wordWrap: { width: 252 }
    }).setOrigin(0.5, 1).setDepth(15).setAlpha(0);
    worker.add(bubble);
    this.tweens.add({ targets: bubble, alpha: 1, duration: 160 });
    this.time.delayedCall(3200, () => {
      if (bubble.active) {
        this.tweens.add({ targets: bubble, alpha: 0, duration: 360, onComplete: () => bubble.destroy() });
      }
    });
  }

  createAmbience() {
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
