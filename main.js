class MainScene extends Phaser.Scene {

    preload() {
        this.load.image('bg', './assets/bg.png');
        this.textures.generate('ant', { data: ['..###..', '..###..', '..###..'], pixelWidth: 6 });
        this.load.image('bullet', './assets/bullet.png');
    }

    create() {
        this.cameras.main.setBackgroundColor('#2b2b2b');

        // jogador nasce na parte inferior do mapa
        this.player = this.physics.add.sprite(400, 580, 'ant').setScale(2);
        this.player.setCollideWorldBounds(true);
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

        // inimigos
        this.enemies = this.physics.add.group();
        for (let i = 0; i < 6; i++) {
            const e = this.enemies.create(100 + i * 110, 80 + (i % 2) * 120, 'ant').setScale(1.6);
            e.setTint(0xff6666);
            e.health = 30;
            e.speed = 40 + Math.random() * 60;
            e.dir = Math.random() > 0.5 ? 1 : -1;
        }

        // controles
        this.cursors = this.input.keyboard.createCursorKeys();
        this.keys = this.input.keyboard.addKeys('A,D');

        // ângulo da arma (bloco preto) — controlado pelas setas cima/baixo
        this.weaponAngle = -Math.PI / 4;
        this.weaponAngleSpeedDeg = 13;
        this.weaponMinAngle = -Math.PI + 0.1;
        this.weaponMaxAngle = -0.1;
        this.weapon = this.add.rectangle(this.player.x, this.player.y, 24, 8, 0x000000);
        this.weapon.setOrigin(0, 0.5).setDepth(1);

        // carregamento e disparo do tiro (tecla Espaço)
        this.maxChargeMs = 5000;
        this.chargeStart = 0;
        this.isCharging = false;
        this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
        this.input.keyboard.on('keydown-SPACE', () => {
            if (this.isCharging || !this.canShootNow()) return;
            this.frozenShootTimerSeconds = Math.max(1, Math.ceil(this.shootTimerRemaining / 1000));
            this.chargeStart = this.time.now;
            this.isCharging = true;
        });
        this.input.keyboard.on('keyup-SPACE', () => {
            if (!this.isCharging) return;
            const chargeTime = this.time.now - this.chargeStart;
            this.isCharging = false;
            this.shoot(chargeTime);
        });

        // HUD
        this.hpText = this.add.text(10, 10, 'HP: ' + this.player.health, { font: '16px Arial', fill: '#fff' }).setScrollFactor(0);
        this.createAngleHud();
        this.createShootTimerHud();
        this.createForceHud();
    }

    createAngleHud() {
        const padding = 10;
        this.angleHudText = this.add.text(
            this.scale.width - padding,
            padding,
            '',
            {
                font: '16px Arial',
                fill: '#fff',
                backgroundColor: '#000000aa',
                padding: { x: 10, y: 6 }
            }
        ).setOrigin(1, 0).setScrollFactor(0).setDepth(10);
        this.updateAngleHud();
    }

    updateAngleHud() {
        const angleDeg = Math.round(Phaser.Math.RadToDeg(-this.weaponAngle));
        const facingLabel = this.facing === -1 ? 'Esq.' : 'Dir.';
        this.angleHudText.setText('Ângulo: ' + angleDeg + '° (' + facingLabel + ')');
    }

    applyPlayerFacing() {
        this.player.setFlipX(this.facing === -1);
        this.player.setTint(this.facing === -1 ? 0xff3333 : 0x3366ff);
    }

    getWeaponDisplayRotation() {
        return this.facing === -1 ? Math.PI - this.weaponAngle : this.weaponAngle;
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

        if (this.pendingRoundRestart) {
            this.pendingRoundRestart = false;
            this.startNewShootInterval();
        }
    }

    requestRoundRestart() {
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
        const barWidth = 220;
        const barHeight = 18;
        const centerX = this.scale.width / 2;
        const centerY = this.scale.height - 36;

        this.forceHudBarWidth = barWidth - 4;
        this.forceHudCenterX = centerX;
        this.forceHudY = centerY;

        this.forceHudBg = this.add.rectangle(centerX, centerY, barWidth, barHeight, 0x1a1a1a, 0.9)
            .setStrokeStyle(2, 0xffffff, 0.35)
            .setScrollFactor(0)
            .setDepth(10);

        this.forceHudFill = this.add.rectangle(
            centerX - this.forceHudBarWidth / 2,
            centerY,
            0,
            barHeight - 4,
            0x3ecf6e
        ).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11);

        this.forceHudText = this.add.text(centerX, centerY - 22, 'Força: 0', {
            font: '14px Arial',
            fill: '#fff',
            backgroundColor: '#000000aa',
            padding: { x: 8, y: 4 }
        }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(10);

        this.updateForceHud();
    }

    getChargeForcePercent() {
        if (!this.isCharging) return 0;
        const chargeTime = this.time.now - this.chargeStart;
        return Math.round(Phaser.Math.Clamp(chargeTime / this.maxChargeMs, 0, 1) * 100);
    }

    updateForceHud() {
        const show = this.canShootNow() || this.isCharging;
        this.forceHudBg.setVisible(show);
        this.forceHudFill.setVisible(show);
        this.forceHudText.setVisible(show);
        if (!show) return;

        const force = this.getChargeForcePercent();
        this.forceHudFill.width = (force / 100) * this.forceHudBarWidth;
        this.forceHudText.setText('Força: ' + force);

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
        const left = this.cursors.left.isDown || this.keys.A.isDown;
        const right = this.cursors.right.isDown || this.keys.D.isDown;

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

        // ajuste de ângulo da arma pelas setas cima/baixo
        const angleStep = Phaser.Math.DegToRad(this.weaponAngleSpeedDeg) * delta / 1000;
        if (this.cursors.up.isDown) {
            this.weaponAngle += angleStep;
        }
        if (this.cursors.down.isDown) {
            this.weaponAngle -= angleStep;
        }
        this.weaponAngle = Phaser.Math.Clamp(this.weaponAngle, this.weaponMinAngle, this.weaponMaxAngle);
        this.weapon.setPosition(this.player.x, this.player.y);
        this.weapon.setRotation(this.getWeaponDisplayRotation());

        // inimigos patrulham horizontalmente
        this.enemies.getChildren().forEach(e => {
            e.x += e.dir * e.speed * delta / 1000;
            if (e.x < 40) { e.dir = 1; e.x = 40; }
            if (e.x > 760) { e.dir = -1; e.x = 760; }
        });

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

        // atualizar HUD
        this.hpText.setText('HP: ' + Math.max(0, Math.round(this.player.health)));
        this.updateAngleHud();
        this.updateShootTimerHud();
        this.updateForceHud();
    }

    shoot(chargeTime) {
        if (!this.canShootNow()) return;
        this.hasShotThisInterval = true;
        this.pendingRoundRestart = true;
        this.frozenShootTimerSeconds = Math.max(1, Math.ceil(this.shootTimerRemaining / 1000));

        const minSpeed = 200;
        const maxSpeed = 800;
        const charge = Phaser.Math.Clamp(chargeTime / this.maxChargeMs, 0, 1);
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
            const screenWidth = this.scale.width;

            if (b.x < 0 || b.x > screenWidth) {
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
