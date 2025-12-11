/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
*
* Copyright 2013 - 2025, nymea GmbH
* Contact: contact@nymea.io
*
* This file is part of nymea.
* This project including source code and documentation is protected by
* copyright law, and remains the property of nymea GmbH. All rights, including
* reproduction, publication, editing and translation, are reserved. The use of
* this project is subject to the terms of a license agreement to be concluded
* with nymea GmbH in accordance with the terms of use of nymea GmbH, available
* under https://nymea.io/license
*
* GNU General Public License Usage
* Alternatively, this project may be redistributed and/or modified under the
* terms of the GNU General Public License as published by the Free Software
* Foundation, GNU version 3. This project is distributed in the hope that it
* will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty
* of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General
* Public License for more details.
*
* You should have received a copy of the GNU General Public License along with
* this project. If not, see <https://www.gnu.org/licenses/>.
*
* For any further details and any questions please contact us under
* contact@nymea.io or see our FAQ/Licensing Information on
* https://nymea.io/license/faq
*
* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

#include "evdashengine.h"
#include "evdashsettings.h"
#include "evdashwebserverresource.h"
#include "energymanagerdbusclient.h"
#include "chargingsessionsdbusinterfaceclient.h"

#include <integrations/thingmanager.h>

#include <QWebSocket>
#include <QWebSocketServer>
#include <QHostAddress>
#include <QWebSocketProtocol>

#include <QDateTime>
#include <QJsonParseError>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>

#include <QLoggingCategory>
Q_DECLARE_LOGGING_CATEGORY(dcEvDashExperience)

EvDashEngine::EvDashEngine(ThingManager *thingManager, EvDashWebServerResource *webServerResource, QObject *parent)
    : QObject{parent},
    m_thingManager{thingManager},
    m_webServerResource{webServerResource}
{
    Things evChargers = m_thingManager->configuredThings().filterByInterface("evcharger");

    // Init charger list
    foreach (Thing *chargerThing, evChargers) {
        m_chargers.append(chargerThing);
        monitorChargerThing(chargerThing);
    }

    connect(m_thingManager, &ThingManager::thingAdded, this, &EvDashEngine::onThingAdded);
    connect(m_thingManager, &ThingManager::thingRemoved, this, &EvDashEngine::onThingRemoved);
    connect(m_thingManager, &ThingManager::thingChanged, this, &EvDashEngine::onThingChanged);

    // Setup websocket server
    m_webSocketServer = new QWebSocketServer(QStringLiteral("EvDashEngine"), QWebSocketServer::NonSecureMode, this);

    connect(m_webSocketServer, &QWebSocketServer::newConnection, this, [this](){
        QWebSocket *socket = m_webSocketServer->nextPendingConnection();
        if (!socket) {
            qCWarning(dcEvDashExperience()) << "Interface: Received new connection but socket was null";
            return;
        }

        connect(socket, &QWebSocket::textMessageReceived, this, [this, socket](const QString &message) {
            processTextMessage(socket, message);
        });

        connect(socket, &QWebSocket::disconnected, this, [this, socket](){
            m_clients.removeAll(socket);
            m_authenticatedClients.remove(socket);
            qCDebug(dcEvDashExperience()) << "WebSocket client disconnected" << socket->peerAddress().toString() << "Remaining clients:" << m_clients.count();
            socket->deleteLater();
        });

        m_clients.append(socket);
        m_authenticatedClients.insert(socket, QString());
        qCDebug(dcEvDashExperience()) << "WebSocket client connected" << socket->peerAddress().toString() << "Total clients:" << m_clients.count();
    });

    connect(m_webSocketServer, &QWebSocketServer::acceptError, this, [this](QAbstractSocket::SocketError error) {
        qCWarning(dcEvDashExperience()) << "WebSocket accept error" << error << m_webSocketServer->errorString();
    });

    EvDashSettings settings;
    settings.beginGroup("General");
    m_webSocketPort = settings.value("webSocketServerPort", 4449).toUInt();
    bool enabled = settings.value("enabled", false).toBool();
    settings.endGroup();

    // ChargingSessions client for fetching charging sessions
    m_chargingSessionsClient = new ChargingSessionsDBusInterfaceClient(this);
    connect(m_chargingSessionsClient, &ChargingSessionsDBusInterfaceClient::sessionsReceived, this, [](const QList<QVariantMap> &chargingSessions){
        qCDebug(dcEvDashExperience()) << "ChargingSessions :";
        foreach (const QVariant &ciVariant, chargingSessions) {
            qCDebug(dcEvDashExperience()) << "-->" << ciVariant.toMap();
        }
    });

    connect(m_chargingSessionsClient, &ChargingSessionsDBusInterfaceClient::errorOccurred, this, [](const QString &errorMessage){
        qCWarning(dcEvDashExperience()) << "Charging sessions DBus client error occurred:" << errorMessage;
    });


    // Energy manager client for associated cars and current mode
    m_energyManagerClient = new EnergyManagerDbusClient(this);
    connect(m_energyManagerClient, &EnergyManagerDbusClient::chargingInfosUpdated, this, [](const QVariantList &chargingInfos){
        qCDebug(dcEvDashExperience()) << "ChargingInfos:";
        foreach (const QVariant &ciVariant, chargingInfos) {
            qCDebug(dcEvDashExperience()) << "-->" << ciVariant.toMap();
        }
    });

    connect(m_energyManagerClient, &EnergyManagerDbusClient::chargingInfoAdded, this, [this](const QVariantMap &chargingInfo){
        qCDebug(dcEvDashExperience()) << "ChargingInfo added:" << chargingInfo;
        Thing *charger = m_thingManager->findConfiguredThing(chargingInfo.value("evChargerId").toUuid());
        if (charger) {
            onThingChanged(charger);
        }
    });

    connect(m_energyManagerClient, &EnergyManagerDbusClient::chargingInfoChanged, this, [this](const QVariantMap &chargingInfo){
        qCDebug(dcEvDashExperience()) << "ChargingInfo changed:" << chargingInfo;
        Thing *charger = m_thingManager->findConfiguredThing(chargingInfo.value("evChargerId").toUuid());
        if (charger) {
            onThingChanged(charger);
        }
    });

    connect(m_energyManagerClient, &EnergyManagerDbusClient::chargingInfoRemoved, this, [](const QString &evChargerId){
        qCDebug(dcEvDashExperience()) << "ChargingInfo removed:" << evChargerId;
    });

    connect(m_energyManagerClient, &EnergyManagerDbusClient::errorOccurred, this, [](const QString &errorMessage){
        qCWarning(dcEvDashExperience()) << "Energy manager DBus client error occurred:" << errorMessage;
    });

    qCDebug(dcEvDashExperience()) << "ChargingInfos:" << m_energyManagerClient->chargingInfos();
    foreach (const QVariant &ciVariant, m_energyManagerClient->chargingInfos()) {
        qCDebug(dcEvDashExperience()) << "-->" << ciVariant.toMap();
    }

    // Start the service if enabled
    setEnabled(enabled);
}

