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
#include "evdashwebserverresource.h"

#include <integrations/thingmanager.h>

#include <QWebSocket>
#include <QWebSocketServer>
#include <QHostAddress>
#include <QWebSocketProtocol>

#include <QDateTime>
#include <QJsonParseError>
#include <QJsonDocument>
#include <QJsonObject>

#include <QLoggingCategory>
Q_DECLARE_LOGGING_CATEGORY(dcEvDashExperience)

EvDashEngine::EvDashEngine(ThingManager *thingManager, EvDashWebServerResource *webServerResource, QObject *parent)
    : QObject{parent},
    m_thingManager{thingManager},
    m_webServerResource{webServerResource}
{
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
            qCDebug(dcEvDashExperience()) << "WebSocket client disconnected" << socket->peerAddress() << "Remaining clients:" << m_clients.count();
            socket->deleteLater();
        });

        m_clients.append(socket);
        m_authenticatedClients.insert(socket, QString());
        qCDebug(dcEvDashExperience()) << "WebSocket client connected" << socket->peerAddress() << "Total clients:" << m_clients.count();
    });

    connect(m_webSocketServer, &QWebSocketServer::acceptError, this, [this](QAbstractSocket::SocketError error) {
        qCWarning(dcEvDashExperience()) << "WebSocket accept error" << error << m_webSocketServer->errorString();
    });

    startWebSocket(4449);
}

EvDashEngine::~EvDashEngine()
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

bool EvDashEngine::startWebSocket(quint16 port)
{
    if (m_webSocketServer->isListening()) {
        if (m_webSocketServer->serverPort() == port && port != 0)
            return true;

        m_webSocketServer->close();
    }

    const bool listening = m_webSocketServer->listen(QHostAddress::Any, port);
    if (listening) {
        qCDebug(dcEvDashExperience()) << "WebSocket server listening on" << m_webSocketServer->serverAddress() << m_webSocketServer->serverPort();
    } else {
        qCWarning(dcEvDashExperience()) << "Failed to start WebSocket server" << m_webSocketServer->errorString();
    }

    emit webSocketListeningChanged(listening);
    return listening;
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

    return createErrorResponse(requestId, QStringLiteral("unknownAction"));
}

void EvDashEngine::sendReply(QWebSocket *socket, QJsonObject response) const
{
    if (!socket)
        return;

    const QJsonDocument replyDoc(response);
    socket->sendTextMessage(QString::fromUtf8(replyDoc.toJson(QJsonDocument::Compact)));
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
