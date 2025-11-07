class EvDashApp {
    constructor() {
        this.statusDot = document.getElementById('statusDot');
        this.connectionStatus = document.getElementById('connectionStatus');
        this.outgoingStructure = document.getElementById('outgoingStructure');
        this.incomingMessage = document.getElementById('incomingMessage');

        this.requestTemplate = {
            version: '1.0',
            requestId: 'uuid-v4',
            action: 'ping',
            payload: {}
        };

        this.responseTemplate = {
            version: '1.0',
            requestId: 'uuid-v4',
            event: 'statusUpdate',
            payload: {
                status: 'ok',
                timestamp: new Date().toISOString()
            }
        };

        this.renderOutgoingTemplate();
        this.connect();
    }

    get websocketUrl() {
        const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
        const hostname = window.location.hostname || 'localhost';
        const port = 4449;
        const normalizedHost = hostname.includes(':') ? `[${hostname}]` : hostname;
        return `${protocol}${normalizedHost}:${port}`;
    }

    connect() {
        this.updateStatus('Connecting…', 'connecting');
        this.socket = new WebSocket(this.websocketUrl);

        this.socket.addEventListener('open', () => {
            this.updateStatus('Connected', 'connected');
            this.sendExampleMessage()
        });

        this.socket.addEventListener('message', event => {
            try {
                const data = JSON.parse(event.data);
                this.incomingMessage.textContent = JSON.stringify(data, null, 2);
            } catch (error) {
                this.incomingMessage.textContent = `Failed to parse message: ${error.message}`;
            }
        });

        this.socket.addEventListener('error', () => {
            this.updateStatus('Connection error', 'error');
        });

        this.socket.addEventListener('close', () => {
            this.updateStatus('Disconnected. Reconnecting…', 'error');
            setTimeout(() => this.connect(), 3000);
        });
    }

    updateStatus(text, state) {
        this.connectionStatus.textContent = text;
        this.statusDot.classList.remove('connected', 'connecting', 'error');
        this.statusDot.classList.add(state);
    }

    renderOutgoingTemplate() {
        const example = {
            ...this.requestTemplate,
            payload: {
                example: true
            }
        };
        this.outgoingStructure.textContent = JSON.stringify({
            request: this.requestTemplate,
            response: this.responseTemplate,
            exampleRequest: example
        }, null, 2);
    }

    sendExampleMessage() {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            const message = {
                ...this.requestTemplate,
                requestId: crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`,
                payload: {
                    command: 'ping',
                    timestamp: new Date().toISOString()
                }
            };
            this.socket.send(JSON.stringify(message));
            return message;
        }
        console.warn('WebSocket is not connected.');
        return null;
    }
}

window.app = new EvDashApp();