EvDashEngine::~EvDashEngine()
{
    stopWebSocketServer();
}

bool EvDashEngine::enabled() const
{
    return m_enabled;
}

bool EvDashEngine::setEnabled(bool enabled)
{
    m_enabled = enabled;

    if (m_enabled) {
        if (!startWebSocketServer(m_webSocketPort)) {
            return false;
        }
    } else {
        stopWebSocketServer();
    }

    qCDebug(dcEvDashExperience()) << "The EV Dash service is now" << (enabled ? "enabled" : "disabled");
    m_webServerResource->setEnabled(m_enabled);

    EvDashSettings settings;
    settings.beginGroup("General");
    settings.setValue("enabled", enabled);
    settings.endGroup();

    emit enabledChanged(m_enabled);
    return true;
}

void EvDashEngine::onThingAdded(Thing *thing)
{
    if (thing->thingClass().interfaces().contains("evcharger")) {
        m_chargers.append(thing);
        monitorChargerThing(thing);
        sendNotification("ChargerAdded", packCharger(thing));
    }
}

void EvDashEngine::onThingRemoved(const ThingId &thingId)
{
    foreach (Thing *thing, m_chargers) {
        if (thing->id() == thingId) {
            qCDebug(dcEvDashExperience()) << "Charger has been removed.";
            m_chargers.removeAll(thing);
            sendNotification("ChargerRemoved", packCharger(thing));
        }
    }
}

void EvDashEngine::onThingChanged(Thing *thing)
{
    sendNotification("ChargerChanged", packCharger(thing));
}

void EvDashEngine::monitorChargerThing(Thing *thing)
{
    connect(thing, &Thing::stateValueChanged, this, [this, thing](const StateTypeId &stateTypeId, const QVariant &value, const QVariant &minValue, const QVariant &maxValue, const QVariantList &possibleValues){
        Q_UNUSED(stateTypeId)
        Q_UNUSED(value)
        Q_UNUSED(minValue)
        Q_UNUSED(maxValue)
        Q_UNUSED(possibleValues)

        onThingChanged(thing);
    });
}

