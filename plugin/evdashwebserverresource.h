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

#ifndef EVDASHWEBSERVERRESOURCE_H
#define EVDASHWEBSERVERRESOURCE_H

#include <QDateTime>
#include <QHash>
#include <QObject>
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
    struct TokenInfo
    {
        QString username;
        QDateTime expiresAt;
    };

    struct UserInfo
    {
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
