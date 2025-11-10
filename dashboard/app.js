class DashboardApp {
    constructor() {
        this.elements = {
            loginOverlay: document.getElementById('loginOverlay'),
            loginForm: document.getElementById('loginForm'),
            loginButton: document.getElementById('loginButton'),
            loginError: document.getElementById('loginError'),
            username: document.getElementById('username'),
            password: document.getElementById('password'),
            statusDot: document.getElementById('statusDot'),
            connectionStatus: document.getElementById('connectionStatus'),
            sessionSummary: document.getElementById('sessionSummary'),
            requestTemplate: document.getElementById('requestTemplate'),
            responseTemplate: document.getElementById('responseTemplate'),
            incomingMessage: document.getElementById('incomingMessage')
        };

        this.sessionKey = 'evdash.session';
        this.socket = null;
        this.token = null;
        this.tokenExpiry = null;
        this.username = null;
        this.pendingRequests = new Map();
        this.reconnectTimer = null;

        this.renderStaticTemplates();
        this.attachEventListeners();
        this.restoreSession();
    }

    attachEventListeners() {
        if (this.elements.loginForm) {
            this.elements.loginForm.addEventListener('submit', event => {
                event.preventDefault();
                this.submitLogin();
            });
        }
    }

    renderStaticTemplates() {
        const contract = {
            login: {
                method: 'POST /evdash/api/login',
                payload: {
                    username: 'user',
                    password: 'secret'
                }
            },
            websocket: {
                request: {
                    requestId: 'uuid',
                    action: 'ActionName',
                    payload: {}
                },
                authenticate: {
                    requestId: 'uuid',
                    action: 'authenticate',
                    payload: {
                        token: 'issued-token'
                    }
                }
            }
        };

        const responses = {
            success: {
                requestId: 'uuid',
                success: true,
                payload: {}
            },
            failure: {
                requestId: 'uuid',
                success: false,
                error: 'Error message'
            },
            examplePing: {
                requestId: 'uuid',
                success: true,
                payload: {
                    timestamp: '2025-01-12T09:30:00Z'
                }
            }
        };

        if (this.elements.requestTemplate)
            this.elements.requestTemplate.textContent = JSON.stringify(contract, null, 2);
        if (this.elements.responseTemplate)
            this.elements.responseTemplate.textContent = JSON.stringify(responses, null, 2);
    }

    restoreSession() {
        const stored = window.localStorage.getItem(this.sessionKey);
        if (!stored) {
            this.showLoginOverlay();
            return;
        }

        try {
            const parsed = JSON.parse(stored);
            if (!parsed || !parsed.token || !parsed.expiresAt) {
                this.clearSession();
                this.showLoginOverlay();
                return;
            }

            const expiresAt = new Date(parsed.expiresAt);
            if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
                this.clearSession();
                this.showLoginOverlay('Your session has expired. Please sign in again.');
                return;
            }

            this.token = parsed.token;
            this.tokenExpiry = expiresAt;
            this.username = parsed.username || null;
            this.updateSessionSummary();
            this.hideLoginOverlay();
            this.connectWebSocket();
        } catch (error) {
            console.warn('Failed to restore session', error);
            this.clearSession();
            this.showLoginOverlay('We could not restore your previous session. Please sign in again.');
        }
    }

    submitLogin() {
        if (!this.elements.username || !this.elements.password || !this.elements.loginButton)
            return;

        const username = this.elements.username.value.trim();
        const password = this.elements.password.value;

        if (!username || !password) {
            this.showLoginError('Username and password are required.');
            return;
        }

        this.setLoginLoading(true);
        this.performLoginRequest(username, password)
            .then(session => {
                this.persistSession({ ...session, username });
                this.hideLoginOverlay();
                this.updateSessionSummary();
                this.connectWebSocket(true);
            })
            .catch(error => {
                const message = error && error.message ? error.message : 'Login failed. Please try again.';
                this.showLoginError(message);
            })
            .finally(() => {
                this.setLoginLoading(false);
                if (this.elements.password)
                    this.elements.password.value = '';
            });
    }

    async performLoginRequest(username, password) {
        let response;
        try {
            response = await fetch('/evdash/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });
        } catch (networkError) {
            console.warn('Login request failed', networkError);
            throw new Error('Unable to reach the login endpoint. Please check your connection.');
        }

        let data;
        try {
            data = await response.json();
        } catch (parseError) {
            console.warn('Failed to parse login response', parseError);
            throw new Error('Received an unexpected response from the server.');
        }

        if (!response.ok || !data.success) {
            const errorCode = data && data.error ? data.error : 'unauthorized';
            throw new Error(this.describeLoginError(errorCode));
        }

        if (!data.token || !data.expiresAt)
            throw new Error('Invalid response from server.');

        return {
            token: data.token,
            expiresAt: data.expiresAt
        };
    }

    describeLoginError(code) {
        switch (code) {
        case 'invalidRequest':
            return 'The login request was malformed. Please reload the page and try again.';
        case 'unauthorized':
            return 'The provided credentials were not accepted.';
        default:
            return 'Login failed. Please try again.';
        }
    }

    persistSession(session) {
        this.token = session.token;
        this.tokenExpiry = new Date(session.expiresAt);
        this.username = session.username || null;

        try {
            window.localStorage.setItem(this.sessionKey, JSON.stringify({
                token: this.token,
                expiresAt: this.tokenExpiry.toISOString(),
                username: this.username
            }));
        } catch (error) {
            console.warn('Failed to persist session', error);
        }
    }

    clearSession() {
        this.token = null;
        this.tokenExpiry = null;
        this.username = null;
        this.pendingRequests.clear();
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;

        try {
            window.localStorage.removeItem(this.sessionKey);
        } catch (error) {
            console.warn('Failed to clear session', error);
        }
    }

    connectWebSocket(resetPending = false) {
        if (!this.token) {
            this.updateConnectionStatus('Awaiting login…', 'connecting');
            return;
        }

        if (this.tokenExpiry && this.tokenExpiry <= new Date()) {
            this.clearSession();
            this.showLoginOverlay('Your session has expired. Please sign in again.');
            return;
        }

        if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING))
            return;

        if (resetPending)
            this.pendingRequests.clear();

        clearTimeout(this.reconnectTimer);
        this.updateConnectionStatus('Connecting…', 'connecting');
        const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
        const host = window.location.hostname || 'localhost';
        const port = 4449;
        const normalizedHost = host.includes(':') ? `[${host}]` : host;
        const url = `${protocol}${normalizedHost}:${port}`;

        this.socket = new WebSocket(url);
        this.socket.addEventListener('open', () => {
            this.updateConnectionStatus('Authenticating…', 'authenticating');
            this.sendAuthenticate();
        });

        this.socket.addEventListener('message', event => {
            this.onSocketMessage(event);
        });

        this.socket.addEventListener('error', () => {
            this.updateConnectionStatus('Connection error', 'error');
        });

        this.socket.addEventListener('close', () => {
            this.onSocketClosed();
        });
    }

    sendAuthenticate() {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN)
            return;

        const requestId = this.generateRequestId();
        const message = {
            requestId,
            action: 'authenticate',
            payload: {
                token: this.token
            }
        };

        this.pendingRequests.set(requestId, { type: 'authenticate' });
        this.socket.send(JSON.stringify(message));
    }

    onSocketMessage(event) {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch (error) {
            console.warn('Failed to parse WebSocket message', error);
            this.elements.incomingMessage.textContent = `Failed to parse message: ${error.message}`;
            return;
        }

        if (this.elements.incomingMessage)
            this.elements.incomingMessage.textContent = JSON.stringify(data, null, 2);

        if (data.requestId && this.pendingRequests.has(data.requestId)) {
            const pending = this.pendingRequests.get(data.requestId);
            this.pendingRequests.delete(data.requestId);

            if (pending.type === 'authenticate') {
                if (data.success) {
                    this.onAuthenticationSucceeded();
                } else {
                    this.onAuthenticationFailed(data.error || 'unauthorized');
                }
                return;
            }
        }

        if (data.success === false && data.error === 'unauthenticated') {
            this.onAuthenticationFailed('unauthenticated');
        }
    }

    onAuthenticationSucceeded() {
        this.updateConnectionStatus('Connected', 'connected');
        this.updateSessionSummary();
    }

    onAuthenticationFailed(reason) {
        const message = reason === 'unauthenticated'
            ? 'Your session expired. Please sign in again.'
            : 'Authentication failed. Please try again.';

        console.warn('Authentication failed', reason);
        this.clearSession();
        this.showLoginOverlay(message);
        this.updateConnectionStatus('Authentication required', 'error');

        if (this.socket && this.socket.readyState === WebSocket.OPEN)
            this.socket.close();
    }

    onSocketClosed() {
        this.pendingRequests.clear();
        this.updateConnectionStatus('Disconnected', 'error');
        if (!this.token) {
            this.showLoginOverlay();
            return;
        }

        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
            this.connectWebSocket();
        }, 3000);
    }

    sendAction(action, payload = {}) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            console.warn('Cannot send action. WebSocket not connected.');
            return null;
        }

        if (action !== 'authenticate' && this.pendingRequests.size && !this.isAuthenticated()) {
            console.warn('Cannot send action before authentication succeeded.');
            return null;
        }

        const requestId = this.generateRequestId();
        const message = {
            requestId,
            action,
            payload
        };

        this.socket.send(JSON.stringify(message));
        return requestId;
    }

    isAuthenticated() {
        for (const pending of this.pendingRequests.values()) {
            if (pending.type === 'authenticate')
                return false;
        }
        return !!this.token && !!this.socket && this.socket.readyState === WebSocket.OPEN;
    }

    sendPing() {
        return this.sendAction('ping', { timestamp: new Date().toISOString() });
    }

    updateConnectionStatus(text, state) {
        if (this.elements.connectionStatus)
            this.elements.connectionStatus.textContent = text;

        if (!this.elements.statusDot)
            return;

        const dot = this.elements.statusDot;
        dot.classList.remove('connecting', 'connected', 'authenticating', 'error');
        dot.classList.add(state);
    }

    updateSessionSummary() {
        if (!this.elements.sessionSummary)
            return;

        if (!this.token) {
            this.elements.sessionSummary.textContent = 'Please sign in to start the WebSocket session.';
            return;
        }

        const expires = this.tokenExpiry ? this.tokenExpiry.toISOString() : 'unknown';
        const username = this.username ? this.username : 'user';
        this.elements.sessionSummary.textContent = `Signed in as ${username}. Token valid until ${expires}.`;
    }

    showLoginOverlay(message) {
        this.setAuthLayout(true);
        if (this.elements.loginOverlay)
            this.elements.loginOverlay.classList.remove('hidden');
        if (typeof message === 'string' && message.length > 0)
            this.showLoginError(message);
        else
            this.hideLoginError();

        if (this.elements.username)
            setTimeout(() => this.elements.username.focus(), 50);
    }

    hideLoginOverlay() {
        this.setAuthLayout(false);
        if (this.elements.loginOverlay)
            this.elements.loginOverlay.classList.add('hidden');
        this.hideLoginError();
    }

    showLoginError(message) {
        if (!this.elements.loginError)
            return;
        this.elements.loginError.textContent = message;
        this.elements.loginError.classList.remove('hidden');
    }

    hideLoginError() {
        if (!this.elements.loginError)
            return;
        this.elements.loginError.textContent = '';
        this.elements.loginError.classList.add('hidden');
    }

    setLoginLoading(loading) {
        if (!this.elements.loginButton)
            return;
        this.elements.loginButton.disabled = loading;
        this.elements.loginButton.textContent = loading ? 'Signing in…' : 'Sign in';
    }

    generateRequestId() {
        if (window.crypto && window.crypto.randomUUID)
            return window.crypto.randomUUID();

        return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    setAuthLayout(requireAuth) {
        const body = document.body;
        if (!body)
            return;
        body.classList.toggle('needs-auth', requireAuth);
    }
}

window.app = new DashboardApp();