bool EvDashEngine::startWebSocketServer(quint16 port)
{
    if (m_webSocketServer->isListening()) {
        if (m_webSocketServer->serverPort() == port && port != 0)
            return true;

        m_webSocketServer->close();
    }

    const bool listening = m_webSocketServer->listen(QHostAddress::AnyIPv4, port);
    if (listening) {
        qCDebug(dcEvDashExperience()) << "WebSocket server listening on" << m_webSocketServer->serverAddress() << m_webSocketServer->serverPort();
    } else {
        qCWarning(dcEvDashExperience()) << "Failed to start WebSocket server" << m_webSocketServer->errorString();
    }

    emit webSocketListeningChanged(listening);
    return listening;
}

void EvDashEngine::stopWebSocketServer()
{
    if (m_webSocketServer->isListening())
        m_webSocketServer->close();

    for (QWebSocket *client : qAsConst(m_clients)) {
        if (client->state() == QAbstractSocket::ConnectedState)
            client->close(QWebSocketProtocol::CloseCodeGoingAway, QStringLiteral("Server shutting down"));

        client->deleteLater();
    }

    m_clients.clear();
    m_authenticatedClients.clear();
}

void EvDashEngine::processTextMessage(QWebSocket *socket, const QString &message)
{
    if (!socket)
        return;

    QJsonParseError parseError;
    const QJsonDocument doc = QJsonDocument::fromJson(message.toUtf8(), &parseError);

    if (parseError.error != QJsonParseError::NoError || !doc.isObject()) {
        qCWarning(dcEvDashExperience()) << "Invalid WebSocket payload" << parseError.errorString();
        QJsonObject errorReply = createErrorResponse(QString(), QStringLiteral("invalidPayload"));
        sendReply(socket, errorReply);
        return;
    }

    qCDebug(dcEvDashExperience()) << "-->" << qUtf8Printable(doc.toJson(QJsonDocument::Compact));

    const QJsonObject requestObject = doc.object();
    const QString requestId = requestObject.value(QStringLiteral("requestId")).toString();
    const QString action = requestObject.value(QStringLiteral("action")).toString();

    if (action.isEmpty()) {
        QJsonObject response = createErrorResponse(requestId, QStringLiteral("invalidAction"));
        sendReply(socket, response);
        return;
    }

    const bool isAuthenticateAction = action.compare(QStringLiteral("authenticate"), Qt::CaseInsensitive) == 0;
    if (!isAuthenticateAction) {
        const QString token = m_authenticatedClients.value(socket);
        if (token.isEmpty()) {
            QJsonObject response = createErrorResponse(requestId, QStringLiteral("unauthenticated"));
            sendReply(socket, response);
            socket->close(QWebSocketProtocol::CloseCodePolicyViolated, QStringLiteral("Authentication required"));
            m_authenticatedClients.remove(socket);
            return;
        }
    }

    QJsonObject response = handleApiRequest(socket, requestObject);
    sendReply(socket, response);

    if (isAuthenticateAction && !response.value(QStringLiteral("success")).toBool()) {
        socket->close(QWebSocketProtocol::CloseCodePolicyViolated, QStringLiteral("Authentication failed"));
        m_authenticatedClients.remove(socket);
    }
}

QJsonObject EvDashEngine::handleApiRequest(QWebSocket *socket, const QJsonObject &request)
{
    qCDebug(dcEvDashExperience()) << "Handle API request" << request;

    const QString requestId = request.value(QStringLiteral("requestId")).toString();
    const QString action = request.value(QStringLiteral("action")).toString();

    if (action.compare(QStringLiteral("authenticate"), Qt::CaseInsensitive) == 0) {
        const QJsonObject payload = request.value(QStringLiteral("payload")).toObject();
        const QString token = payload.value(QStringLiteral("token")).toString();

        if (token.isEmpty())
            return createErrorResponse(requestId, QStringLiteral("missingToken"));

        if (!m_webServerResource || !m_webServerResource->validateToken(token)) {
            m_authenticatedClients.remove(socket);
            return createErrorResponse(requestId, QStringLiteral("unauthorized"));
        }

        m_authenticatedClients.insert(socket, token);

        QJsonObject responsePayload {
            {QStringLiteral("authenticated"), true},
            {QStringLiteral("timestamp"), QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)}
        };
        return createSuccessResponse(requestId, responsePayload);
    }

    if (action.compare(QStringLiteral("ping"), Qt::CaseInsensitive) == 0) {
        QJsonObject payload;
        payload.insert(QStringLiteral("timestamp"), QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs));

        const QJsonObject requestPayload = request.value(QStringLiteral("payload")).toObject();
        if (!requestPayload.isEmpty())
            payload.insert(QStringLiteral("echo"), requestPayload);

        return createSuccessResponse(requestId, payload);
    }

    if (action.compare(QStringLiteral("GetChargers"), Qt::CaseInsensitive) == 0) {

        QJsonObject payload;
        QJsonArray chargerList;
        for (Thing *charger : m_thingManager->configuredThings().filterByInterface("evcharger")) {
            chargerList.append(packCharger(charger));
        }

        payload.insert(QStringLiteral("chargers"), chargerList);
        return createSuccessResponse(requestId, payload);
    }

    return createErrorResponse(requestId, QStringLiteral("unknownAction"));
}

