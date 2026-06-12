class MainScene extends Phaser.Scene {

    preload() {
        this.load.image('vilaBg', './assets/maps/vila-elfica/vila-élfica-bg.png');
        this.load.audio('vilaMusic', './assets/maps/vila-elfica/vila-elfica-music.mp3');
        this.load.image('defaultTile', './assets/tiles/default-tile.png');
        this.textures.generate('ant', { data: ['..###..', '..###..', '..###..'], pixelWidth: 6 });
        this.load.image('bullet', './assets/bullet.png');
    }

    create() {
        const mapTex = this.textures.get('vilaBg').getSourceImage();
        this.worldWidth = mapTex.width;
        this.worldHeight = mapTex.height;

        this.physics.world.setBounds(0, 0, this.worldWidth, this.worldHeight, true, true, true, false);

        const bg = this.add.image(this.worldWidth / 2, this.worldHeight / 2, 'vilaBg');
        bg.setDepth(-100);

        this.bgMusic = this.sound.add('vilaMusic', { loop: true, volume: 0.6 });
        this.bgMusic.play();
        if (this.sound.locked) {
            this.sound.once('unlocked', () => {
                if (!this.bgMusic.isPlaying) this.bgMusic.play();
            });
        }

        this.cameras.main.setBounds(0, 0, this.worldWidth, this.worldHeight);
        this.cameras.main.setBackgroundColor('#1a2a1a');

        this.createPlatforms();

        // jogador nasce sobre a plataforma principal
        const spawnX = this.worldWidth / 2;
        const spawnY = this.mainPlatformY - this.mainPlatformHeight / 2 - 20;
        this.player = this.physics.add.sprite(spawnX, spawnY, 'ant').setScale(2);
        this.player.setCollideWorldBounds(true);
        this.physics.add.collider(this.player, this.platforms);
        this.cameraFollowsBullet = false;
        this.focusPlayerCamera();
        this.player.speed = 65;
        this.player.health = 100;

        // 1 = virado para direita (azul), -1 = virado para esquerda (vermelho)
        this.facing = 1;
        this.applyPlayerFacing();

        // janela de 10 s: 1 tiro enquanto o timer não zerar; ao atirar ou zerar, reinicia
        this.shootCooldownMs = 10000;
        this.shootRestartDelayMs = 3000;
        this.shootTimerRemaining = this.shootCooldownMs;
        this.shootRestartDelayRemaining = 0;
        this.hasShotThisInterval = false;
        this.playerBullet = null;
        this.pendingRoundRestart = false;
        this.frozenShootTimerSeconds = 0;

        // balas
        this.bullets = this.physics.add.group({ classType: Phaser.Physics.Arcade.Image, runChildUpdate: true });
        this.physics.add.collider(this.bullets, this.platforms, (bullet) => {
            this.destroyPlayerBullet(bullet);
        });

        // inimigos
        this.enemies = this.physics.add.group();
        for (let i = 0; i < 1; i++) {
            const x = (this.worldWidth / 7) * (i + 1);
            const e = this.enemies.create(x, 80 + (i % 2) * 120, 'ant').setScale(1.6);
            e.setTint(0xff6666);
            e.health = 30;
            e.speed = 40 + Math.random() * 60;
            e.dir = Math.random() > 0.5 ? 1 : -1;
            e.setCollideWorldBounds(true);
            e.setVelocityX(0);
        }
        this.physics.add.collider(this.enemies, this.platforms);

        // controles
        this.cursors = this.input.keyboard.createCursorKeys();
        this.keys = this.input.keyboard.addKeys('A,D,W,S');

        // ângulo da arma (bloco preto) — setas/W/S cima/baixo
        this.weaponBaseElevationDeg = 15;
        this.weaponElevationSpanDeg = 50;
        this.weaponAngleSpeedDeg = 13;
        this.weaponAngle = this.elevationDegToWeaponAngle(this.getWeaponBaseElevationDeg());
        this.weapon = this.add.rectangle(this.player.x, this.player.y, 24, 8, 0x000000);
        this.weapon.setOrigin(0, 0.5).setDepth(1);

        // carregamento e disparo do tiro (tecla Espaço)
        this.maxChargeMs = 5000;
        this.chargeStart = 0;
        this.isCharging = false;
        this.lastRoundForcePercent = 0;
        this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
        this.input.keyboard.on('keydown-SPACE', () => this.beginCharge());
        this.input.keyboard.on('keyup-SPACE', () => this.endCharge());
        this.input.mouse.disableContextMenu();

        // HUD (distância da borda inferior da tela)
        this.hudBottomPad = 45;
        this.hpText = this.add.text(10, 10, 'HP: ' + this.player.health, { font: '16px Arial', fill: '#fff' }).setScrollFactor(0);
        this.createMinimapHud();
        this.createShootTimerHud();
        this.createForceHud();
        this.createControlHud();
        this.createAngleHud();
    }

    createPlatforms() {
        const tileTex = this.textures.get('defaultTile').getSourceImage();
        const tileW = tileTex.width * 0.15;
        const tileH = tileTex.height * 0.15;

        this.platformTileW = tileW;
        this.mainPlatformTiles = Math.ceil(this.worldWidth / tileW);
        this.mainPlatformWidth = this.worldWidth;
        this.mainPlatformHeight = tileH;
        this.mainPlatformY = this.worldHeight - tileH / 2;

        this.platforms = this.physics.add.staticGroup();

        const startX = tileW / 2;
        for (let i = 0; i < this.mainPlatformTiles; i++) {
            const tile = this.platforms.create(startX + i * tileW, this.mainPlatformY, 'defaultTile')
                .setScale(0.15);
            tile.refreshBody();
        }
    }

    beginCharge() {
        if (this.isCharging || !this.canShootNow()) return;
        this.frozenShootTimerSeconds = Math.max(1, Math.ceil(this.shootTimerRemaining / 1000));
        this.chargeStart = this.time.now;
        this.isCharging = true;
        if (this.shootHudBtn) this.shootHudBtn.setFillStyle(0xff6666, 0.55);
    }

    endCharge() {
        if (!this.isCharging) return;
        const chargeTime = this.time.now - this.chargeStart;
        this.isCharging = false;
        if (this.shootHudBtn) this.shootHudBtn.setFillStyle(0xcc3333, 0.4);
        this.shoot(chargeTime);
    }

    createControlHud() {
        const depth = 25;
        const pad = 24;
        const btnRadius = Math.round(34 * 0.85);
        const gap = Math.round(76 * 0.85);
        const shootRadius = Math.round(48 * 0.85);
        const dpadExtent = gap + btnRadius;

        const dpadX = pad + dpadExtent;
        const bottomPad = this.hudBottomPad;
        const dpadY = this.scale.height - bottomPad - gap - btnRadius;
        this.controlHudRight = dpadX + dpadExtent;
        this.controlHudTop = dpadY - gap - btnRadius;
        this.controlHudBottom = dpadY + gap + btnRadius;

        this.touchControls = { up: false, right: false, down: false, left: false };

        const dpad = [
            { key: 'up', x: 0, y: -gap, label: '▲' },
            { key: 'right', x: gap, y: 0, label: '▶' },
            { key: 'down', x: 0, y: gap, label: '▼' },
            { key: 'left', x: -gap, y: 0, label: '◀' }
        ];

        dpad.forEach(({ key, x, y, label }) => {
            const bx = dpadX + x;
            const by = dpadY + y;
            const btn = this.add.circle(bx, by, btnRadius, 0xffffff, 0.18)
                .setStrokeStyle(2, 0xffffff, 0.45)
                .setScrollFactor(0)
                .setDepth(depth)
                .setInteractive({ useHandCursor: true });

            this.add.text(bx, by, label, {
                font: Math.round(22 * 0.85) + 'px Arial',
                fill: '#ffffff'
            }).setOrigin(0.5).setScrollFactor(0).setDepth(depth + 1);

            const press = () => {
                this.touchControls[key] = true;
                btn.setFillStyle(0xffffff, 0.42);
            };
            const release = () => {
                this.touchControls[key] = false;
                btn.setFillStyle(0xffffff, 0.18);
            };

            btn.on('pointerdown', press);
            btn.on('pointerup', release);
            btn.on('pointerout', release);
        });

        const shootX = this.scale.width - pad - shootRadius;
        const shootY = this.scale.height - bottomPad - shootRadius;
        this.controlHudShootX = shootX;
        this.controlHudShootY = shootY;
        this.controlHudShootRadius = shootRadius;

        this.shootHudBtn = this.add.circle(shootX, shootY, shootRadius, 0xcc3333, 0.4)
            .setStrokeStyle(3, 0xffffff, 0.5)
            .setScrollFactor(0)
            .setDepth(depth)
            .setInteractive({ useHandCursor: true });

        this.add.image(shootX, shootY, 'bullet')
            .setScale(1.4 * 0.85)
            .setScrollFactor(0)
            .setDepth(depth + 1);

        this.shootHudBtn.on('pointerdown', () => this.beginCharge());
        this.shootHudBtn.on('pointerup', () => this.endCharge());
        this.shootHudBtn.on('pointerout', () => {
            if (this.isCharging) this.endCharge();
        });
    }

    isDirectionHeld(dir) {
        if (this.touchControls[dir]) return true;
        if (dir === 'left') return this.cursors.left.isDown || this.keys.A.isDown;
        if (dir === 'right') return this.cursors.right.isDown || this.keys.D.isDown;
        if (dir === 'up') return this.cursors.up.isDown || this.keys.W.isDown;
        if (dir === 'down') return this.cursors.down.isDown || this.keys.S.isDown;
        return false;
    }

    createAngleHud() {
        const depth = 26;
        const gapAfterControls = 30;
        const labelPad = 38;
        const controlRight = this.controlHudRight ?? 160;
        const zoneTop = this.controlHudTop ?? 0;
        const zoneBottom = this.forceHudTop ?? (this.scale.height - 80);
        const zoneHeight = Math.max(80, zoneBottom - zoneTop);
        const baseRadius = Phaser.Math.Clamp((zoneHeight - labelPad * 2) / 2, 32, 56);
        const radius = Math.round(baseRadius * 1.56);
        const centerX = controlRight + gapAfterControls + radius;
        const centerY = this.scale.height - this.hudBottomPad - radius;

        this.angleHudCenterX = centerX;
        this.angleHudCenterY = centerY;
        this.angleHudRadius = radius;

        this.angleHudGraphics = this.add.graphics().setScrollFactor(0).setDepth(depth);
        this.angleHudText = this.add.text(
            centerX,
            centerY + radius + 14,
            '',
            {
                font: '18px Arial',
                fill: '#ffffff',
                backgroundColor: '#000000aa',
                padding: { x: 10, y: 5 }
            }
        ).setOrigin(0.5, 0).setScrollFactor(0).setDepth(depth + 1);
        this.updateAngleHud();
    }

    createMinimapHud() {
        const margin = 12;
        this.minimapWidth = 240;
        this.minimapHeight = 140;
        this.minimapX = this.scale.width - this.minimapWidth - margin;
        this.minimapY = margin;
        this.minimapPointSize = 5;
        this.isMinimapDragging = false;
        this.minimapViewportWidth = 0;
        this.minimapViewportHeight = 0;
        this.minimapLastPointerX = 0;
        this.minimapLastPointerY = 0;

        this.minimapBackground = this.add.rectangle(
            this.minimapX + this.minimapWidth / 2,
            this.minimapY + this.minimapHeight / 2,
            this.minimapWidth,
            this.minimapHeight,
            0x000000,
            0.45
        ).setOrigin(0.5).setScrollFactor(0).setDepth(18)
            .setStrokeStyle(2, 0xffffff, 0.55);

        this.minimapGraphics = this.add.graphics().setScrollFactor(0).setDepth(19);
        this.minimapViewportHandle = this.add.rectangle(
            this.minimapX,
            this.minimapY,
            10,
            10
        )
            .setOrigin(0)
            .setScrollFactor(0)
            .setDepth(20)
            .setStrokeStyle(2, 0x88ccff, 0.95)
            .setFillStyle(0x88ccff, 0.1)
            .setInteractive({ useHandCursor: true });

        this.minimapViewportHandle.on('pointerdown', (pointer) => this.startMinimapDrag(pointer));
        this.input.on('pointermove', (pointer) => this.updateMinimapDrag(pointer));
        this.input.on('pointerup', () => this.stopMinimapDrag());

        this.updateMinimapHud();
    }

    mapToMinimapX(worldX) {
        return this.minimapX + (worldX / this.worldWidth) * this.minimapWidth;
    }

    mapToMinimapY(worldY) {
        return this.minimapY + (worldY / this.worldHeight) * this.minimapHeight;
    }

    moveCameraFromMinimapDrag(rawX, rawY) {
        const cam = this.cameras.main;
        const maxScrollX = Math.max(0, this.worldWidth - cam.width);
        const maxScrollY = Math.max(0, this.worldHeight - cam.height);
        const viewW = this.minimapViewportWidth;
        const viewH = this.minimapViewportHeight;
        const maxViewX = this.minimapX + this.minimapWidth - viewW;
        const maxViewY = this.minimapY + this.minimapHeight - viewH;
        const viewX = Phaser.Math.Clamp(rawX, this.minimapX, maxViewX);
        const viewY = Phaser.Math.Clamp(rawY, this.minimapY, maxViewY);
        const rangeX = this.minimapWidth - viewW;
        const rangeY = this.minimapHeight - viewH;
        const tx = rangeX > 0 ? (viewX - this.minimapX) / rangeX : 0;
        const ty = rangeY > 0 ? (viewY - this.minimapY) / rangeY : 0;

        cam.scrollX = tx * maxScrollX;
        cam.scrollY = ty * maxScrollY;

        return { viewX, viewY };
    }

    startMinimapDrag(pointer) {
        this.isMinimapDragging = true;
        this.cameraFollowsBullet = false;
        this.cameras.main.stopFollow();
        this.minimapLastPointerX = pointer.x;
        this.minimapLastPointerY = pointer.y;
    }

    updateMinimapDrag(pointer) {
        if (!this.isMinimapDragging) return;
        if (!pointer.isDown) {
            this.stopMinimapDrag();
            return;
        }

        const deltaX = pointer.x - this.minimapLastPointerX;
        const deltaY = pointer.y - this.minimapLastPointerY;
        this.minimapLastPointerX = pointer.x;
        this.minimapLastPointerY = pointer.y;

        const nextX = this.minimapViewportHandle.x + deltaX;
        const nextY = this.minimapViewportHandle.y + deltaY;
        const clampedPos = this.moveCameraFromMinimapDrag(nextX, nextY);
        this.minimapViewportHandle.setPosition(clampedPos.viewX, clampedPos.viewY);
    }

    stopMinimapDrag() {
        this.isMinimapDragging = false;
        if (this.playerBullet && this.playerBullet.active) {
            this.focusBulletCamera();
            return;
        }
        this.focusPlayerCamera();
    }

    updateMinimapHud() {
        if (!this.minimapGraphics) return;
        const g = this.minimapGraphics;
        g.clear();

        const cam = this.cameras.main;
        const viewW = Math.max(12, (cam.width / this.worldWidth) * this.minimapWidth);
        const viewH = Math.max(12, (cam.height / this.worldHeight) * this.minimapHeight);
        this.minimapViewportWidth = viewW;
        this.minimapViewportHeight = viewH;

        const playerX = this.mapToMinimapX(this.player.x);
        const playerY = this.mapToMinimapY(this.player.y);
        g.fillStyle(0x33dd66, 1);
        g.fillRect(
            playerX - this.minimapPointSize / 2,
            playerY - this.minimapPointSize / 2,
            this.minimapPointSize,
            this.minimapPointSize
        );

        g.fillStyle(0xff6666, 0.95);
        this.enemies.children.each((enemy) => {
            if (!enemy || !enemy.active) return;
            const ex = this.mapToMinimapX(enemy.x);
            const ey = this.mapToMinimapY(enemy.y);
            g.fillRect(ex - 2, ey - 2, 4, 4);
        });

        if (this.playerBullet && this.playerBullet.active) {
            const bx = this.mapToMinimapX(this.playerBullet.x);
            const by = this.mapToMinimapY(this.playerBullet.y);
            g.fillStyle(0xffee66, 1);
            g.fillRect(bx - 2, by - 2, 4, 4);
        }

        const maxScrollX = Math.max(0, this.worldWidth - cam.width);
        const maxScrollY = Math.max(0, this.worldHeight - cam.height);
        const rangeX = this.minimapWidth - viewW;
        const rangeY = this.minimapHeight - viewH;
        const viewX = this.minimapX + (maxScrollX > 0 ? (cam.scrollX / maxScrollX) * rangeX : 0);
        const viewY = this.minimapY + (maxScrollY > 0 ? (cam.scrollY / maxScrollY) * rangeY : 0);
        this.minimapViewportHandle.setSize(viewW, viewH);
        if (!this.isMinimapDragging) {
            this.minimapViewportHandle.setPosition(viewX, viewY);
        }
    }

    updateAngleHud() {
        if (!this.angleHudGraphics) return;
        const g = this.angleHudGraphics;
        g.clear();

        const cx = this.angleHudCenterX;
        const cy = this.angleHudCenterY;
        const radius = this.angleHudRadius;
        const innerRadius = radius - 12;
        const rotation = this.getWeaponDisplayRotation();
        const angleDeg = this.weaponRotationToHudDeg(rotation);

        g.fillStyle(0x000000, 0.45);
        g.fillCircle(cx, cy, radius + 6);
        g.lineStyle(2, 0xffffff, 0.72);
        g.beginPath();
        g.arc(cx, cy, radius, Phaser.Math.DegToRad(180), Phaser.Math.DegToRad(360), false);
        g.strokePath();
        g.lineStyle(1, 0xffffff, 0.22);
        g.beginPath();
        g.arc(cx, cy, innerRadius, Phaser.Math.DegToRad(180), Phaser.Math.DegToRad(360), false);
        g.strokePath();

        for (let hudTick = 0; hudTick <= 90; hudTick += 10) {
            const canvasDeg = hudTick <= 45 ? 180 + hudTick * 2 : 360 - (90 - hudTick) * 2;
            const rad = Phaser.Math.DegToRad(canvasDeg);
            const isMajor = hudTick % 30 === 0;
            const tickOuter = radius - 2;
            const tickInner = isMajor ? radius - 11 : radius - 7;
            const x1 = cx + Math.cos(rad) * tickInner;
            const y1 = cy + Math.sin(rad) * tickInner;
            const x2 = cx + Math.cos(rad) * tickOuter;
            const y2 = cy + Math.sin(rad) * tickOuter;
            g.lineStyle(isMajor ? 2 : 1, 0xffffff, isMajor ? 0.52 : 0.25);
            g.beginPath();
            g.moveTo(x1, y1);
            g.lineTo(x2, y2);
            g.strokePath();
        }

        const cardinal = [
            { label: '0', deg: 180 },
            { label: '90', deg: 270 },
            { label: '0', deg: 0 }
        ];
        cardinal.forEach((item) => {
            const rad = Phaser.Math.DegToRad(item.deg);
            const tx = cx + Math.cos(rad) * (innerRadius - 12);
            const ty = cy + Math.sin(rad) * (innerRadius - 12);
            g.fillStyle(0xffffff, 0.9);
            g.fillRect(tx - 1, ty - 1, 2, 2);
            g.lineStyle(1, 0x99bbff, 0.7);
            g.strokeCircle(tx, ty, 2);
            if (!this.angleHudLabels) this.angleHudLabels = [];
        });

        if (this.angleHudLabels && this.angleHudLabels.length !== cardinal.length) {
            this.angleHudLabels.forEach((label) => label.destroy());
            this.angleHudLabels = null;
        }

        if (!this.angleHudLabels || this.angleHudLabels.length === 0) {
            this.angleHudLabels = cardinal.map((item) => {
                const rad = Phaser.Math.DegToRad(item.deg);
                const tx = cx + Math.cos(rad) * (innerRadius - 24);
                const ty = cy + Math.sin(rad) * (innerRadius - 24);
                return this.add.text(tx, ty, item.label, {
                    font: '11px Arial',
                    fill: '#b7dcff'
                }).setOrigin(0.5).setScrollFactor(0).setDepth(27);
            });
        }

        const pointerLen = radius - 14;
        const px = cx + Math.cos(rotation) * pointerLen;
        const py = cy + Math.sin(rotation) * pointerLen;
        g.lineStyle(4, 0x58e06b, 0.95);
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(px, py);
        g.strokePath();

        const mirrorRotation = rotation + Math.PI;
        const mirrorLen = radius - 24;
        const mx = cx + Math.cos(mirrorRotation) * mirrorLen;
        const my = cy + Math.sin(mirrorRotation) * mirrorLen;
        g.lineStyle(2, 0x7bb8ff, 0.8);
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(mx, my);
        g.strokePath();

        g.fillStyle(0xffffff, 0.9);
        g.fillCircle(cx, cy, 4);

        if (this.angleHudText) {
            this.angleHudText.setText('Ângulo: ' + angleDeg + '°');
        }
    }

    applyPlayerFacing() {
        this.player.setFlipX(this.facing === -1);
        this.player.setTint(this.facing === -1 ? 0xff3333 : 0x3366ff);
    }

    hasMapScrollRoom() {
        const cam = this.cameras.main;
        return cam.width < this.worldWidth || cam.height < this.worldHeight;
    }

    focusPlayerCamera() {
        if (this.isMinimapDragging) return;
        this.cameraFollowsBullet = false;
        this.cameras.main.stopFollow();
        this.cameras.main.startFollow(this.player, true, 0.12, 0);
    }

    focusBulletCamera() {
        if (this.isMinimapDragging) return;
        if (!this.hasMapScrollRoom()) return;
        this.cameraFollowsBullet = true;
        this.cameras.main.stopFollow();
    }

    updateCamera(delta) {
        if (this.isMinimapDragging) return;
        if (!this.cameraFollowsBullet || !this.playerBullet) return;

        const cam = this.cameras.main;
        const bullet = this.playerBullet;
        const maxScrollX = Math.max(0, this.worldWidth - cam.width);
        const maxScrollY = Math.max(0, this.worldHeight - cam.height);
        const lerp = Phaser.Math.Clamp(delta / 80, 0.05, 0.25);

        if (maxScrollX > 0) {
            const targetX = Phaser.Math.Clamp(bullet.x - cam.width / 2, 0, maxScrollX);
            cam.scrollX = Phaser.Math.Linear(cam.scrollX, targetX, lerp);
        }
        if (maxScrollY > 0) {
            const targetY = Phaser.Math.Clamp(bullet.y - cam.height / 2, 0, maxScrollY);
            cam.scrollY = Phaser.Math.Linear(cam.scrollY, targetY, lerp);
        }
    }

    elevationDegToWeaponAngle(elevationDeg) {
        return -Phaser.Math.DegToRad(elevationDeg);
    }

    getGroundSurfaceYAt(worldX) {
        let surfaceY = null;
        this.platforms.children.each((tile) => {
            const body = tile.body;
            if (!body) return;
            if (worldX < body.left || worldX > body.right) return;
            const top = body.top;
            if (surfaceY === null || top < surfaceY) surfaceY = top;
        });
        return surfaceY;
    }

    getTerrainSlopeDeg() {
        const sample = (this.platformTileW || 40) * 0.5;
        const x = this.player.x;
        const leftY = this.getGroundSurfaceYAt(x - sample);
        const rightY = this.getGroundSurfaceYAt(x + sample);
        if (leftY === null || rightY === null) return 0;
        const rise = leftY - rightY;
        const run = sample * 2;
        if (run === 0) return 0;
        return Phaser.Math.RadToDeg(Math.atan2(rise, run));
    }

    getWeaponBaseElevationDeg() {
        return this.weaponBaseElevationDeg + this.getTerrainSlopeDeg();
    }

    updateWeaponAngleLimits() {
        const minElev = this.getWeaponBaseElevationDeg();
        const maxElev = minElev + this.weaponElevationSpanDeg;
        this.weaponMinAngle = this.elevationDegToWeaponAngle(maxElev);
        this.weaponMaxAngle = this.elevationDegToWeaponAngle(minElev);
    }

    getWeaponDisplayRotation() {
        return this.facing === -1 ? Math.PI - this.weaponAngle : this.weaponAngle;
    }

    weaponRotationToHudDeg(rotation) {
        const elevRad = Math.atan2(-Math.sin(rotation), Math.abs(Math.cos(rotation)));
        return Phaser.Math.Clamp(Math.round(Phaser.Math.RadToDeg(elevRad)), 0, 90);
    }

    createShootTimerHud() {
        this.shootTimerHud = this.add.text(
            this.scale.width / 2,
            75,
            '',
            {
                font: '18px Arial',
                fill: '#fff',
                backgroundColor: '#000000aa',
                padding: { x: 14, y: 8 }
            }
        ).setOrigin(0.5, 0).setScrollFactor(0).setDepth(10);
        this.updateShootTimerHud();
    }

    isRoundActive() {
        return this.shootRestartDelayRemaining <= 0
            && this.shootTimerRemaining > 0
            && !this.playerBullet;
    }

    destroyPlayerBullet(bullet) {
        if (this.playerBullet !== bullet) return;

        this.playerBullet = null;
        bullet.destroy();
        this.focusPlayerCamera();

        if (this.pendingRoundRestart) {
            this.pendingRoundRestart = false;
            this.startNewShootInterval();
        }
    }

    requestRoundRestart() {
        if (!this.hasShotThisInterval) {
            this.lastRoundForcePercent = 0;
        }
        if (this.playerBullet) {
            this.pendingRoundRestart = true;
            return;
        }
        this.startNewShootInterval();
    }

    shouldShowShootTimerHud() {
        return this.isRoundActive() || this.isCharging || !!this.playerBullet;
    }

    isShootTimerFrozen() {
        return this.isCharging || !!this.playerBullet;
    }

    updateShootTimerHud() {
        if (!this.shouldShowShootTimerHud()) {
            this.shootTimerHud.setVisible(false);
            return;
        }

        const seconds = this.isShootTimerFrozen()
            ? this.frozenShootTimerSeconds
            : Math.max(1, Math.ceil(this.shootTimerRemaining / 1000));
        this.shootTimerHud.setVisible(true);
        this.shootTimerHud.setText(seconds + 's');
    }

    createForceHud() {
        const barWidth = 518;
        const barHeight = 39;
        const barInset = 6;
        const centerX = this.scale.width / 2;
        const centerY = this.scale.height - this.hudBottomPad - barHeight / 2;

        this.forceHudBarWidth = barWidth - barInset;
        this.forceHudBarHeight = barHeight;
        this.forceHudCenterX = centerX;
        this.forceHudY = centerY;
        this.forceHudTop = centerY - barHeight / 2;

        this.forceHudBg = this.add.rectangle(centerX, centerY, barWidth, barHeight, 0x1a1a1a, 0.9)
            .setStrokeStyle(2, 0xffffff, 0.35)
            .setScrollFactor(0)
            .setDepth(10);

        this.forceHudFill = this.add.rectangle(
            centerX - this.forceHudBarWidth / 2,
            centerY,
            0,
            barHeight - barInset,
            0x3ecf6e
        ).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11);

        this.forceHudMarkerPercent = null;
        this.forceHudMarker = this.add.rectangle(0, centerY, 3, barHeight - 4, 0xffcc00, 1)
            .setOrigin(0.5, 0.5)
            .setScrollFactor(0)
            .setDepth(12)
            .setVisible(false);
        this.forceHudMarkerLabel = this.add.text(0, centerY - barHeight / 2 - 4, '', {
            font: '14px Arial',
            fill: '#ffcc00',
            backgroundColor: '#000000aa',
            padding: { x: 6, y: 2 }
        }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(12).setVisible(false);

        this.forceHudBg.setInteractive({ useHandCursor: true });
        this.forceHudBg.on('pointerdown', (pointer) => this.onForceHudPointerDown(pointer));

        this.updateForceHud();
    }

    forceHudPointerToPercent(pointerX) {
        const barLeft = this.forceHudCenterX - this.forceHudBarWidth / 2;
        return Math.round(Phaser.Math.Clamp((pointerX - barLeft) / this.forceHudBarWidth, 0, 1) * 100);
    }

    onForceHudPointerDown(pointer) {
        if (pointer.button === 2) {
            this.clearForceHudMarker();
            return;
        }
        this.setForceHudMarker(this.forceHudPointerToPercent(pointer.x));
    }

    setForceHudMarker(percent) {
        this.forceHudMarkerPercent = percent;
        this.updateForceHudMarker();
        this.updateForceHud();
    }

    clearForceHudMarker() {
        this.forceHudMarkerPercent = null;
        this.updateForceHudMarker();
        this.updateForceHud();
    }

    updateForceHudMarker() {
        if (this.forceHudMarkerPercent == null) {
            this.forceHudMarker.setVisible(false);
            this.forceHudMarkerLabel.setVisible(false);
            return;
        }
        const x = this.forceHudCenterX - this.forceHudBarWidth / 2
            + (this.forceHudMarkerPercent / 100) * this.forceHudBarWidth;
        this.forceHudMarker.setPosition(x, this.forceHudY);
        this.forceHudMarker.setVisible(true);
        this.forceHudMarkerLabel.setPosition(x, this.forceHudY - this.forceHudBarHeight / 2 - 4);
        this.forceHudMarkerLabel.setText('▲ ' + this.forceHudMarkerPercent);
        this.forceHudMarkerLabel.setVisible(true);
    }

    chargeTimeToForcePercent(chargeTime) {
        return Math.round(Phaser.Math.Clamp(chargeTime / this.maxChargeMs, 0, 1) * 100);
    }

    getChargeForcePercent() {
        if (!this.isCharging) return 0;
        return this.chargeTimeToForcePercent(this.time.now - this.chargeStart);
    }

    getDisplayForcePercent() {
        if (this.isCharging) return this.getChargeForcePercent();
        return this.lastRoundForcePercent;
    }

    updateForceHud() {
        const force = this.getDisplayForcePercent();
        this.forceHudFill.width = (force / 100) * this.forceHudBarWidth;
        this.updateForceHudMarker();

        const t = force / 100;
        const r = Math.round(Phaser.Math.Linear(62, 231, t));
        const g = Math.round(Phaser.Math.Linear(207, 76, t));
        const b = Math.round(Phaser.Math.Linear(110, 60, t));
        this.forceHudFill.setFillStyle(Phaser.Display.Color.GetColor(r, g, b));
    }

    canShootNow() {
        return this.shootRestartDelayRemaining <= 0
            && !this.hasShotThisInterval
            && this.shootTimerRemaining > 0;
    }

    startNewShootInterval() {
        if (this.shootRestartDelayRemaining > 0) return;
        this.shootRestartDelayRemaining = this.shootRestartDelayMs;
        this.hasShotThisInterval = true;
    }

    activateShootInterval() {
        this.shootTimerRemaining = this.shootCooldownMs;
        this.shootRestartDelayRemaining = 0;
        this.hasShotThisInterval = false;
    }

    update(time, delta) {
        const left = this.isDirectionHeld('left');
        const right = this.isDirectionHeld('right');

        if (left && !right) {
            this.facing = -1;
        } else if (right && !left) {
            this.facing = 1;
        }
        this.applyPlayerFacing();

        // movimento lateral apenas durante a rodada ativa
        if (this.isRoundActive()) {
            let vx = 0;
            if (left && !right) vx -= 1;
            if (right && !left) vx += 1;
            this.player.setVelocityX(vx * this.player.speed);
        } else {
            this.player.setVelocityX(0);
        }

        this.updateWeaponAngleLimits();

        // ajuste de ângulo: cima/W sobem o ângulo; baixo/S descem
        const angleStep = Phaser.Math.DegToRad(this.weaponAngleSpeedDeg) * delta / 1000;
        const angleUp = this.isDirectionHeld('up');
        const angleDown = this.isDirectionHeld('down');
        if (angleUp && !angleDown) {
            this.weaponAngle -= angleStep;
        }
        if (angleDown && !angleUp) {
            this.weaponAngle += angleStep;
        }
        this.weaponAngle = Phaser.Math.Clamp(this.weaponAngle, this.weaponMinAngle, this.weaponMaxAngle);
        this.weapon.setPosition(this.player.x, this.player.y);
        this.weapon.setRotation(this.getWeaponDisplayRotation());

        // inimigo sem movimento automático no eixo X

        // delay de 3 s antes de cada reinício do timer
        if (this.shootRestartDelayRemaining > 0) {
            this.shootRestartDelayRemaining -= delta;
            if (this.shootRestartDelayRemaining <= 0) {
                this.activateShootInterval();
            }
        } else if (!this.isShootTimerFrozen()) {
            this.shootTimerRemaining -= delta;
            if (this.shootTimerRemaining <= 0) {
                this.requestRoundRestart();
            }
        }

        this.updateCamera(delta);

        // atualizar HUD
        this.hpText.setText('HP: ' + Math.max(0, Math.round(this.player.health)));
        this.updateAngleHud();
        this.updateShootTimerHud();
        this.updateForceHud();
        this.updateMinimapHud();
    }

    shoot(chargeTime) {
        if (!this.canShootNow()) return;
        this.hasShotThisInterval = true;
        this.pendingRoundRestart = true;
        this.frozenShootTimerSeconds = Math.max(1, Math.ceil(this.shootTimerRemaining / 1000));

        const minSpeed = 200;
        const maxSpeed = 800;
        const charge = Phaser.Math.Clamp(chargeTime / this.maxChargeMs, 0, 1);
        this.lastRoundForcePercent = this.chargeTimeToForcePercent(chargeTime);
        const speed = minSpeed + (maxSpeed - minSpeed) * charge;

        const b = this.bullets.create(this.player.x, this.player.y, 'bullet');
        b.setActive(true).setVisible(true).setDepth(1);
        this.playerBullet = b;

        b.launchX = this.player.x;
        b.launchY = this.player.y;
        b.hasBeenAboveLaunch = false;

        const angle = this.weaponAngle;
        b.body.setVelocity(
            Math.cos(angle) * speed * this.facing,
            Math.sin(angle) * speed
        );
        b.body.allowGravity = true;
        b.setBounce(0);
        this.focusBulletCamera();

        this.physics.add.overlap(b, this.enemies, (bullet, enemy) => {
            this.destroyPlayerBullet(bullet);
            enemy.health -= 15;
            this.tweens.add({
                targets: enemy,
                scaleX: 1.8,
                scaleY: 1.8,
                duration: 80,
                yoyo: true
            });
            if (enemy.health <= 0) enemy.destroy();
        });

        b.update = () => {
            if (b.x < 0 || b.x > this.worldWidth) {
                this.destroyPlayerBullet(b);
                return;
            }

            if (b.y < b.launchY) {
                b.hasBeenAboveLaunch = true;
            }

            if (
                b.hasBeenAboveLaunch &&
                b.body.velocity.y > 0 &&
                b.y >= b.launchY
            ) {
                b.setPosition(b.launchX, b.launchY);
                this.destroyPlayerBullet(b);
            }
        };
    }

}

const config = {
    type: Phaser.AUTO,
    width: 1280,
    height: 720,
    parent: 'game',
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 300 }, // projéteis caem
            debug: false
        }
    },
    scene: MainScene
};

new Phaser.Game(config);
