class DashboardApp {
    constructor() {
        this.translations = window.EvDashTranslations || {};
        this.locale = this.resolveLocale(Object.keys(this.translations));

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
            backendVersion: document.getElementById('backendVersion'),
            dashboardVersion: document.getElementById('dashboardVersion'),
            copyrightYear: document.getElementById('copyrightYear'),
            logoutButton: document.getElementById('logoutButton'),
            easterEggOverlay: document.getElementById('easterEggOverlay'),
            easterEggCanvas: document.getElementById('easterEggCanvas'),
            easterEggClose: document.getElementById('easterEggClose'),
            easterEggScore: document.getElementById('easterEggScore'),
            chargerTableBody: document.getElementById('chargerTableBody'),
            chargerEmptyRow: document.getElementById('chargerEmptyRow'),
            fetchSessionsButton: document.getElementById('fetchSessionsButton'),
            downloadSessionsButton: document.getElementById('downloadSessionsButton'),
            chargerFilter: document.getElementById('chargerFilter'),
            carFilter: document.getElementById('carFilter'),
            userFilter: document.getElementById('userFilter'),
            sessionStartFilter: document.getElementById('sessionStartFilter'),
            sessionEndFilter: document.getElementById('sessionEndFilter'),
            chargingSessionsTableBody: document.getElementById('chargingSessionsTableBody'),
            chargingSessionsEmptyRow: document.getElementById('chargingSessionsEmptyRow'),
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
        this.expandedChargers = new Set();
        this.cars = new Map();
        this.sessions = [];
        this.activePanel = null;
        this.easterEggClickCount = 0;
        this.easterEggClickResetTimer = null;
        this.easterEggGame = new EasterEggGame({
            overlay: this.elements.easterEggOverlay,
            canvas: this.elements.easterEggCanvas,
            closeButton: this.elements.easterEggClose,
            scoreLabel: this.elements.easterEggScore
        }, (key, variables) => this.t(key, variables));
        this.chargerColumns = [
            { key: 'id', label: 'ID', hidden: true },
            { key: 'name', label: 'Name' },
            { key: 'assignedCar', label: 'Car' },
            { key: 'energyManagerMode', label: 'Energy manager mode' },
            { key: 'connected', label: 'Reachable' },
            { key: 'status', label: 'Status' },
            { key: 'chargingCurrent', label: 'Charging current' },
            { key: 'chargingPhases', label: 'Charging phases' },
            { key: 'currentPower', label: 'Current power' },
            { key: 'sessionEnergy', label: 'Session energy' }
        ];

        this.translateDocument();
        this.attachEventListeners();
        this.initializePanelNavigation();
        this.restoreSession();
        this.toggleChargerEmptyState();
        this.updateChargerSelector();
        this.updateCarSelector();
        this.updateUserSelector([]);
    }

    resolveLocale(availableLocales) {
        const normalize = value => (typeof value === 'string' ? value.trim().toLowerCase() : '');
        const matchLocale = normalized => {
            if (!normalized)
                return null;
            return availableLocales.find(locale => normalized === locale || normalized.startsWith(`${locale}-`)) || null;
        };

        const overrideKey = 'evdash.language';
        try {
            const match = matchLocale(normalize(window.localStorage.getItem(overrideKey)));
            if (match)
                return match;
        } catch (error) {
            // ignore
        }

        const candidates = Array.isArray(navigator.languages) && navigator.languages.length
            ? navigator.languages
            : [navigator.language || 'en'];

        for (const candidate of candidates) {
            const match = matchLocale(normalize(candidate));
            if (match)
                return match;
        }

        return availableLocales.includes('en') ? 'en' : availableLocales[0];
    }

    t(key, variables) {
        const locale = this.locale in this.translations ? this.locale : 'en';
        const table = this.translations[locale] || {};
        const fallback = this.translations.en || {};
        let text = (key && key in table) ? table[key] : (key in fallback ? fallback[key] : String(key));

        if (variables && typeof variables === 'object') {
            Object.entries(variables).forEach(([name, value]) => {
                text = text.replaceAll(`{${name}}`, value === undefined || value === null ? '' : String(value));
            });
        }

        return text;
    }