void EvDashEngine::sendReply(QWebSocket *socket, QJsonObject response) const
{
    if (!socket)
        return;

    const QJsonDocument replyDoc(response);
    qCDebug(dcEvDashExperience()) << "<--" << qUtf8Printable(replyDoc.toJson(QJsonDocument::Compact));
    socket->sendTextMessage(QString::fromUtf8(replyDoc.toJson(QJsonDocument::Compact)));
}

void EvDashEngine::sendNotification(const QString &notification, QJsonObject payload) const
{
    // Send to all active clients

    for (QWebSocket *client : qAsConst(m_clients)) {
        QJsonObject notificationObject;
        notificationObject.insert(QStringLiteral("requestId"), QUuid::createUuid().toString(QUuid::WithoutBraces));
        notificationObject.insert("event", notification);
        notificationObject.insert("payload", payload);
        const QJsonDocument notificationDoc(notificationObject);
        qCDebug(dcEvDashExperience()) << "<--" << qUtf8Printable(notificationDoc.toJson(QJsonDocument::Compact));
        client->sendTextMessage(QString::fromUtf8(notificationDoc.toJson(QJsonDocument::Compact)));
    }
}

QJsonObject EvDashEngine::createSuccessResponse(const QString &requestId, const QJsonObject &payload) const
{
    QJsonObject response;
    if (!requestId.isEmpty())
        response.insert(QStringLiteral("requestId"), requestId);

    response.insert(QStringLiteral("success"), true);
    response.insert(QStringLiteral("payload"), payload.isEmpty() ? QJsonObject{} : payload);
    return response;
}

QJsonObject EvDashEngine::createErrorResponse(const QString &requestId, const QString &errorMessage) const
{
    QJsonObject response;
    if (!requestId.isEmpty())
        response.insert(QStringLiteral("requestId"), requestId);

    response.insert(QStringLiteral("success"), false);
    response.insert(QStringLiteral("error"), errorMessage);
    return response;
}

QJsonObject EvDashEngine::packCharger(Thing *charger) const
{
    QJsonObject chargerObject;
    chargerObject.insert("id", charger->id().toString(QUuid::WithoutBraces));
    chargerObject.insert("name", charger->name());

    foreach (const QVariant &chargingInfoVariant, m_energyManagerClient->chargingInfos()) {
        QVariantMap chargingInfo = chargingInfoVariant.toMap();
        if (chargingInfo.value("evChargerId").toUuid() == charger->id()) {

            // Set assigned car name
            if (chargingInfo.value("assignedCarId").toString().isEmpty()) {
                chargerObject.insert("assignedCar", "");
            } else {
                Thing *car = m_thingManager->findConfiguredThing(chargingInfo.value("assignedCarId").toUuid());
                if (car) {
                    chargerObject.insert("assignedCar", car->name());
                } else {
                    chargerObject.insert("assignedCar", "");
                }
            }

            // Set energyManagerMode
            chargerObject.insert("energyManagerMode", chargingInfo.value("chargingMode").toInt());
        }
    }



    chargerObject.insert("connected", charger->stateValue("connected").toBool());
    chargerObject.insert("status", charger->stateValue("status").toString());
    chargerObject.insert("chargingCurrent", charger->stateValue("maxChargingCurrent").toDouble());
    chargerObject.insert("currentPower", charger->stateValue("currentPower").toDouble());

    if (charger->hasState("currentVersion"))
        chargerObject.insert("version", charger->stateValue("currentVersion").toDouble());

    if (charger->hasState("sessionEnergy"))
        chargerObject.insert("sessionEnergy", charger->stateValue("sessionEnergy").toDouble());

    if (charger->hasState("temperature"))
        chargerObject.insert("temperature", charger->stateValue("temperature").toDouble());

    if (charger->hasState("desiredPhaseCount"))
        chargerObject.insert("chargingPhases", charger->stateValue("desiredPhaseCount").toInt());


    return chargerObject;
}
