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

#ifndef EVDASHENGINE_H
#define EVDASHENGINE_H

#include <QObject>

class QWebSocket;
class QWebSocketServer;

class ThingManager;
class EvDashWebServerResource;

class EvDashEngine : public QObject
{
    Q_OBJECT
public:
    explicit EvDashEngine(ThingManager *thingManager, EvDashWebServerResource *webServerResource, QObject *parent = nullptr);

    ~EvDashEngine() override;

    bool startWebSocket(quint16 port = 0);
    quint16 webSocketPort() const;
    QString webSocketPath() const;

signals:
    void webSocketListeningChanged(bool listening);

private slots:
    void handleNewConnection();
    void handleSocketDisconnected();

private:
    ThingManager *m_thingManager = nullptr;
    EvDashWebServerResource *m_webServerResource = nullptr;
    QWebSocketServer *m_webSocketServer = nullptr;

    QList<QWebSocket *> m_clients;

    void processTextMessage(QWebSocket *socket, const QString &message);
    QJsonObject handleApiRequest(const QJsonObject &request) const;
    void sendReply(QWebSocket *socket, QJsonObject response) const;
};

#endif // EVDASHENGINE_H
