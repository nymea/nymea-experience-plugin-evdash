class DashboardApp {
    constructor() {
        this.elements = {
            loginOverlay: document.getElementById('loginOverlay'),
            loginForm: document.getElementById('loginForm'),
            loginButton: document.getElementById('loginButton'),
            loginError: document.getElementById('loginError'),
            username: document.getElementById('username'),
            password: document.getElementById('password'),
            brandLogo: document.getElementById('brandLogo'),
            statusDot: document.getElementById('statusDot'),
            connectionStatus: document.getElementById('connectionStatus'),
            sessionUsername: document.getElementById('sessionUsername'),
            logoutButton: document.getElementById('logoutButton'),
            requestTemplate: document.getElementById('requestTemplate'),
            responseTemplate: document.getElementById('responseTemplate'),
            incomingMessage: document.getElementById('incomingMessage'),
            easterEggOverlay: document.getElementById('easterEggOverlay'),
            easterEggCanvas: document.getElementById('easterEggCanvas'),
            easterEggClose: document.getElementById('easterEggClose'),
            easterEggScore: document.getElementById('easterEggScore'),
            chargerTableBody: document.getElementById('chargerTableBody'),
            chargerEmptyRow: document.getElementById('chargerEmptyRow'),
            fetchSessionsButton: document.getElementById('fetchSessionsButton'),
            downloadSessionsButton: document.getElementById('downloadSessionsButton'),
            carFilter: document.getElementById('carFilter'),
            chargingSessionsTableBody: document.getElementById('chargingSessionsTableBody'),
            chargingSessionsEmptyRow: document.getElementById('chargingSessionsEmptyRow'),
            chargingSessionsOutput: document.getElementById('chargingSessionsOutput'),
            panelButtons: Array.from(document.querySelectorAll('[data-panel-target]')),
            contentPanels: Array.from(document.querySelectorAll('[data-panel]'))
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
        this.cars = new Map();
        this.sessions = [];
        this.activePanel = null;
        this.easterEggClickCount = 0;
        this.easterEggClickResetTimer = null;
        this.easterEggGame = {
            running: false,
            frameId: null,
            player: { x: 30, y: 30, size: 16, speed: 3.2 },
            target: { x: 200, y: 140, size: 10 },
            score: 0,
            keys: {}
        };
        this.chargerColumns = [
            { key: 'id', label: 'ID', hidden: true },
            { key: 'name', label: 'Name' },
            { key: 'assignedCar', label: 'Car' },
            { key: 'energyManagerMode', label: 'Energy manager mode' },
            { key: 'connected', label: 'Connected' },
            { key: 'status', label: 'Status' },
            { key: 'chargingCurrent', label: 'Charging current' },
            { key: 'currentPower', label: 'Current power' },
            { key: 'version', label: 'Version' },
            { key: 'sessionEnergy', label: 'Session energy' },
            { key: 'temperature', label: 'Temperature' },
            { key: 'chargingPhases', label: 'Charging phases' },
            { key: 'digitalInputMode', label: 'Digital input' }
        ];

        this.renderStaticTemplates();
        this.attachEventListeners();
        this.initializePanelNavigation();
        this.restoreSession();
        this.toggleChargerEmptyState();
        this.updateCarSelector();
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

        if (this.elements.fetchSessionsButton) {
            this.elements.fetchSessionsButton.addEventListener('click', () => {
                this.fetchChargingSessions();
            });
        }

        if (this.elements.carFilter) {
            this.elements.carFilter.addEventListener('change', () => {
                const carId = this.elements.carFilter.value;
                if (carId)
                    this.fetchChargingSessions();
            });
        }

        if (this.elements.downloadSessionsButton) {
            this.elements.downloadSessionsButton.addEventListener('click', () => {
                this.downloadChargingSessionsCsv();
            });
        }

        if (this.elements.brandLogo) {
            this.elements.brandLogo.addEventListener('click', () => {
                this.handleBrandLogoClick();
            });
        }

        if (this.elements.easterEggClose) {
            this.elements.easterEggClose.addEventListener('click', () => {
                this.stopEasterEggGame();
            });
        }

        if (this.elements.easterEggOverlay) {
            this.elements.easterEggOverlay.addEventListener('click', event => {
                if (event.target === this.elements.easterEggOverlay)
                    this.stopEasterEggGame();
            });
        }
    }

    initializePanelNavigation() {
        const buttons = Array.isArray(this.elements.panelButtons) ? this.elements.panelButtons : [];
        const panels = Array.isArray(this.elements.contentPanels) ? this.elements.contentPanels : [];
        if (!buttons.length || !panels.length)
            return;

        const activatePanel = target => {
            if (!target)
                return;

            const hasTarget = panels.some(panel => panel.dataset.panel === target);
            if (!hasTarget)
                return;

            this.activePanel = target;
            panels.forEach(panel => {
                const isActive = panel.dataset.panel === target;
                panel.classList.toggle('active', isActive);
                panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
            });

            buttons.forEach(button => {
                const isActive = button.dataset.panelTarget === target;
                button.classList.toggle('active', isActive);
                button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            });

            const desiredHash = `#${target}`;
            if (window.location.hash !== desiredHash) {
                try {
                    window.history.replaceState(null, '', desiredHash);
                } catch (error) {
                    window.location.hash = target;
                }
            }
        };

        buttons.forEach(button => {
            button.addEventListener('click', () => {
                activatePanel(button.dataset.panelTarget);
            });
        });

        const hashPanel = this.normalizePanelTargetFromHash(window.location.hash);
        const preselected = buttons.find(button => button.classList.contains('active'));
        const fallback = buttons[0];
        const initialTarget = hashPanel
            || (preselected ? preselected.dataset.panelTarget : null)
            || (fallback ? fallback.dataset.panelTarget : null);

        if (initialTarget)
            activatePanel(initialTarget);

        window.addEventListener('hashchange', () => {
            const target = this.normalizePanelTargetFromHash(window.location.hash);
            if (target && target !== this.activePanel)
                activatePanel(target);
        });
    }

    normalizePanelTargetFromHash(hash) {
        if (!hash || hash.length < 2)
            return null;

        const lookup = hash.replace('#', '').trim().toLowerCase();
        if (!lookup)
            return null;

        const panels = Array.isArray(this.elements.contentPanels) ? this.elements.contentPanels : [];
        const match = panels.find(panel => {
            const id = panel.dataset.panel || '';
            return id.toLowerCase() === lookup;
        });

        return match ? match.dataset.panel : null;
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
        this.cars.clear();
        this.resetChargerTable();
        this.updateCarSelector();
        this.renderChargingSessions([], 'No charging sessions fetched yet.');

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

        if (type === 'getcars') {
            if (data.success) {
                const payload = data && data.payload ? data.payload : {};
                const cars = Array.isArray(payload.cars) ? payload.cars : [];
                this.processCarList(cars);
            } else if (data.error === 'unauthenticated') {
                this.onAuthenticationFailed('unauthenticated');
            } else {
                console.warn('GetCars request failed', data.error || 'unknownError');
            }
            return true;
        }

        if (type === 'getchargingsessions') {
            if (data.success) {
                const payload = data && data.payload ? data.payload : {};
                const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
                this.renderChargingSessions(sessions, 'No charging sessions found.');
            } else if (data.error === 'unauthenticated') {
                this.onAuthenticationFailed('unauthenticated');
            } else {
                console.warn('GetChargingSessions request failed', data.error || 'unknownError');
                this.renderChargingSessions([], 'Failed to fetch charging sessions.');
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

        if (Array.isArray(payload.cars)) {
            this.processCarList(payload.cars);
            return true;
        }

        if (Array.isArray(payload.sessions)) {
            this.renderChargingSessions(payload.sessions);
            return true;
        }

        if (payload.charger) {
            this.upsertCharger(payload.charger);
            return true;
        }

        if (payload.car) {
            this.upsertCar(payload.car);
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
        case 'caradded':
        case 'carchanged':
            this.upsertCar(payload);
            return true;
        case 'carremoved':
            this.removeCar(payload);
            return true;
        case 'chargingsessionsupdated':
            if (payload && Array.isArray(payload.sessions))
                this.renderChargingSessions(payload.sessions);
            return true;
        default:
            return false;
        }
    }

    onAuthenticationSucceeded() {
        this.updateConnectionStatus('Connected', 'connected');
        this.updateSessionUser();
        this.sendGetCars();
        this.sendGetChargers();
        this.fetchChargingSessions();
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

    sendGetCars() {
        return this.sendAction('GetCars', { });
    }

    sendGetChargers() {
        return this.sendAction('GetChargers', { });
    }

    fetchChargingSessions() {
        const payload = {};
        const carId = this.elements.carFilter ? this.elements.carFilter.value : '';
        if (carId)
            payload.carId = carId;

        const requestId = this.sendAction('GetChargingSessions', payload);
        if (!requestId)
            this.renderChargingSessions([], 'Unable to request charging sessions. Check the connection status.');

        return requestId;
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

    processCarList(cars = []) {
        if (!Array.isArray(cars)) {
            console.warn('Expected cars array in payload.');
            return;
        }

        const seen = new Set();
        cars.forEach(car => {
            const key = this.getCarKey(car);
            if (!key)
                return;
            seen.add(key);
            this.upsertCar(car);
        });

        for (const existingId of Array.from(this.cars.keys())) {
            if (!seen.has(existingId))
                this.removeCar(existingId);
        }
    }

    upsertCar(car) {
        const key = this.getCarKey(car);
        if (!key)
            return;

        const hasExisting = this.cars.has(key);
        const previous = hasExisting ? this.cars.get(key) : {};
        const merged = { ...previous, ...car };
        merged.thingId = key;
        this.cars.set(key, merged);
        this.updateCarSelector();
    }

    removeCar(identifier) {
        const key = this.getCarKey(identifier);
        if (!key)
            return;

        this.cars.delete(key);
        this.updateCarSelector();
    }

    getCarKey(source) {
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

    updateCarSelector() {
        const select = this.elements.carFilter;
        if (!select)
            return;

        const currentValue = select.value;
        while (select.options.length > 0)
            select.remove(0);

        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'All cars';
        select.appendChild(defaultOption);

        const cars = Array.from(this.cars.values())
            .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));

        cars.forEach(car => {
            const option = document.createElement('option');
            option.value = this.getCarKey(car) || '';
            option.textContent = car.name || option.value;
            select.appendChild(option);
        });

        const hasValue = currentValue && select.querySelector
            && typeof CSS !== 'undefined' && CSS.escape
            && select.querySelector(`option[value="${CSS.escape(currentValue)}"]`);

        select.value = hasValue ? currentValue : '';
    }

    formatNumber(value, unit) {
        if (!Number.isFinite(value))
            return '—';

        const rounded = Number.parseFloat(value.toFixed(2));
        return unit ? `${rounded} ${unit}` : String(rounded);
    }

    formatChargerValue(key, value) {
        if (value === null || value === undefined || value === '')
            return '—';

        if (key === 'energyManagerMode') {
            const modes = {
                0: 'Quick',
                1: 'Eco',
                2: 'Eco + Time'
            };
            if (value in modes)
                return modes[value];
            return Number.isFinite(value) ? `Unknown (${value})` : '—';
        }

        if (key === 'digitalInputMode') {
            const modes = {
                0: 'Charging allowed',
                1: 'Charging allowed inverted',
                2: 'PWM and S0 signaling',
                3: 'Limit and S0 signaling'
            };
            if (value in modes)
                return modes[value];
            return Number.isFinite(value) ? `Unknown (${value})` : '—';
        }

        if ((key === 'currentPower' || key === 'sessionEnergy') && typeof value === 'number') {
            const unit = key === 'currentPower' ? 'kW' : 'kWh';
            if (key === 'currentPower')
                return this.formatNumber(value / 1000, unit);

            return this.formatNumber(value, unit);
        }

        if (typeof value === 'boolean')
            return value ? 'Yes' : 'No';

        if (typeof value === 'number')
            return this.formatNumber(value);

        if (typeof value === 'string')
            return value;

        try {
            return JSON.stringify(value);
        } catch (error) {
            console.warn(`Failed to stringify value for ${key}`, error);
            return '—';
        }
    }

    renderChargingSessions(sessions, fallbackMessage) {
        const normalizedSessions = Array.isArray(sessions) ? sessions : [];
        this.sessions = normalizedSessions;

        this.renderChargingSessionsTable(normalizedSessions, fallbackMessage);

        if (!this.elements.chargingSessionsOutput)
            return;

        if (!normalizedSessions.length) {
            this.elements.chargingSessionsOutput.textContent = fallbackMessage || 'No charging sessions found.';
            return;
        }

        try {
            this.elements.chargingSessionsOutput.textContent = JSON.stringify(normalizedSessions, null, 2);
        } catch (error) {
            console.warn('Failed to render charging sessions', error);
            this.elements.chargingSessionsOutput.textContent = 'Unable to display charging sessions.';
        }
    }

    renderChargingSessionsTable(sessions, fallbackMessage) {
        const body = this.elements.chargingSessionsTableBody;
        const emptyRow = this.elements.chargingSessionsEmptyRow;
        if (!body)
            return;

        const rows = body.querySelectorAll('tr[data-session-id]');
        rows.forEach(row => {
            if (row.parentElement)
                row.parentElement.removeChild(row);
        });

        if (!Array.isArray(sessions) || !sessions.length) {
            if (emptyRow) {
                const cell = emptyRow.querySelector('td');
                if (cell)
                    cell.textContent = fallbackMessage || 'No charging sessions fetched yet.';
                emptyRow.classList.remove('hidden');
            }
            return;
        }

        if (emptyRow)
            emptyRow.classList.add('hidden');

        sessions.forEach(session => {
            body.appendChild(this.buildChargingSessionRow(session));
        });
    }

    buildChargingSessionRow(session) {
        const row = document.createElement('tr');
        row.dataset.sessionId = session && session.sessionId ? session.sessionId : '';

        const cells = [
            this.deriveSessionName(session),
            session && session.chargerName ? session.chargerName : '—',
            session && session.carName ? session.carName : '—',
            this.formatTimestamp(session ? session.startTimestamp : null),
            this.formatTimestamp(session ? session.endTimestamp : null),
            this.formatSessionEnergy(session)
        ];

        cells.forEach((value, index) => {
            const cell = document.createElement('td');
            if (index === 5)
                cell.classList.add('numeric');
            cell.textContent = value;
            row.appendChild(cell);
        });

        return row;
    }

    deriveSessionName(session) {
        if (!session)
            return '—';

        if (session.name)
            return session.name;

        if (session.property)
            return session.property;

        if (session.sessionId)
            return `Session ${session.sessionId}`;

        return '—';
    }

    formatTimestamp(timestamp) {
        const numeric = typeof timestamp === 'string' ? Number.parseFloat(timestamp) : timestamp;
        if (!Number.isFinite(numeric))
            return '—';

        const ms = numeric > 1e12 ? numeric : numeric * 1000;
        const date = new Date(ms);
        if (Number.isNaN(date.getTime()))
            return '—';

        const pad = value => String(value).padStart(2, '0');
        const day = pad(date.getDate());
        const month = pad(date.getMonth() + 1);
        const year = date.getFullYear();
        const hours = pad(date.getHours());
        const minutes = pad(date.getMinutes());

        return `${day}.${month}.${year} ${hours}:${minutes}`;
    }

    formatSessionEnergy(session) {
        const value = session && Number.isFinite(session.sessionEnergy)
            ? session.sessionEnergy
            : this.calculateSessionEnergyFromRange(session);
        if (!Number.isFinite(value))
            return '—';

        return `${value.toFixed(2)} kWh`;
    }

    calculateSessionEnergyFromRange(session) {
        if (!session)
            return null;

        const end = typeof session.energyEnd === 'string' ? Number.parseFloat(session.energyEnd) : session.energyEnd;
        const start = typeof session.energyStart === 'string' ? Number.parseFloat(session.energyStart) : session.energyStart;

        if (!Number.isFinite(end) || !Number.isFinite(start))
            return null;

        return end - start;
    }

    downloadChargingSessionsCsv() {
        const sessions = Array.isArray(this.sessions) ? this.sessions : [];
        if (!sessions.length) {
            console.warn('No charging sessions to download.');
            return;
        }

        const csvContent = this.buildSessionsCsv(sessions);
        if (!csvContent) {
            console.warn('Failed to build CSV for charging sessions.');
            return;
        }

        const carId = this.elements.carFilter ? this.elements.carFilter.value : '';
        const carName = carId && this.cars.has(carId) ? this.cars.get(carId).name : '';
        const carSuffix = carName ? `-${this.sanitizeFilename(carName)}` : '';
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `charging-sessions${carSuffix}-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }, 0);
    }

    buildSessionsCsv(sessions) {
        if (!Array.isArray(sessions) || !sessions.length)
            return '';

        const columns = [
            { label: 'Session ID', key: 'sessionId' },
            { label: 'Charger name', key: 'chargerName' },
            { label: 'Charger serial number', key: 'chargerSerialNumber' },
            { label: 'Car', key: 'carName' },
            { label: 'Start', key: 'startTimestamp', formatter: value => this.formatCsvTimestamp(value) },
            { label: 'End', key: 'endTimestamp', formatter: value => this.formatCsvTimestamp(value) },
            { label: 'Energy [kWh]', key: 'sessionEnergy' },
            { label: 'Meter start [kWh]', key: 'energyStart' },
            { label: 'Meter end [kWh]', key: 'energyEnd' }
        ];

        const lines = [];
        lines.push(columns.map(column => column.label).join(';'));
        sessions.forEach(session => {
            const row = columns.map(column => {
                const raw = session ? session[column.key] : '';
                const formatted = typeof column.formatter === 'function'
                    ? column.formatter(raw)
                    : this.formatCsvPrimitive(raw);
                return this.escapeCsvValue(formatted);
            });
            lines.push(row.join(';'));
        });

        return lines.join('\n');
    }

    formatCsvPrimitive(value) {
        if (value === null || value === undefined)
            return '';

        if (typeof value === 'number')
            return Number.isFinite(value) ? String(value) : '';

        if (typeof value === 'string') {
            const trimmed = value.trim();
            return trimmed.length ? trimmed : '';
        }

        if (Array.isArray(value)) {
            if (!value.length)
                return '';
            try {
                return JSON.stringify(value);
            } catch (error) {
                return '';
            }
        }

        if (typeof value === 'object') {
            if (!Object.keys(value).length)
                return '';
            try {
                return JSON.stringify(value);
            } catch (error) {
                return '';
            }
        }

        return String(value);
    }

    formatCsvTimestamp(value) {
        const numeric = typeof value === 'string' ? Number.parseFloat(value) : value;
        if (!Number.isFinite(numeric))
            return '';

        const ms = numeric > 1e12 ? numeric : numeric * 1000;
        const date = new Date(ms);
        if (Number.isNaN(date.getTime()))
            return '';

        const pad = part => String(part).padStart(2, '0');
        const day = pad(date.getDate());
        const month = pad(date.getMonth() + 1);
        const year = date.getFullYear();
        const hours = pad(date.getHours());
        const minutes = pad(date.getMinutes());

        return `${day}.${month}.${year} ${hours}:${minutes}`;
    }

    escapeCsvValue(value) {
        if (value === null || value === undefined)
            return '';

        if (typeof value === 'number' && !Number.isFinite(value))
            return '';

        if (typeof value === 'object') {
            try {
                value = JSON.stringify(value);
            } catch (error) {
                value = String(value);
            }
        }

        let stringValue = String(value);
        if (stringValue.includes('"'))
            stringValue = stringValue.replace(/"/g, '""');

        if (stringValue.search(/[;\n"]/g) !== -1)
            stringValue = `"${stringValue}"`;

        return stringValue;
    }

    handleBrandLogoClick() {
        clearTimeout(this.easterEggClickResetTimer);
        this.easterEggClickCount += 1;
        this.easterEggClickResetTimer = setTimeout(() => {
            this.easterEggClickCount = 0;
        }, 1200);

        if (this.easterEggClickCount >= 10) {
            this.easterEggClickCount = 0;
            this.startEasterEggGame();
        }
    }

    startEasterEggGame() {
        if (!this.elements.easterEggOverlay || !this.elements.easterEggCanvas)
            return;

        this.elements.easterEggOverlay.classList.remove('hidden');
        this.elements.easterEggOverlay.setAttribute('aria-hidden', 'false');

        const game = this.easterEggGame;
        const canvas = this.elements.easterEggCanvas;
        game.running = true;
        game.score = 0;
        game.keys = {};
        game.lastTime = null;
        game.player.x = canvas.width * 0.2;
        game.player.y = canvas.height * 0.5;
        this.spawnEasterEggTarget();
        this.updateEasterEggScore();
        this.toggleEasterEggListeners(true);

        const loop = timestamp => {
            if (!game.running)
                return;

            if (!game.lastTime)
                game.lastTime = timestamp;
            const delta = Math.min((timestamp - game.lastTime) / 16.67, 3);
            game.lastTime = timestamp;

            this.updateEasterEggPhysics(delta);
            this.drawEasterEggFrame();
            game.frameId = window.requestAnimationFrame(loop);
        };

        game.frameId = window.requestAnimationFrame(loop);
    }

    stopEasterEggGame() {
        const game = this.easterEggGame;
        game.running = false;
        game.keys = {};
        if (game.frameId) {
            window.cancelAnimationFrame(game.frameId);
            game.frameId = null;
        }

        if (this.elements.easterEggOverlay) {
            this.elements.easterEggOverlay.classList.add('hidden');
            this.elements.easterEggOverlay.setAttribute('aria-hidden', 'true');
        }

        this.toggleEasterEggListeners(false);
    }

    toggleEasterEggListeners(enable) {
        if (!this._easterEggKeyDownHandler) {
            this._easterEggKeyDownHandler = event => this.handleEasterEggKey(event, true);
            this._easterEggKeyUpHandler = event => this.handleEasterEggKey(event, false);
        }

        if (enable) {
            document.addEventListener('keydown', this._easterEggKeyDownHandler);
            document.addEventListener('keyup', this._easterEggKeyUpHandler);
        } else {
            document.removeEventListener('keydown', this._easterEggKeyDownHandler);
            document.removeEventListener('keyup', this._easterEggKeyUpHandler);
        }
    }

    handleEasterEggKey(event, isDown) {
        if (!this.easterEggGame.running)
            return;

        const key = event.key ? event.key.toLowerCase() : '';
        const movableKeys = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'];
        if (key === 'escape') {
            this.stopEasterEggGame();
            return;
        }

        if (movableKeys.includes(key)) {
            event.preventDefault();
            this.easterEggGame.keys[key] = isDown;
        }
    }

    updateEasterEggPhysics(delta) {
        const canvas = this.elements.easterEggCanvas;
        if (!canvas)
            return;

        const game = this.easterEggGame;
        const { player, target } = game;
        const input = {
            x: (game.keys.arrowright || game.keys.d ? 1 : 0) - (game.keys.arrowleft || game.keys.a ? 1 : 0),
            y: (game.keys.arrowdown || game.keys.s ? 1 : 0) - (game.keys.arrowup || game.keys.w ? 1 : 0)
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
            game.score += 1;
            player.speed = Math.min(player.speed + 0.15, 7.5);
            this.updateEasterEggScore();
            this.spawnEasterEggTarget();
        }
    }

    drawEasterEggFrame() {
        const canvas = this.elements.easterEggCanvas;
        if (!canvas)
            return;

        const ctx = canvas.getContext('2d');
        const game = this.easterEggGame;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        gradient.addColorStop(0, '#0f1c3d');
        gradient.addColorStop(1, '#092037');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        for (let x = 20; x < canvas.width; x += 40) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }
        for (let y = 20; y < canvas.height; y += 40) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
        }

        const { player, target } = game;
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

    spawnEasterEggTarget() {
        const canvas = this.elements.easterEggCanvas;
        if (!canvas)
            return;

        const target = this.easterEggGame.target;
        const player = this.easterEggGame.player;
        const padding = target.size + 12;
        let attempts = 0;
        do {
            target.x = padding + Math.random() * (canvas.width - padding * 2);
            target.y = padding + Math.random() * (canvas.height - padding * 2);
            attempts++;
        } while (Math.hypot(player.x - target.x, player.y - target.y) < player.size * 2 && attempts < 12);
    }

    updateEasterEggScore() {
        if (!this.elements.easterEggScore)
            return;
        this.elements.easterEggScore.textContent = `Score: ${this.easterEggGame.score}`;
    }

    sanitizeFilename(value) {
        if (typeof value !== 'string')
            return '';

        const trimmed = value.trim();
        if (!trimmed.length)
            return '';

        return trimmed
            .replace(/[^a-z0-9-_]+/gi, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .toLowerCase();
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
        if (!body)
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
