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
        this.player.speed = 180;
        this.player.health = 100;

        // controle de tiro único
        this.canShoot = true;

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
        this.weaponAngleSpeedDeg = 65;
        this.weaponMinAngle = -Math.PI + 0.1;
        this.weaponMaxAngle = -0.1;
        this.weapon = this.add.rectangle(this.player.x, this.player.y, 24, 8, 0x000000);
        this.weapon.setOrigin(0, 0.5).setDepth(1);

        // eventos de carregamento e disparo do tiro
        this.chargeStart = 0;
        this.input.on('pointerdown', () => {
            this.chargeStart = this.time.now;
        });
        this.input.on('pointerup', () => {
            const chargeTime = this.time.now - this.chargeStart;
            this.shoot(chargeTime);
        });

        // HUD
        this.hpText = this.add.text(10, 10, 'HP: ' + this.player.health, { font: '16px Arial', fill: '#fff' }).setScrollFactor(0);
        this.createAngleHud();
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
        this.angleHudText.setText('Ângulo: ' + angleDeg + '°');
    }

    update(time, delta) {
        // movimento lateral apenas
        const left = this.cursors.left.isDown || this.keys.A.isDown;
        const right = this.cursors.right.isDown || this.keys.D.isDown;
        let vx = 0;
        if (left) vx -= 1;
        if (right) vx += 1;
        this.player.setVelocityX(vx * this.player.speed);

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
        this.weapon.setRotation(this.weaponAngle);

        // inimigos patrulham horizontalmente
        this.enemies.getChildren().forEach(e => {
            e.x += e.dir * e.speed * delta / 1000;
            if (e.x < 40) { e.dir = 1; e.x = 40; }
            if (e.x > 760) { e.dir = -1; e.x = 760; }
        });

        // atualizar HUD
        this.hpText.setText('HP: ' + Math.max(0, Math.round(this.player.health)));
        this.updateAngleHud();
    }

    shoot(chargeTime) {
        // impede múltiplos tiros simultâneos
        if (!this.canShoot) return;
        this.canShoot = false;

        const minSpeed = 200;
        const maxSpeed = 800;
        const charge = Phaser.Math.Clamp(chargeTime / 1000, 0, 1);
        const speed = minSpeed + (maxSpeed - minSpeed) * charge;

        const b = this.bullets.create(this.player.x, this.player.y, 'bullet');
        b.setActive(true).setVisible(true).setDepth(1);

        const angle = this.weaponAngle;
        b.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
        b.body.allowGravity = true;
        b.setBounce(0.3);

        // colisão com inimigos (mantém a destruição normal)
        this.physics.add.overlap(b, this.enemies, (bullet, enemy) => {
            bullet.destroy();
            this.canShoot = true; // libera novo disparo
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

        // verificação contínua de limite de tela e chão
        b.update = () => {
            const screenWidth = this.scale.width;
            const screenHeight = this.scale.height;

            // destrói se sair da tela
            if (
                b.y < 0 || // acima
                b.x < 0 || // esquerda
                b.x > screenWidth || // direita
                b.y >= screenHeight - 10 // chão
            ) {
                b.destroy();
                this.canShoot = true; // libera novo tiro
            }
        };
    }

}

const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
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
