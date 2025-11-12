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
            sessionUsername: document.getElementById('sessionUsername'),
            logoutButton: document.getElementById('logoutButton'),
            requestTemplate: document.getElementById('requestTemplate'),
            responseTemplate: document.getElementById('responseTemplate'),
            incomingMessage: document.getElementById('incomingMessage'),
            chargerTableBody: document.getElementById('chargerTableBody'),
            chargerEmptyRow: document.getElementById('chargerEmptyRow')
        };

        this.sessionKey = 'evdash.session';
        this.socket = null;
        this.token = null;
        this.tokenExpiry = null;
        this.username = null;
        this.pendingRequests = new Map();
        this.reconnectTimer = null;
        this.tokenRefreshTimer = null;
        this.refreshInFlight = false;
        this.chargers = new Map();
        this.chargerColumns = [
            { key: 'id', label: 'ID', hidden: true },
            { key: 'name', label: 'Name' },
            { key: 'connected', label: 'Connected' },
            { key: 'chargingCurrent', label: 'Charging current' },
            { key: 'chargingAllowed', label: 'Charging allowed' },
            { key: 'currentPower', label: 'Current power' },
            { key: 'pluggedIn', label: 'Plugged in' },
            { key: 'version', label: 'Version' },
            { key: 'sessionEnergy', label: 'Session energy' },
            { key: 'temperature', label: 'Temperature' },
            { key: 'chargingPhases', label: 'Charging phases' }
        ];

        this.renderStaticTemplates();
        this.attachEventListeners();
        this.restoreSession();
        this.toggleChargerEmptyState();
    }

    attachEventListeners() {
        if (this.elements.loginForm) {
            this.elements.loginForm.addEventListener('submit', event => {
                event.preventDefault();
                this.submitLogin();
            });
        }

        if (this.elements.logoutButton) {
            this.elements.logoutButton.addEventListener('click', () => {
                this.logout();
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
            this.scheduleTokenRefresh();
        this.updateSessionUser();
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
                this.updateSessionUser();
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

        this.scheduleTokenRefresh();
    }

    clearSession() {
        this.token = null;
        this.tokenExpiry = null;
        this.username = null;
        this.pendingRequests.clear();
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        clearTimeout(this.tokenRefreshTimer);
        this.tokenRefreshTimer = null;
        this.refreshInFlight = false;
        this.chargers.clear();
        this.resetChargerTable();

        try {
            window.localStorage.removeItem(this.sessionKey);
        } catch (error) {
            console.warn('Failed to clear session', error);
        }

        this.updateSessionUser();
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

        this.sendAction('authenticate', {
            token: this.token
        });
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

        console.log('<--', data);

        if (this.elements.incomingMessage)
            this.elements.incomingMessage.textContent = JSON.stringify(data, null, 2);

        let handled = false;
        if (data.requestId && this.pendingRequests.has(data.requestId)) {
            const pending = this.pendingRequests.get(data.requestId);
            this.pendingRequests.delete(data.requestId);
            handled = this.handlePendingResponse(pending, data);
        } else {
            handled = this.handleUnsolicitedMessage(data);
        }

        if (!handled && data.success === false && data.error === 'unauthenticated')
            this.onAuthenticationFailed('unauthenticated');
    }

    handlePendingResponse(pending, data) {
        if (!pending)
            return false;

        const type = typeof pending.type === 'string' ? pending.type.toLowerCase() : '';

        if (type === 'authenticate') {
            if (data.success)
                this.onAuthenticationSucceeded();
            else
                this.onAuthenticationFailed(data.error || 'unauthorized');
            return true;
        }

        if (type === 'getchargers') {
            if (data.success) {
                const payload = data && data.payload ? data.payload : {};
                const chargers = Array.isArray(payload.chargers) ? payload.chargers : [];
                this.processChargerList(chargers);
            } else if (data.error === 'unauthenticated') {
                this.onAuthenticationFailed('unauthenticated');
            } else {
                console.warn('GetChargers request failed', data.error || 'unknownError');
            }
            return true;
        }

        return false;
    }

    handleUnsolicitedMessage(data) {
        if (!data)
            return false;

        if (data.event && this.handleNotificationEvent(data.event, data.payload))
            return true;

        if (!data.payload)
            return false;

        const payload = data.payload;

        if (Array.isArray(payload.chargers)) {
            this.processChargerList(payload.chargers);
            return true;
        }

        if (payload.charger) {
            this.upsertCharger(payload.charger);
            return true;
        }

        return false;
    }

    handleNotificationEvent(eventName, payload) {
        if (!eventName)
            return false;

        const normalizedEvent = typeof eventName === 'string' ? eventName.toLowerCase() : '';
        switch (normalizedEvent) {
        case 'chargeradded':
        case 'chargerchanged':
            this.upsertCharger(payload);
            return true;
        case 'chargerremoved':
            this.removeCharger(payload);
            return true;
        default:
            return false;
        }
    }

    onAuthenticationSucceeded() {
        this.updateConnectionStatus('Connected', 'connected');
        this.updateSessionUser();
        this.sendGetChargers();
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

        const normalizedAction = typeof action === 'string' ? action.toLowerCase() : '';
        this.pendingRequests.set(requestId, { type: normalizedAction });

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

    sendGetChargers() {
        return this.sendAction('GetChargers', { });
    }

    processChargerList(chargers = []) {
        if (!Array.isArray(chargers)) {
            console.warn('Expected chargers array in payload.');
            return;
        }

        const seen = new Set();
        chargers.forEach(charger => {
            const key = this.getChargerKey(charger);
            if (!key)
                return;
            seen.add(key);
            this.upsertCharger(charger);
        });

        for (const existingId of Array.from(this.chargers.keys())) {
            if (!seen.has(existingId))
                this.removeCharger(existingId);
        }
    }

    upsertCharger(charger) {
        const key = this.getChargerKey(charger);
        if (!key)
            return;

        const hasExisting = this.chargers.has(key);
        const previous = hasExisting ? this.chargers.get(key) : {};
        const merged = { ...previous, ...charger };
        merged.thingId = key;
        this.chargers.set(key, merged);
        this.syncChargerRow(merged, !hasExisting);
    }

    syncChargerRow(charger, forceCreate = false) {
        const key = this.getChargerKey(charger);
        if (!charger || !key || !this.elements.chargerTableBody)
            return;

        let row = this.findChargerRow(key);
        if (!row || forceCreate) {
            if (row && row.parentElement)
                row.parentElement.removeChild(row);
            row = this.buildChargerRow(charger);
            this.elements.chargerTableBody.appendChild(row);
        } else {
            this.chargerColumns.forEach(column => {
                if (column.hidden)
                    return;
                const cell = row.querySelector(`td[data-column="${column.key}"]`);
                if (!cell)
                    return;
                this.renderCellValue(cell, column.key, charger[column.key]);
            });
        }

        this.toggleChargerEmptyState();
    }

    buildChargerRow(charger) {
        const row = document.createElement('tr');
        row.dataset.chargerId = this.getChargerKey(charger) || '';
        this.chargerColumns.forEach(column => {
            if (column.hidden)
                return;
            const cell = document.createElement('td');
            cell.dataset.column = column.key;
            this.renderCellValue(cell, column.key, charger[column.key]);
            row.appendChild(cell);
        });
        return row;
    }

    renderCellValue(cell, key, value) {
        if (!cell)
            return;

        if (typeof value === 'boolean') {
            cell.innerHTML = '';
            const dot = document.createElement('span');
            dot.className = `value-dot ${value ? 'value-dot-true' : 'value-dot-false'}`;
            dot.setAttribute('role', 'img');
            dot.setAttribute('aria-label', value ? 'True' : 'False');
            dot.title = value ? 'True' : 'False';
            const srText = document.createElement('span');
            srText.className = 'sr-only';
            srText.textContent = value ? 'True' : 'False';
            cell.appendChild(dot);
            cell.appendChild(srText);
            return;
        }

        cell.textContent = this.formatChargerValue(key, value);
    }

    removeCharger(identifier) {
        const key = this.getChargerKey(identifier);
        if (!key)
            return;

        this.chargers.delete(key);
        const row = this.findChargerRow(key);
        if (row && row.parentElement)
            row.parentElement.removeChild(row);

        this.toggleChargerEmptyState();
    }

    resetChargerTable() {
        if (!this.elements.chargerTableBody)
            return;

        const rows = this.elements.chargerTableBody.querySelectorAll('tr[data-charger-id]');
        rows.forEach(row => {
            if (row.parentElement)
                row.parentElement.removeChild(row);
        });

        this.toggleChargerEmptyState();
    }

    findChargerRow(chargerId) {
        if (!this.elements.chargerTableBody || !chargerId)
            return null;

        const normalizedId = typeof CSS !== 'undefined' && CSS.escape
            ? CSS.escape(String(chargerId))
            : String(chargerId).replace(/"/g, '\\"');
        return this.elements.chargerTableBody.querySelector(`tr[data-charger-id="${normalizedId}"]`);
    }

    getChargerKey(source) {
        if (!source)
            return null;

        if (typeof source === 'string')
            return source;

        if (source.thingId)
            return source.thingId;

        if (source.id)
            return source.id;

        return null;
    }

    toggleChargerEmptyState() {
        if (!this.elements.chargerEmptyRow)
            return;

        const hasChargers = this.chargers && this.chargers.size > 0;
        this.elements.chargerEmptyRow.classList.toggle('hidden', hasChargers);
    }

    formatChargerValue(key, value) {
        if (value === null || value === undefined || value === '')
            return '—';

        if ((key === 'currentPower' || key === 'sessionEnergy') && typeof value === 'number') {
            if (!Number.isFinite(value))
                return '—';
            const unit = key === 'currentPower' ? 'kW' : 'kWh';
            if (key === 'currentPower') {
                value = value / 1000;
                return `${value.toFixed(2)} ${unit}`;
            }

            return `${value.toFixed(2)} ${unit}`;
        }

        if (typeof value === 'boolean')
            return value ? 'Yes' : 'No';

        if (typeof value === 'number')
            return Number.isFinite(value) ? String(value) : '—';

        if (typeof value === 'string')
            return value;

        try {
            return JSON.stringify(value);
        } catch (error) {
            console.warn(`Failed to stringify value for ${key}`, error);
            return '—';
        }
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

    updateSessionUser() {
        if (!this.elements.sessionUsername)
            return;

        const defaultLabel = document.body && document.body.dataset.mode === 'help'
            ? 'Load the dashboard to authenticate.'
            : 'Awaiting login…';

        if (!this.token || !this.username) {
            this.elements.sessionUsername.textContent = defaultLabel;
            this.toggleLogoutButton(false);
            return;
        }

        this.elements.sessionUsername.textContent = this.username;
        this.toggleLogoutButton(true);
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
        if (!body || body.dataset.mode === 'help')
            return;
        body.classList.toggle('needs-auth', requireAuth);
    }

    toggleLogoutButton(visible) {
        if (!this.elements.logoutButton)
            return;
        this.elements.logoutButton.classList.toggle('hidden', !visible);
    }

    logout() {
        this.clearSession();
        if (this.socket && this.socket.readyState === WebSocket.OPEN)
            this.socket.close();
        this.updateConnectionStatus('Logged out', 'connecting');
        this.updateSessionUser();
        this.showLoginOverlay('You have been logged out.');
    }

    scheduleTokenRefresh() {
        clearTimeout(this.tokenRefreshTimer);
        this.tokenRefreshTimer = null;

        if (!this.token || !this.tokenExpiry)
            return;

        const now = Date.now();
        const expiryTime = this.tokenExpiry.getTime();
        const leadTimeMs = 60 * 1000; // refresh one minute before expiry
        const delay = Math.max(expiryTime - leadTimeMs - now, 5 * 1000);

        this.tokenRefreshTimer = setTimeout(() => {
            this.refreshToken();
        }, delay);
    }

    async refreshToken() {
        if (!this.token || this.refreshInFlight)
            return;

        this.refreshInFlight = true;

        try {
            const response = await fetch('/evdash/api/refresh', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ token: this.token })
            });

            const data = await response.json();
            if (!response.ok || !data.success)
                throw new Error(data && data.error ? data.error : 'refreshFailed');

            if (!data.token || !data.expiresAt)
                throw new Error('Invalid response from server.');

            this.persistSession({
                token: data.token,
                expiresAt: data.expiresAt,
                username: this.username
            });
            this.updateSessionUser();
        } catch (error) {
            console.warn('Token refresh failed', error);
            this.clearSession();
            this.updateConnectionStatus('Authentication required', 'error');
            if (this.socket && this.socket.readyState === WebSocket.OPEN)
                this.socket.close();
            this.showLoginOverlay('Session expired. Please sign in again.');
        } finally {
            this.refreshInFlight = false;
        }
    }
}

window.app = new DashboardApp();