    translateDocument() {
        try {
            document.documentElement.lang = this.locale;
        } catch (error) {
            // ignore
        }

        const nodes = document.querySelectorAll('[data-i18n]');
        nodes.forEach(node => {
            const key = node.dataset.i18n;
            if (!key)
                return;
            const attr = node.dataset.i18nAttr;
            const text = this.t(key);
            if (attr)
                node.setAttribute(attr, text);
            else if (node.dataset.i18nMode === 'html')
                node.innerHTML = text;
            else
                node.textContent = text;
        });
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

        if (this.elements.chargerFilter) {
            this.elements.chargerFilter.addEventListener('change', () => {
                this.fetchChargingSessions();
            });
        }

        if (this.elements.carFilter) {
            this.elements.carFilter.addEventListener('change', () => {
                this.fetchChargingSessions();
            });
        }

        if (this.elements.userFilter) {
            this.elements.userFilter.addEventListener('change', () => {
                this.renderChargingSessionsTable(this.sessions);
            });
        }

        if (this.elements.downloadSessionsButton) {
            this.elements.downloadSessionsButton.addEventListener('click', () => {
                this.downloadChargingSessionsCsv();
            });
        }

        if (this.elements.sessionStartFilter) {
            this.elements.sessionStartFilter.addEventListener('change', () => {
                this.renderChargingSessionsTable(this.sessions);
            });
        }

        if (this.elements.sessionEndFilter) {
            this.elements.sessionEndFilter.addEventListener('change', () => {
                this.renderChargingSessionsTable(this.sessions);
            });
        }

        if (this.elements.brandLogo) {
            this.elements.brandLogo.addEventListener('click', () => {
                this.handleBrandLogoClick();
            });
        }

        if (this.elements.chargerTableBody) {
            this.elements.chargerTableBody.addEventListener('click', event => {
                const targetRow = event.target ? event.target.closest('tr[data-charger-id]') : null;
                if (!targetRow || !targetRow.dataset || !targetRow.dataset.chargerId)
                    return;
                this.toggleChargerDetails(targetRow.dataset.chargerId);
            });

            this.elements.chargerTableBody.addEventListener('keydown', event => {
                if (!event || (event.key !== 'Enter' && event.key !== ' '))
                    return;

                const targetRow = event.target ? event.target.closest('tr[data-charger-id]') : null;
                if (!targetRow || !targetRow.dataset || !targetRow.dataset.chargerId)
                    return;

                event.preventDefault();
                this.toggleChargerDetails(targetRow.dataset.chargerId);
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
                this.showLoginOverlay(this.t('connection.sessionExpiredRestore'));
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
            this.showLoginOverlay(this.t('connection.restoreFailed'));
        }
    }

    submitLogin() {
        if (!this.elements.username || !this.elements.password || !this.elements.loginButton)
            return;

        const username = this.elements.username.value.trim();
        const password = this.elements.password.value;

        if (!username || !password) {
            this.showLoginError(this.t('login.emptyCredentials'));
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
                const message = error && error.message ? error.message : this.t('login.failed');
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
            throw new Error(this.t('login.networkError'));
        }

        let data;
        try {
            data = await response.json();
        } catch (parseError) {
            console.warn('Failed to parse login response', parseError);
            throw new Error(this.t('login.unexpectedResponse'));
        }

        if (!response.ok || !data.success) {
            const errorCode = data && data.error ? data.error : 'unauthorized';
            throw new Error(this.describeLoginError(errorCode));
        }

        if (!data.token || !data.expiresAt)
            throw new Error(this.t('login.invalidResponse'));

        return {
            token: data.token,
            expiresAt: data.expiresAt
        };
    }

    describeLoginError(code) {
        switch (code) {
        case 'invalidRequest':
            return this.t('login.invalidRequest');
        case 'unauthorized':
            return this.t('login.unauthorized');
        default:
            return this.t('login.failed');
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
        this.renderChargingSessions([], this.t('sessions.emptyFetched'));
        this.updateBuildMetadata();

        try {
            window.localStorage.removeItem(this.sessionKey);
        } catch (error) {
            console.warn('Failed to clear session', error);
        }

        this.updateSessionUser();
    }

    connectWebSocket(resetPending = false) {
        if (!this.token) {
            this.updateConnectionStatus(this.t('header.awaitingLogin'), 'connecting');
            return;
        }

        if (this.tokenExpiry && this.tokenExpiry <= new Date()) {
            this.clearSession();
            this.showLoginOverlay(this.t('connection.sessionExpiredRestore'));
            return;
        }

        if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING))
            return;

        if (resetPending)
            this.pendingRequests.clear();

        clearTimeout(this.reconnectTimer);
        this.updateConnectionStatus(this.t('connection.connecting'), 'connecting');
        const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
        const host = window.location.hostname || 'localhost';
        const port = 4449;
        const normalizedHost = host.includes(':') ? `[${host}]` : host;
        const url = `${protocol}${normalizedHost}:${port}`;

        this.socket = new WebSocket(url);
        this.socket.addEventListener('open', () => {
            this.updateConnectionStatus(this.t('connection.authenticating'), 'authenticating');
            this.sendAuthenticate();
        });

        this.socket.addEventListener('message', event => {
            this.onSocketMessage(event);
        });

        this.socket.addEventListener('error', () => {
            this.updateConnectionStatus(this.t('connection.error'), 'error');
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
            return;
        }

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
                this.onAuthenticationSucceeded(data.payload || {});
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
                this.renderChargingSessions(sessions, this.t('sessions.noneFound'));
            } else if (data.error === 'unauthenticated') {
                this.onAuthenticationFailed('unauthenticated');
            } else {
                console.warn('GetChargingSessions request failed', data.error || 'unknownError');
                this.renderChargingSessions([], this.t('sessions.fetchFailed'));
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

    onAuthenticationSucceeded(payload) {
        this.updateBuildMetadata(payload);
        this.updateConnectionStatus(this.t('connection.connected'), 'connected');
        this.updateSessionUser();
        this.sendGetCars();
        this.sendGetChargers();
        this.fetchChargingSessions();
    }

    updateBuildMetadata(payload = {}) {
        const metadata = payload && typeof payload === 'object' ? payload : {};
        if (this.elements.backendVersion)
            this.elements.backendVersion.textContent = this.formatSessionText(metadata.backendVersion) || '—';
        if (this.elements.dashboardVersion)
            this.elements.dashboardVersion.textContent = this.formatSessionText(metadata.dashboardVersion) || '—';
        if (this.elements.copyrightYear)
            this.elements.copyrightYear.textContent = this.formatSessionText(metadata.copyrightYear) || '—';
    }

    onAuthenticationFailed(reason) {
        const message = reason === 'unauthenticated'
            ? this.t('connection.sessionExpired')
            : this.t('connection.authFailed');

        console.warn('Authentication failed', reason);
        this.clearSession();
        this.showLoginOverlay(message);
        this.updateConnectionStatus(this.t('connection.authenticationRequired'), 'error');

        if (this.socket && this.socket.readyState === WebSocket.OPEN)
            this.socket.close();
    }

    onSocketClosed() {
        this.pendingRequests.clear();
        this.updateConnectionStatus(this.t('connection.disconnected'), 'error');
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
        const chargerId = this.elements.chargerFilter ? this.elements.chargerFilter.value : '';
        if (chargerId)
            payload.chargerId = chargerId;

        const carId = this.elements.carFilter ? this.elements.carFilter.value : '';
        if (carId)
            payload.carId = carId;

        const requestId = this.sendAction('GetChargingSessions', payload);
        if (!requestId)
            this.renderChargingSessions([], this.t('sessions.requestFailed'));

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
            this.upsertCharger(charger, { skipSelectorUpdate: true });
        });

        for (const existingId of Array.from(this.chargers.keys())) {
            if (!seen.has(existingId))
                this.removeCharger(existingId, { skipSelectorUpdate: true });
        }

        this.updateChargerSelector();
    }

    upsertCharger(charger, { skipSelectorUpdate = false } = {}) {
        const key = this.getChargerKey(charger);
        if (!key)
            return;

        const hasExisting = this.chargers.has(key);
        const previous = hasExisting ? this.chargers.get(key) : {};
        const merged = { ...previous, ...charger };
        merged.thingId = key;
        this.chargers.set(key, merged);
        if (!skipSelectorUpdate)
            this.updateChargerSelector();
        this.syncChargerRow(merged, !hasExisting);
    }

    syncChargerRow(charger, forceCreate = false) {
        const key = this.getChargerKey(charger);
        if (!charger || !key || !this.elements.chargerTableBody)
            return;

        let row = this.findChargerRow(key);
        if (!row || forceCreate) {
            if (row && row.parentElement) {
                const detailsRow = this.findChargerDetailsRow(key);
                if (detailsRow && detailsRow.parentElement)
                    detailsRow.parentElement.removeChild(detailsRow);
                row.parentElement.removeChild(row);
            }
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

        this.syncChargerDetailsVisibility(key);
        this.toggleChargerEmptyState();
    }

    buildChargerRow(charger) {
        const row = document.createElement('tr');
        row.classList.add('charger-row');
        row.dataset.chargerId = this.getChargerKey(charger) || '';
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.setAttribute('aria-expanded', 'false');
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

    toggleChargerDetails(chargerId) {
        if (!chargerId)
            return;

        const key = this.getChargerKey(chargerId);
        if (!key)
            return;

        if (this.expandedChargers.has(key))
            this.collapseChargerDetails(key);
        else
            this.expandChargerDetails(key);
    }

    expandChargerDetails(chargerId) {
        if (!chargerId)
            return;

        const key = this.getChargerKey(chargerId);
        if (!key)
            return;

        this.expandedChargers.add(key);
        this.syncChargerDetailsVisibility(key);
    }

    collapseChargerDetails(chargerId) {
        if (!chargerId)
            return;

        const key = this.getChargerKey(chargerId);
        if (!key)
            return;

        this.expandedChargers.delete(key);
        this.syncChargerDetailsVisibility(key);
    }

    syncChargerDetailsVisibility(chargerId) {
        if (!chargerId || !this.elements.chargerTableBody)
            return;

        const key = this.getChargerKey(chargerId);
        if (!key)
            return;

        const isExpanded = this.expandedChargers.has(key);
        const row = this.findChargerRow(key);
        if (row) {
            row.classList.toggle('is-expanded', isExpanded);
            row.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
        }

        const detailsRow = this.findChargerDetailsRow(key);
        if (!isExpanded) {
            if (detailsRow && detailsRow.parentElement)
                detailsRow.parentElement.removeChild(detailsRow);
            return;
        }

        if (!row)
            return;

        const ensured = detailsRow || this.buildChargerDetailsRow(key);
        if (ensured && ensured !== detailsRow) {
            this.elements.chargerTableBody.insertBefore(ensured, row.nextSibling);
        }

        this.updateChargerDetailsRow(key);
    }

    buildChargerDetailsRow(chargerId) {
        const row = document.createElement('tr');
        row.classList.add('charger-details-row');
        row.dataset.chargerDetailsFor = this.getChargerKey(chargerId) || '';

        const cell = document.createElement('td');
        cell.colSpan = this.getVisibleChargerColumnCount();
        const list = document.createElement('dl');
        list.className = 'charger-details-list';
        cell.appendChild(list);
        row.appendChild(cell);
        return row;
    }

    updateChargerDetailsRow(chargerId) {
        if (!chargerId)
            return;

        const key = this.getChargerKey(chargerId);
        if (!key || !this.expandedChargers.has(key))
            return;

        const charger = this.chargers && this.chargers.get(key) ? this.chargers.get(key) : null;
        const detailsRow = this.findChargerDetailsRow(key);
        if (!detailsRow)
            return;

        const list = detailsRow.querySelector('dl.charger-details-list');
        if (!list)
            return;

        const items = [
            { label: this.t('chargers.columns.lastStatusUpdate'), key: 'lastStatusUpdate' },
            { label: this.t('chargers.columns.version'), key: 'version' },
            { label: this.t('chargers.columns.temperature'), key: 'temperature' },
            { label: this.t('chargers.columns.digitalInputMode'), key: 'digitalInputMode' }
        ];

        const authorizedUser = this.getAuthorizedUserName(charger);
        if (authorizedUser)
            items.push({ label: this.t('chargers.details.authorizedUser'), value: authorizedUser });

        const authorizedTagHash = this.formatSessionText(charger ? charger.authorizedTagHash : null);
        if (authorizedUser && authorizedTagHash)
            items.push({ label: this.t('chargers.details.authorizedTag'), value: authorizedTagHash });

        list.innerHTML = '';
        items.forEach(item => {
            const term = document.createElement('dt');
            term.textContent = item.label;
            const description = document.createElement('dd');
            const value = Object.prototype.hasOwnProperty.call(item, 'value')
                ? item.value
                : (charger && Object.prototype.hasOwnProperty.call(charger, item.key) ? charger[item.key] : null);
            description.textContent = this.formatChargerValue(item.key, value);
            list.appendChild(term);
            list.appendChild(description);
        });
    }

    findChargerDetailsRow(chargerId) {
        if (!this.elements.chargerTableBody || !chargerId)
            return null;

        const normalizedId = this.escapeAttributeValue(chargerId);
        return this.elements.chargerTableBody.querySelector(`tr[data-charger-details-for="${normalizedId}"]`);
    }

    escapeAttributeValue(value) {
        return typeof CSS !== 'undefined' && CSS.escape
            ? CSS.escape(String(value))
            : String(value).replace(/"/g, '\\"');
    }

    getVisibleChargerColumnCount() {
        return this.chargerColumns.filter(column => !column.hidden).length;
    }

    renderCellValue(cell, key, value) {
        if (!cell)
            return;

        if (typeof value === 'boolean') {
            cell.innerHTML = '';
            const dot = document.createElement('span');
            dot.className = `value-dot ${value ? 'value-dot-true' : 'value-dot-false'}`;
            dot.setAttribute('role', 'img');
            dot.setAttribute('aria-label', value ? this.t('value.true') : this.t('value.false'));
            dot.title = value ? this.t('value.true') : this.t('value.false');
            const srText = document.createElement('span');
            srText.className = 'sr-only';
            srText.textContent = value ? this.t('value.true') : this.t('value.false');
            cell.appendChild(dot);
            cell.appendChild(srText);
            return;
        }

        cell.textContent = this.formatChargerValue(key, value);
    }

    removeCharger(identifier, { skipSelectorUpdate = false } = {}) {
        const key = this.getChargerKey(identifier);
        if (!key)
            return;

        this.expandedChargers.delete(key);
        this.chargers.delete(key);
        const row = this.findChargerRow(key);
        const detailsRow = this.findChargerDetailsRow(key);
        if (row && row.parentElement)
            row.parentElement.removeChild(row);
        if (detailsRow && detailsRow.parentElement)
            detailsRow.parentElement.removeChild(detailsRow);

        if (!skipSelectorUpdate)
            this.updateChargerSelector();
        this.toggleChargerEmptyState();
    }

    resetChargerTable() {
        if (!this.elements.chargerTableBody)
            return;

        this.expandedChargers.clear();
        const rows = this.elements.chargerTableBody.querySelectorAll('tr[data-charger-id], tr[data-charger-details-for]');
        rows.forEach(row => {
            if (row.parentElement)
                row.parentElement.removeChild(row);
        });

        this.toggleChargerEmptyState();
    }

    findChargerRow(chargerId) {
        if (!this.elements.chargerTableBody || !chargerId)
            return null;

        const normalizedId = this.escapeAttributeValue(chargerId);
        return this.elements.chargerTableBody.querySelector(`tr[data-charger-id="${normalizedId}"]`);
    }

    getChargerKey(source) {
        return this.getEntityKey(source);
    }

    getEntityKey(source) {
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

    updateChargerSelector() {
        const chargers = Array.from(this.chargers.values())
            .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));

        this.populateSelect(this.elements.chargerFilter, this.t('sessions.allChargers'), chargers.map(charger => {
            const value = this.getChargerKey(charger) || '';
            return { value, label: charger.name || value };
        }));
    }

    populateSelect(select, defaultLabel, entries) {
        if (!select)
            return;

        const currentValue = select.value;
        while (select.options.length > 0)
            select.remove(0);

        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = defaultLabel;
        select.appendChild(defaultOption);

        entries.forEach(entry => {
            const option = document.createElement('option');
            option.value = entry.value;
            option.textContent = entry.label;
            select.appendChild(option);
        });

        const hasValue = currentValue && entries.some(entry => entry.value === currentValue);
        select.value = hasValue ? currentValue : '';
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
            this.upsertCar(car, { skipSelectorUpdate: true });
        });

        for (const existingId of Array.from(this.cars.keys())) {
            if (!seen.has(existingId))
                this.removeCar(existingId, { skipSelectorUpdate: true });
        }

        this.updateCarSelector();
    }

    upsertCar(car, { skipSelectorUpdate = false } = {}) {
        const key = this.getCarKey(car);
        if (!key)
            return;

        const hasExisting = this.cars.has(key);
        const previous = hasExisting ? this.cars.get(key) : {};
        const merged = { ...previous, ...car };
        merged.thingId = key;
        this.cars.set(key, merged);
        if (!skipSelectorUpdate)
            this.updateCarSelector();
    }

    removeCar(identifier, { skipSelectorUpdate = false } = {}) {
        const key = this.getCarKey(identifier);
        if (!key)
            return;

        this.cars.delete(key);
        if (!skipSelectorUpdate)
            this.updateCarSelector();
    }

    getCarKey(source) {
        return this.getEntityKey(source);
    }

    updateCarSelector() {
        const cars = Array.from(this.cars.values())
            .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));

