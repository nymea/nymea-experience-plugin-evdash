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

#include <integrations/thingmanager.h>

#include <QWebSocket>
#include <QWebSocketServer>
#include <QHostAddress>

#include <QDateTime>
#include <QJsonParseError>
#include <QJsonDocument>

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
            qCDebug(dcEvDashExperience()) << "WebSocket client disconnected" << socket->peerAddress() << "Remaining clients:" << m_clients.count();
            socket->deleteLater();
        });

        m_clients.append(socket);
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
        QJsonObject errorReply {
            {QStringLiteral("version"), QStringLiteral("1.0")},
            {QStringLiteral("event"), QStringLiteral("error")},
            {QStringLiteral("payload"), QJsonObject{
                                            {QStringLiteral("message"), QStringLiteral("Invalid JSON payload")},
                                            {QStringLiteral("details"), parseError.errorString()}
                                        }}
        };

        sendReply(socket, errorReply);
        return;
    }

    const QJsonObject response = handleApiRequest(doc.object());
    sendReply(socket, response);
}

QJsonObject EvDashEngine::handleApiRequest(const QJsonObject &request) const
{
    qCDebug(dcEvDashExperience()) << "Handle API request" << request;

    QJsonObject response;
    response.insert(QStringLiteral("version"), request.value(QStringLiteral("version")).toString(QStringLiteral("1.0")));

    const QString requestId = request.value(QStringLiteral("requestId")).toString();
    if (!requestId.isEmpty())
        response.insert(QStringLiteral("requestId"), requestId);

    const QString action = request.value(QStringLiteral("action")).toString();

    if (action.compare(QStringLiteral("ping"), Qt::CaseInsensitive) == 0) {

        response.insert(QStringLiteral("event"), QStringLiteral("statusUpdate"));

        QJsonObject payload;
        payload.insert(QStringLiteral("status"), QStringLiteral("ok"));
        payload.insert(QStringLiteral("timestamp"), QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs));

        const QJsonObject requestPayload = request.value(QStringLiteral("payload")).toObject();
        if (!requestPayload.isEmpty())
            payload.insert(QStringLiteral("echo"), requestPayload);

        response.insert(QStringLiteral("payload"), payload);
    } else {
        response.insert(QStringLiteral("event"), QStringLiteral("error"));
        QJsonObject payload;
        payload.insert(QStringLiteral("message"), QStringLiteral("Unknown action"));
        payload.insert(QStringLiteral("action"), action);
        response.insert(QStringLiteral("payload"), payload);
    }

    return response;
}

void EvDashEngine::sendReply(QWebSocket *socket, QJsonObject response) const
{
    if (!socket)
        return;

    if (!response.contains(QStringLiteral("version")))
        response.insert(QStringLiteral("version"), QStringLiteral("1.0"));

    const QJsonDocument replyDoc(response);
    socket->sendTextMessage(QString::fromUtf8(replyDoc.toJson(QJsonDocument::Compact)));
}
