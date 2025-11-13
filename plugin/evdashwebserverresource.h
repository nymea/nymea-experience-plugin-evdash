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

#ifndef EVDASHWEBSERVERRESOURCE_H
#define EVDASHWEBSERVERRESOURCE_H

#include <QObject>
#include <QDateTime>
#include <QHash>
#include <QString>

#include <webserver/webserverresource.h>

#include "evdashengine.h"

class QJsonObject;

class EvDashWebServerResource : public WebServerResource
{
    Q_OBJECT
public:
    explicit EvDashWebServerResource(QObject *parent = nullptr);

    HttpReply *processRequest(const HttpRequest &request) override;

    // User management
    QStringList usernames() const;

    EvDashEngine::EvDashError addUser(const QString &username, const QString &password);
    EvDashEngine::EvDashError removeUser(const QString &username);

    bool validateToken(const QString &token);

signals:
    void userAdded(const QString &username);
    void userRemoved(const QString &username);

private:
    struct TokenInfo {
        QString username;
        QDateTime expiresAt;
    };

    struct UserInfo {
        QString username;
        QByteArray passwordHash;
        QByteArray passwordSalt;
    };

    static constexpr int s_tokenLifetimeSeconds = 3600;
    static constexpr int s_minimalPasswordLength = 4;

    QHash<QString, UserInfo> m_users;
    QHash<QString, TokenInfo> m_activeTokens;

    HttpReply *handleLoginRequest(const HttpRequest &request);
    HttpReply *handleRefreshRequest(const HttpRequest &request);
    HttpReply *redirectToIndex();

    QString issueToken(const QString &username);
    void purgeExpiredTokens();

    bool verifyStaticFile(const QString &fileName);

    bool verifyCredentials(const QString &username, const QString &password) const;


};

#endif // EVDASHWEBSERVERRESOURCE_H