        this.populateSelect(this.elements.carFilter, this.t('sessions.allCars'), cars.map(car => {
            const value = this.getCarKey(car) || '';
            return { value, label: car.name || value };
        }));
    }

    updateUserSelector(sessions) {
        this.populateSelect(this.elements.userFilter, this.t('sessions.allUsers'), this.collectSessionUserFilterOptions(sessions));
    }

    collectSessionUserFilterOptions(sessions) {
        if (!Array.isArray(sessions) || !sessions.length)
            return [];

        const entries = new Map();
        sessions.forEach(session => {
            const user = this.getSessionUserIdentity(session);
            if (!user)
                return;

            const value = this.createSessionUserFilterValue(user.username);
            if (!entries.has(value)) {
                entries.set(value, {
                    value,
                    label: user.displayName,
                    sortKey: user.displayName.toLowerCase(),
                    hasDisplayName: user.hasDisplayName
                });
            } else if (user.hasDisplayName && !entries.get(value).hasDisplayName) {
                const entry = entries.get(value);
                entry.label = user.displayName;
                entry.sortKey = user.displayName.toLowerCase();
                entry.hasDisplayName = true;
            }
        });

        return Array.from(entries.values()).sort((a, b) =>
            a.sortKey.localeCompare(b.sortKey, undefined, { sensitivity: 'base' }));
    }

    createSessionUserFilterValue(name) {
        return `user:${encodeURIComponent(this.normalizeSessionUserName(name))}`;
    }

    parseSessionUserFilterValue(value) {
        if (!value || typeof value !== 'string')
            return null;

        const separator = value.indexOf(':');
        if (separator <= 0)
            return null;

        const type = value.slice(0, separator);
        if (type !== 'user')
            return null;

        const encodedName = value.slice(separator + 1);
        let name = '';
        try {
            name = decodeURIComponent(encodedName);
        } catch (error) {
            name = encodedName;
        }

        name = this.normalizeSessionUserName(name);
        return name || null;
    }

    formatNumber(value, unit) {
        if (!Number.isFinite(value))
            return '—';

        const rounded = Number.parseFloat(value.toFixed(2));
        return unit ? `${rounded} ${unit}` : String(rounded);
    }

    formatNumberMaxDecimals(value, unit, decimals = 2) {
        if (!Number.isFinite(value))
            return '—';

        const factor = 10 ** decimals;
        const rounded = Math.round(value * factor) / factor;
        let text = rounded.toFixed(decimals).replace(/\.?0+$/, '');
        if (text === '-0')
            text = '0';
        return unit ? `${text} ${unit}` : text;
    }

    coerceFiniteNumber(value) {
        if (typeof value === 'number')
            return Number.isFinite(value) ? value : null;

        if (typeof value !== 'string')
            return null;

        const normalized = value.trim().replace(',', '.');
        if (!normalized)
            return null;

        const parsed = Number.parseFloat(normalized);
        return Number.isFinite(parsed) ? parsed : null;
    }

    formatChargerValue(key, value) {
        if (value === null || value === undefined || value === '')
            return '—';

        if (key === 'status') {
            const code = String(value).trim();
            const statusKeys = {
                Init: 'chargerStatus.Init',
                A1: 'chargerStatus.A1',
                A2: 'chargerStatus.A2',
                B1: 'chargerStatus.B1',
                B2: 'chargerStatus.B2',
                C1: 'chargerStatus.C1',
                C2: 'chargerStatus.C2',
                F: 'chargerStatus.F'
            };
            if (code in statusKeys)
                return `${code}: ${this.t(statusKeys[code])}`;
            return code || '—';
        }

        if (key === 'energyManagerMode') {
            const modes = {
                0: this.t('energyManagerMode.quick'),
                1: this.t('energyManagerMode.eco'),
                2: this.t('energyManagerMode.ecoTime')
            };
            if (value in modes)
                return modes[value];
            return Number.isFinite(value) ? this.t('value.unknownWithValue', { value }) : '—';
        }

        if (key === 'digitalInputMode') {
            const modes = {
                0: this.t('digitalInputMode.chargingAllowed'),
                1: this.t('digitalInputMode.chargingAllowedInverted'),
                2: this.t('digitalInputMode.pwmAndS0'),
                3: this.t('digitalInputMode.limitAndS0')
            };
            if (value in modes)
                return modes[value];
            return Number.isFinite(value) ? this.t('value.unknownWithValue', { value }) : '—';
        }

        if (key === 'lastStatusUpdate')
            return this.formatDateTime(value, { withSeconds: true });

        if (key === 'chargingCurrent' || key === 'currentPower' || key === 'sessionEnergy') {
            const numericValue = this.coerceFiniteNumber(value);
            if (numericValue === null)
                return typeof value === 'string' ? value : '—';

            const unit = key === 'chargingCurrent' ? 'A' : (key === 'currentPower' ? 'kW' : 'kWh');
            if (key === 'chargingCurrent')
                return this.formatNumber(numericValue, unit);

            if (key === 'currentPower')
                return numericValue >= 0 && numericValue < 50 ? `0 ${unit}` : this.formatNumberMaxDecimals(numericValue / 1000, unit, 2);

            return this.formatNumber(numericValue, unit);
        }

        if (typeof value === 'boolean')
            return value ? this.t('value.yes') : this.t('value.no');

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

        this.updateUserSelector(normalizedSessions);
        this.renderChargingSessionsTable(normalizedSessions, fallbackMessage);
    }

    renderChargingSessionsTable(sessions, fallbackMessage) {
        const body = this.elements.chargingSessionsTableBody;
        const emptyRow = this.elements.chargingSessionsEmptyRow;
        if (!body)
            return;

        const normalizedSessions = Array.isArray(sessions) ? sessions : [];
        const filteredSessions = this.filterVisibleChargingSessions(normalizedSessions);
        const hasTimeRangeFilter = this.hasChargingSessionTimeRangeFilter();
        const hasAdditionalFilter = this.hasChargingSessionAdditionalFilter();

        const rows = body.querySelectorAll('tr[data-session-id]');
        rows.forEach(row => {
            if (row.parentElement)
                row.parentElement.removeChild(row);
        });

        if (!normalizedSessions.length || !filteredSessions.length) {
            if (emptyRow) {
                const cell = emptyRow.querySelector('td');
                if (cell) {
                    if (!normalizedSessions.length) {
                        cell.textContent = fallbackMessage || this.t('sessions.emptyFetched');
                    } else if (hasTimeRangeFilter && !hasAdditionalFilter) {
                        cell.textContent = this.t('sessions.noneInRange');
                    } else if (hasTimeRangeFilter || hasAdditionalFilter) {
                        cell.textContent = this.t('sessions.noneMatchingFilters');
                    } else {
                        cell.textContent = fallbackMessage || this.t('sessions.noneFound');
                    }
                }
                emptyRow.classList.remove('hidden');
            }
            return;
        }

        if (emptyRow)
            emptyRow.classList.add('hidden');

        filteredSessions.forEach(session => {
            body.appendChild(this.buildChargingSessionRow(session));
        });
    }

    hasChargingSessionTimeRangeFilter() {
        const start = this.elements.sessionStartFilter ? this.elements.sessionStartFilter.value : '';
        const end = this.elements.sessionEndFilter ? this.elements.sessionEndFilter.value : '';
        return !!start || !!end;
    }

    hasChargingSessionAdditionalFilter() {
        const chargerId = this.elements.chargerFilter ? this.elements.chargerFilter.value : '';
        const carId = this.elements.carFilter ? this.elements.carFilter.value : '';
        const user = this.elements.userFilter ? this.elements.userFilter.value : '';
        return !!chargerId || !!carId || !!user;
    }

    getChargingSessionTimeRangeMs() {
        const startValue = this.elements.sessionStartFilter ? this.elements.sessionStartFilter.value : '';
        const endValue = this.elements.sessionEndFilter ? this.elements.sessionEndFilter.value : '';
        const startMs = this.parseDateInputToMs(startValue, { endOfDay: false });
        const endMs = this.parseDateInputToMs(endValue, { endOfDay: true });

        if (this.elements.sessionStartFilter)
            this.elements.sessionStartFilter.setCustomValidity('');
        if (this.elements.sessionEndFilter)
            this.elements.sessionEndFilter.setCustomValidity('');

        if (Number.isFinite(startMs) && Number.isFinite(endMs) && startMs > endMs) {
            const message = this.t('sessions.startBeforeEnd');
            if (this.elements.sessionStartFilter)
                this.elements.sessionStartFilter.setCustomValidity(message);
            if (this.elements.sessionEndFilter)
                this.elements.sessionEndFilter.setCustomValidity(message);
            return { startMs: null, endMs: null };
        }

        return {
            startMs: Number.isFinite(startMs) ? startMs : null,
            endMs: Number.isFinite(endMs) ? endMs : null
        };
    }

    parseDateInputToMs(value, options = {}) {
        if (!value)
            return null;

        const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match)
            return null;

        const year = Number.parseInt(match[1], 10);
        const month = Number.parseInt(match[2], 10);
        const day = Number.parseInt(match[3], 10);
        if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day))
            return null;

        const date = new Date(year, month - 1, day);
        let ms = date.getTime();
        if (!Number.isFinite(ms))
            return null;

        if (options && options.endOfDay)
            ms += 24 * 60 * 60 * 1000 - 1;

        return ms;
    }

    normalizeTimestampToMs(timestamp) {
        const numeric = typeof timestamp === 'string' ? Number.parseFloat(timestamp) : timestamp;
        if (!Number.isFinite(numeric))
            return null;

        const ms = numeric > 1e12 ? numeric : numeric * 1000;
        return Number.isFinite(ms) ? ms : null;
    }

    formatDateTime(value, { withSeconds = false, fallback = '—' } = {}) {
        const ms = this.normalizeTimestampToMs(value);
        if (ms === null)
            return fallback;

        const date = new Date(ms);
        if (Number.isNaN(date.getTime()))
            return fallback;

        const pad = part => String(part).padStart(2, '0');
        const day = pad(date.getDate());
        const month = pad(date.getMonth() + 1);
        const year = date.getFullYear();
        const hours = pad(date.getHours());
        const minutes = pad(date.getMinutes());
        const time = withSeconds ? `${hours}:${minutes}:${pad(date.getSeconds())}` : `${hours}:${minutes}`;

        return `${day}.${month}.${year} ${time}`;
    }

    filterChargingSessionsByTimeRange(sessions) {
        if (!Array.isArray(sessions) || !sessions.length)
            return [];

        const { startMs, endMs } = this.getChargingSessionTimeRangeMs();
        if (!Number.isFinite(startMs) && !Number.isFinite(endMs))
            return sessions;

        return sessions.filter(session => {
            const sessionStart = this.normalizeTimestampToMs(session ? session.startTimestamp : null);
            const sessionEnd = this.normalizeTimestampToMs(session ? session.endTimestamp : null);
            const effectiveStart = Number.isFinite(sessionStart) ? sessionStart : null;
            const effectiveEnd = Number.isFinite(sessionEnd)
                ? sessionEnd
                : (Number.isFinite(sessionStart) ? sessionStart : null);

            if (!Number.isFinite(effectiveStart) && !Number.isFinite(effectiveEnd))
                return true;

            if (Number.isFinite(startMs) && Number.isFinite(effectiveEnd) && effectiveEnd < startMs)
                return false;

            if (Number.isFinite(endMs) && Number.isFinite(effectiveStart) && effectiveStart > endMs)
                return false;

            return true;
        });
    }

    filterChargingSessionsBySelectedCharger(sessions) {
        if (!Array.isArray(sessions) || !sessions.length)
            return [];

        const chargerId = this.elements.chargerFilter ? this.elements.chargerFilter.value : '';
        if (!chargerId)
            return sessions;

        const selectedCharger = this.chargers.has(chargerId) ? this.chargers.get(chargerId) : null;
        const selectedName = selectedCharger && selectedCharger.name ? String(selectedCharger.name).trim() : '';
        const normalizedSelectedId = this.normalizeSessionChargerIdentifier(chargerId);

        return sessions.filter(session => {
            if (!session || typeof session !== 'object')
                return false;

            const candidateIds = [
                session.chargerId,
                session.chargerThingId,
                session.thingId,
                session.evChargerId
            ];

            if (candidateIds.some(value => this.normalizeSessionChargerIdentifier(value) === normalizedSelectedId))
                return true;

            const sessionChargerName = session.chargerName ? String(session.chargerName).trim() : '';
            return !!selectedName && !!sessionChargerName
                && sessionChargerName.localeCompare(selectedName, undefined, { sensitivity: 'base' }) === 0;
        });
    }

    filterVisibleChargingSessions(sessions) {
        const byCharger = this.filterChargingSessionsBySelectedCharger(sessions);
        const byUser = this.filterChargingSessionsBySelectedUser(byCharger);
        return this.filterChargingSessionsByTimeRange(byUser);
    }

    filterChargingSessionsBySelectedUser(sessions) {
        if (!Array.isArray(sessions) || !sessions.length)
            return [];

        const selectedUser = this.parseSessionUserFilterValue(this.elements.userFilter ? this.elements.userFilter.value : '');
        if (!selectedUser)
            return sessions;

        return sessions.filter(session => {
            const user = this.getSessionUserIdentity(session);
            return user && this.normalizeSessionUserName(user.username) === selectedUser;
        });
    }

    normalizeSessionChargerIdentifier(value) {
        if (value === null || value === undefined)
            return '';

        return String(value).trim().replace(/[{}]/g, '').toLowerCase();
    }

    normalizeSessionUserName(value) {
        if (value === null || value === undefined)
            return '';

        return String(value).trim().toLowerCase();
    }

    buildChargingSessionRow(session) {
        const row = document.createElement('tr');
        row.dataset.sessionId = session && session.sessionId ? session.sessionId : '';

        const textCells = [
            this.deriveSessionName(session),
            session && session.chargerName ? session.chargerName : '—',
            session && session.carName ? session.carName : '—',
            this.formatTimestamp(session ? session.startTimestamp : null),
            this.formatTimestamp(session ? session.endTimestamp : null),
            this.formatSessionEnergy(session)
        ];

        textCells.slice(0, 3).forEach(value => {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.appendChild(cell);
        });

        row.appendChild(this.buildSessionUserCell(session));

        textCells.slice(3).forEach((value, index) => {
            const cell = document.createElement('td');
            if (index === 2)
                cell.classList.add('numeric');
            cell.textContent = value;
            row.appendChild(cell);
        });

        return row;
    }

    buildSessionUserCell(session) {
        const cell = document.createElement('td');
        const user = this.getSessionUserIdentity(session);
        if (!user) {
            cell.textContent = '—';
            return cell;
        }

        const wrapper = document.createElement('span');
        wrapper.className = 'session-attribution';
        if (user.method === 'rfid') {
            wrapper.title = this.t('sessions.rfidIconLabel');
            wrapper.appendChild(this.createRfidIcon());
        } else {
            wrapper.title = this.t('sessions.manualIconLabel');
            wrapper.appendChild(this.createManualUserIcon());
        }

        const label = document.createElement('span');
        label.textContent = user.displayName;
        wrapper.appendChild(label);

        cell.appendChild(wrapper);
        return cell;
    }

    createRfidIcon() {
        const namespace = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(namespace, 'svg');
        svg.setAttribute('viewBox', '0 -960 960 960');
        svg.setAttribute('aria-label', this.t('sessions.rfidIconLabel'));
        svg.setAttribute('role', 'img');
        svg.classList.add('session-origin-icon');

        const path = document.createElementNS(namespace, 'path');
        path.setAttribute('fill', 'currentColor');
        path.setAttribute('d', 'M336-374q9-24 14.5-50.5T356-480q0-29-5.5-55.5T336-586l-74 30q6 18 10 37t4 39q0 20-4 39t-10 37l74 30Zm128 54q17-38 24.5-78t7.5-82q0-42-7.5-82T464-640l-74 30q14 30 20 62.5t6 67.5q0 35-6 67.5T390-350l74 30Zm130 54q21-50 31.5-103.5T636-480q0-57-10.5-110.5T594-694l-74 32q18 42 27 88t9 94q0 48-9 94t-27 88l74 32ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z');
        svg.appendChild(path);
        return svg;
    }

    createManualUserIcon() {
        const namespace = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(namespace, 'svg');
        svg.setAttribute('viewBox', '0 -960 960 960');
        svg.setAttribute('aria-label', this.t('sessions.manualIconLabel'));
        svg.setAttribute('role', 'img');
        svg.classList.add('session-origin-icon');

        const path = document.createElementNS(namespace, 'path');
        path.setAttribute('fill', 'currentColor');
        path.setAttribute('d', 'M480-504.62q-49.5 0-84.75-35.25T360-624.62q0-49.5 35.25-84.75T480-744.62q49.5 0 84.75 35.25T600-624.62q0 49.5-35.25 84.75T480-504.62ZM200-215.38v-65.85q0-24.77 14.42-46.35 14.43-21.57 38.81-33.5 56.62-27.15 113.31-40.73 56.69-13.57 113.46-13.57 56.77 0 113.46 13.57 56.69 13.58 113.31 40.73 24.38 11.93 38.81 33.5Q760-306 760-281.23v65.85H200Zm40-40h480v-25.85q0-13.31-8.58-25-8.57-11.69-23.73-19.77-49.38-23.92-101.83-36.65-52.45-12.73-105.86-12.73t-105.86 12.73Q321.69-349.92 272.31-326q-15.16 8.08-23.73 19.77-8.58 11.69-8.58 25v25.85Zm240-289.24q33 0 56.5-23.5t23.5-56.5q0-33-23.5-56.5t-56.5-23.5q-33 0-56.5 23.5t-23.5 56.5q0 33 23.5 56.5t56.5 23.5Z');
        svg.appendChild(path);
        return svg;
    }

    formatSessionText(value) {
        if (value === null || value === undefined)
            return '';

        const text = String(value).trim();
        return text.length ? text : '';
    }

    getTriggerUserName(session) {
        if (!session || typeof session !== 'object')
            return '';

        return this.formatSessionText(session.triggerDisplayName)
            || this.formatSessionText(session.triggerUsername);
    }

    getAuthorizedUserName(source) {
        if (!source || typeof source !== 'object')
            return '';

        return this.formatSessionText(source.authorizedDisplayName)
            || this.formatSessionText(source.authorizedUsername);
    }

    getSessionUserIdentity(session) {
        if (!session || typeof session !== 'object')
            return null;

        const triggerUsername = this.formatSessionText(session.triggerUsername);
        const triggerDisplayName = this.formatSessionText(session.triggerDisplayName);
        const triggerIdentifier = triggerUsername || triggerDisplayName;
        const authorizedUsername = this.formatSessionText(session.authorizedUsername);
        const authorizedDisplayName = this.formatSessionText(session.authorizedDisplayName);
        const authorizedIdentifier = authorizedUsername || authorizedDisplayName;
        const authorizedTagHash = this.formatSessionText(session.authorizedTagHash);

        if (authorizedTagHash && authorizedIdentifier) {
            return {
                username: authorizedIdentifier,
                displayName: authorizedDisplayName || authorizedIdentifier,
                hasDisplayName: !!authorizedDisplayName,
                method: 'rfid'
            };
        }

        if (triggerIdentifier) {
            return {
                username: triggerIdentifier,
                displayName: triggerDisplayName || triggerIdentifier,
                hasDisplayName: !!triggerDisplayName,
                method: 'manual'
            };
        }

        if (authorizedIdentifier) {
            return {
                username: authorizedIdentifier,
                displayName: authorizedDisplayName || authorizedIdentifier,
                hasDisplayName: !!authorizedDisplayName,
                method: 'manual'
            };
        }

        return null;
    }

    deriveSessionName(session) {
        if (!session)
            return '—';

        if (session.name)
            return session.name;

        if (session.property)
            return session.property;

        if (session.sessionId)
            return this.t('sessions.sessionIdLabel', { id: session.sessionId });

        return '—';
    }

    formatTimestamp(timestamp) {
        return this.formatDateTime(timestamp);
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
        const sessions = this.filterVisibleChargingSessions(this.sessions);
        if (!sessions.length) {
            console.warn('No charging sessions to download.');
            return;
        }

        const csvContent = this.buildSessionsCsv(sessions);
        if (!csvContent) {
            console.warn('Failed to build CSV for charging sessions.');
            return;
        }

        const chargerId = this.elements.chargerFilter ? this.elements.chargerFilter.value : '';
        const chargerName = chargerId && this.chargers.has(chargerId) ? this.chargers.get(chargerId).name : '';
        const chargerSuffix = chargerName ? `-${this.sanitizeFilename(chargerName)}` : '';
        const carId = this.elements.carFilter ? this.elements.carFilter.value : '';
        const carName = carId && this.cars.has(carId) ? this.cars.get(carId).name : '';
        const carSuffix = carName ? `-${this.sanitizeFilename(carName)}` : '';
        const userSuffix = this.getSelectedSessionUserFilenameSuffix();
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `charging-sessions${chargerSuffix}${carSuffix}${userSuffix}-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }, 0);
    }

    getSelectedSessionUserFilenameSuffix() {
        const select = this.elements.userFilter;
        if (!select || !select.value)
            return '';

        const selectedOption = select.options[select.selectedIndex];
        const label = selectedOption && selectedOption.textContent ? selectedOption.textContent : '';
        return label ? `-${this.sanitizeFilename(label)}` : '';
    }

    buildSessionsCsv(sessions) {
        if (!Array.isArray(sessions) || !sessions.length)
            return '';

        const columns = [
            { label: this.t('csv.sessionId'), key: 'sessionId' },
            { label: this.t('csv.chargerName'), key: 'chargerName' },
            { label: this.t('csv.chargerSerialNumber'), key: 'chargerSerialNumber' },
            { label: this.t('csv.car'), key: 'carName' },
            { label: this.t('csv.startedBy'), value: session => this.getTriggerUserName(session) },
            { label: this.t('csv.source'), key: 'triggerSourceName' },
            { label: this.t('csv.authorizedUser'), value: session => this.getAuthorizedUserName(session) },
            { label: this.t('csv.authorizedTag'), key: 'authorizedTagHash' },
            { label: this.t('csv.start'), key: 'startTimestamp', formatter: value => this.formatCsvTimestamp(value) },
            { label: this.t('csv.end'), key: 'endTimestamp', formatter: value => this.formatCsvTimestamp(value) },
            { label: this.t('csv.energyKwh'), key: 'sessionEnergy' },
            { label: this.t('csv.meterStartKwh'), key: 'energyStart' },
            { label: this.t('csv.meterEndKwh'), key: 'energyEnd' }
        ];

        const lines = [];
        lines.push(columns.map(column => column.label).join(';'));
        sessions.forEach(session => {
            const row = columns.map(column => {
                const raw = typeof column.value === 'function'
                    ? column.value(session)
                    : (session ? session[column.key] : '');
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
        return this.formatDateTime(value, { fallback: '' });
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
            this.easterEggGame.start();
        }
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
            ? this.t('header.authenticateHint')
            : this.t('header.awaitingLogin');

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
        this.elements.loginButton.textContent = loading ? this.t('login.signingIn') : this.t('login.signIn');
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
        this.updateConnectionStatus(this.t('connection.loggedOut'), 'connecting');
        this.updateSessionUser();
        this.showLoginOverlay(this.t('connection.loggedOutOverlay'));
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
                throw new Error(this.t('login.invalidResponse'));

            this.persistSession({
                token: data.token,
                expiresAt: data.expiresAt,
                username: this.username
            });
            this.updateSessionUser();
        } catch (error) {
            console.warn('Token refresh failed', error);
            this.clearSession();
            this.updateConnectionStatus(this.t('connection.authenticationRequired'), 'error');
            if (this.socket && this.socket.readyState === WebSocket.OPEN)
                this.socket.close();
            this.showLoginOverlay(this.t('connection.sessionExpired'));
        } finally {
            this.refreshInFlight = false;
        }
    }
}

window.app = new DashboardApp();
