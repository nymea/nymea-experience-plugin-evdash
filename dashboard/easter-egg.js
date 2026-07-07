class EasterEggGame {
    constructor(elements, translate) {
        this.elements = elements;
        this.translate = translate;

        this.running = false;
        this.frameId = null;
        this.lastTime = null;
        this.score = 0;
        this.keys = {};
        this.player = { x: 30, y: 30, size: 16, speed: 3.2 };
        this.target = { x: 200, y: 140, size: 10 };
        this._backgroundGradient = null;

        this._keyDownHandler = event => this.handleKey(event, true);
        this._keyUpHandler = event => this.handleKey(event, false);

        if (this.elements.closeButton)
            this.elements.closeButton.addEventListener('click', () => this.stop());

        if (this.elements.overlay) {
            this.elements.overlay.addEventListener('click', event => {
                if (event.target === this.elements.overlay)
                    this.stop();
            });
        }

        this.updateScoreLabel();
    }

    start() {
        if (!this.elements.overlay || !this.elements.canvas)
            return;

        this.elements.overlay.classList.remove('hidden');
        this.elements.overlay.setAttribute('aria-hidden', 'false');

        const canvas = this.elements.canvas;
        this.running = true;
        this.score = 0;
        this.keys = {};
        this.lastTime = null;
        this._backgroundGradient = null;
        this.player.x = canvas.width * 0.2;
        this.player.y = canvas.height * 0.5;
        this.player.speed = 3.2;
        this.spawnTarget();
        this.updateScoreLabel();
        this.toggleListeners(true);

        const loop = timestamp => {
            if (!this.running)
                return;

            if (!this.lastTime)
                this.lastTime = timestamp;
            const delta = Math.min((timestamp - this.lastTime) / 16.67, 3);
            this.lastTime = timestamp;

            this.updatePhysics(delta);
            this.drawFrame();
            this.frameId = window.requestAnimationFrame(loop);
        };

        this.frameId = window.requestAnimationFrame(loop);
    }

    stop() {
        this.running = false;
        this.keys = {};
        if (this.frameId) {
            window.cancelAnimationFrame(this.frameId);
            this.frameId = null;
        }

        if (this.elements.overlay) {
            this.elements.overlay.classList.add('hidden');
            this.elements.overlay.setAttribute('aria-hidden', 'true');
        }

        this.toggleListeners(false);
    }

    toggleListeners(enable) {
        if (enable) {
            document.addEventListener('keydown', this._keyDownHandler);
            document.addEventListener('keyup', this._keyUpHandler);
        } else {
            document.removeEventListener('keydown', this._keyDownHandler);
            document.removeEventListener('keyup', this._keyUpHandler);
        }
    }

    handleKey(event, isDown) {
        if (!this.running)
            return;

        const key = event.key ? event.key.toLowerCase() : '';
        const movableKeys = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'];
        if (key === 'escape') {
            this.stop();
            return;
        }

        if (movableKeys.includes(key)) {
            event.preventDefault();
            this.keys[key] = isDown;
        }
    }

    updatePhysics(delta) {
        const canvas = this.elements.canvas;
        if (!canvas)
            return;

        const { player, target } = this;
        const input = {
            x: (this.keys.arrowright || this.keys.d ? 1 : 0) - (this.keys.arrowleft || this.keys.a ? 1 : 0),
            y: (this.keys.arrowdown || this.keys.s ? 1 : 0) - (this.keys.arrowup || this.keys.w ? 1 : 0)
        };

        if (input.x !== 0 || input.y !== 0) {
            const length = Math.hypot(input.x, input.y) || 1;
            const speed = player.speed * delta;
            player.x += (input.x / length) * speed;
            player.y += (input.y / length) * speed;
        }

        const minX = player.size;
        const maxX = canvas.width - player.size;
        const minY = player.size;
        const maxY = canvas.height - player.size;
        player.x = Math.min(Math.max(player.x, minX), maxX);
        player.y = Math.min(Math.max(player.y, minY), maxY);

        const dx = player.x - target.x;
        const dy = player.y - target.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= player.size + target.size) {
            this.score += 1;
            player.speed = Math.min(player.speed + 0.15, 7.5);
            this.updateScoreLabel();
            this.spawnTarget();
        }
    }

    getBackgroundGradient(ctx, canvas) {
        if (!this._backgroundGradient || this._backgroundGradient.width !== canvas.width || this._backgroundGradient.height !== canvas.height) {
            const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
            gradient.addColorStop(0, '#0f1c3d');
            gradient.addColorStop(1, '#092037');
            this._backgroundGradient = Object.assign(gradient, { width: canvas.width, height: canvas.height });
        }

        return this._backgroundGradient;
    }

    drawFrame() {
        const canvas = this.elements.canvas;
        if (!canvas)
            return;

        const ctx = canvas.getContext('2d');
        const { player, target } = this;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = this.getBackgroundGradient(ctx, canvas);
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 20; x < canvas.width; x += 40) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
        }
        for (let y = 20; y < canvas.height; y += 40) {
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
        }
        ctx.stroke();

        ctx.fillStyle = '#f4b400';
        ctx.beginPath();
        ctx.moveTo(target.x, target.y - target.size);
        ctx.lineTo(target.x - target.size * 0.6, target.y + target.size * 0.2);
        ctx.lineTo(target.x - target.size * 0.2, target.y + target.size * 0.2);
        ctx.lineTo(target.x - target.size, target.y + target.size);
        ctx.lineTo(target.x + target.size * 0.2, target.y + target.size * 0.2);
        ctx.lineTo(target.x + target.size * 0.6, target.y - target.size * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.2)';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        const carWidth = player.size * 2.4;
        const carHeight = player.size * 1.4;
        const carX = player.x - carWidth / 2;
        const carY = player.y - carHeight / 2;

        const carGradient = ctx.createLinearGradient(carX, carY, carX + carWidth, carY + carHeight);
        carGradient.addColorStop(0, '#e30a18');
        carGradient.addColorStop(1, '#f48221');
        ctx.fillStyle = carGradient;

        ctx.beginPath();
        ctx.moveTo(carX + carWidth * 0.15, carY + carHeight);
        ctx.lineTo(carX + carWidth * 0.15, carY + carHeight * 0.55);
        ctx.lineTo(carX + carWidth * 0.35, carY + carHeight * 0.25);
        ctx.lineTo(carX + carWidth * 0.65, carY + carHeight * 0.25);
        ctx.lineTo(carX + carWidth * 0.85, carY + carHeight * 0.55);
        ctx.lineTo(carX + carWidth * 0.85, carY + carHeight);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2;
        ctx.stroke();

        const wheelRadius = player.size * 0.35;
        const wheelY = carY + carHeight;
        ctx.fillStyle = '#0d1221';
        ctx.beginPath();
        ctx.arc(carX + carWidth * 0.28, wheelY, wheelRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(carX + carWidth * 0.72, wheelY, wheelRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(carX + carWidth * 0.42, carY + carHeight * 0.32, carWidth * 0.22, carHeight * 0.2);
    }

    spawnTarget() {
        const canvas = this.elements.canvas;
        if (!canvas)
            return;

        const { target, player } = this;
        const padding = target.size + 12;
        let attempts = 0;
        do {
            target.x = padding + Math.random() * (canvas.width - padding * 2);
            target.y = padding + Math.random() * (canvas.height - padding * 2);
            attempts++;
        } while (Math.hypot(player.x - target.x, player.y - target.y) < player.size * 2 && attempts < 12);
    }

    updateScoreLabel() {
        if (!this.elements.scoreLabel)
            return;
        this.elements.scoreLabel.textContent = this.translate('easterEgg.score', { score: this.score });
    }
}

window.EasterEggGame = EasterEggGame;
