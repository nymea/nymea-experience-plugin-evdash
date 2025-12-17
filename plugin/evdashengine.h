// SPDX-License-Identifier: GPL-3.0-or-later

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
*
* Copyright (C) 2013 - 2024, nymea GmbH
* Copyright (C) 2024 - 2025, chargebyte austria GmbH
*
* This file is part of nymea-experience-plugin-evdash.
*
* nymea-experience-plugin-evdash is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
*
* nymea-experience-plugin-evdash is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with nymea-experience-plugin-evdash. If not, see <https://www.gnu.org/licenses/>.
*
* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

#ifndef EVDASHENGINE_H
#define EVDASHENGINE_H

#include <QHash>
#include <QJsonObject>
#include <QObject>
#include <QPointer>
#include <QStringList>

#include <integrations/thing.h>

class QWebSocket;
class QWebSocketServer;

class Thing;
class LogEngine;
class ThingManager;
class EnergyManagerDbusClient;
class EvDashWebServerResource;
class ChargingSessionsDBusInterfaceClient;

class EvDashEngine : public QObject
{
    Q_OBJECT
public:
    enum EvDashError { EvDashErrorNoError = 0, EvDashErrorBackendError, EvDashErrorDuplicateUser, EvDashErrorUserNotFound, EvDashErrorBadPassword };
    Q_ENUM(EvDashError)

    explicit EvDashEngine(ThingManager *thingManager, LogEngine *logEngine, EvDashWebServerResource *webServerResource, QObject *parent = nullptr);
    ~EvDashEngine() override;

    bool enabled() const;
    bool setEnabled(bool enabled);

signals:
    void enabledChanged(bool enabled);
    void webSocketListeningChanged(bool listening);

private slots:
    void onThingAdded(Thing *thing);
    void onThingRemoved(const ThingId &thingId);
    void onThingChanged(Thing *thing);

private:
    ThingManager *m_thingManager = nullptr;
    LogEngine *m_logEngine = nullptr;
    EvDashWebServerResource *m_webServerResource = nullptr;
    bool m_enabled = false;

    EnergyManagerDbusClient *m_energyManagerClient = nullptr;
    ChargingSessionsDBusInterfaceClient *m_chargingSessionsClient = nullptr;

    QWebSocketServer *m_webSocketServer = nullptr;
    quint16 m_webSocketPort = 4449;

    QList<QWebSocket *> m_clients;
    QHash<QWebSocket *, QString> m_authenticatedClients;

    QList<Thing *> m_cars;
    QList<Thing *> m_chargers;

    void monitorChargerThing(Thing *thing);
    void monitorCarThing(Thing *thing);

    QHash<Thing *, qint64> m_chargersStatusChangedCache;
    void verifyChargerStatusChanged(Thing *charger);

    // Pending requests waiting for charging sessions data to return
    QHash<QString, QPointer<QWebSocket>> m_pendingChargingSessionsRequests;
    QStringList carThingIdsForCharger(const QString &chargerId) const;
    bool isChargerThing(Thing *thing) const;
    bool isCarThing(Thing *thing) const;

    // Websocket server
    bool startWebSocketServer(quint16 port = 0);
    void stopWebSocketServer();
    void processTextMessage(QWebSocket *socket, const QString &message);

    // Websocket API
    QJsonObject handleApiRequest(QWebSocket *socket, const QJsonObject &request);
    void sendReply(QWebSocket *socket, QJsonObject response) const;
    void sendNotification(const QString &notification, QJsonObject payload) const;

    QJsonObject createSuccessResponse(const QString &requestId, const QJsonObject &payload = {}) const;
    QJsonObject createErrorResponse(const QString &requestId, const QString &errorMessage) const;

    QJsonObject packCharger(Thing *charger) const;
    QJsonObject packCar(Thing *car) const;
    void onSessionsReceived(const QList<QVariantMap> &sessions);
    void onSessionsError(const QString &errorMessage);
};

#endif // EVDASHENGINE_H
