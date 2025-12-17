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

#include "evdashwebserverresource.h"
#include "evdashsettings.h"

#include <QCryptographicHash>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QRegularExpression>
#include <QUuid>

#include <QLoggingCategory>
Q_DECLARE_LOGGING_CATEGORY(dcEvDashExperience)

EvDashWebServerResource::EvDashWebServerResource(QObject *parent)
    : WebServerResource{"/evdash", parent}
{
    // Load users
    EvDashSettings settings;
    settings.beginGroup("Users");

    foreach (const QString &username, settings.childGroups()) {
        UserInfo info;

        settings.beginGroup(username);
        info.username = username;
        info.passwordHash = settings.value("hash").toString().toUtf8();
        info.passwordSalt = settings.value("salt").toString().toUtf8();
        settings.endGroup(); // username

        m_users.insert(username, info);
    }

    settings.endGroup(); // Users

    qCInfo(dcEvDashExperience()) << "Loaded" << m_users.count() << "users for the dashboard.";
}

HttpReply *EvDashWebServerResource::processRequest(const HttpRequest &request)
{
    qCDebug(dcEvDashExperience()) << "Process request" << request.url().toString();

    const QString path = request.url().path();

    if (path == basePath() + QStringLiteral("/api/login"))
        return handleLoginRequest(request);

    if (path == basePath() + QStringLiteral("/api/refresh"))
        return handleRefreshRequest(request);

    // Verify methods for static content
    if (request.method() != HttpRequest::Get) {
        HttpReply *reply = HttpReply::createErrorReply(HttpReply::MethodNotAllowed);
        reply->setHeader(HttpReply::AllowHeader, "GET");
        return reply;
    }

    // Redirect base url to index
    if (path == basePath() || path == basePath() + QStringLiteral("/")) {
        qCDebug(dcEvDashExperience()) << "Base URL called, redirect to main page...";
        return redirectToIndex();
    }

    // Check if this is a static file we can provide
    QString fileName = path;
    fileName.remove(basePath());
    qCDebug(dcEvDashExperience()) << "Check filename" << fileName;
    if (verifyStaticFile(fileName))
        return WebServerResource::createFileReply(":/dashboard" + fileName);

    // If nothing matches, redirect to main page
    qCWarning(dcEvDashExperience()) << "Resource for debug interface not found. Redirecting to main page...";
    return redirectToIndex();
}

QStringList EvDashWebServerResource::usernames() const
{
    return m_users.keys();
}

EvDashEngine::EvDashError EvDashWebServerResource::addUser(const QString &username, const QString &password)
{
    if (m_users.keys().contains(username)) {
        qCWarning(dcEvDashExperience()) << "Cannot add new user. There is already a user with the username" << username;
        return EvDashEngine::EvDashErrorDuplicateUser;
    }

    if (password.size() < s_minimalPasswordLength) {
        qCWarning(dcEvDashExperience()) << "Cannot add new user. The given password is to short. The minimum size is" << s_minimalPasswordLength;
        return EvDashEngine::EvDashErrorBadPassword;
    }

    UserInfo info;
    info.username = username;
    info.passwordSalt = QUuid::createUuid().toString().remove(QRegularExpression("[{}]")).toUtf8();
    info.passwordHash = QCryptographicHash::hash(QString(password + info.passwordSalt).toUtf8(), QCryptographicHash::Sha3_512).toBase64();

    EvDashSettings settings;
    settings.beginGroup("Users");
    settings.beginGroup(username);
    settings.setValue("hash", QString::fromUtf8(info.passwordHash));
    settings.setValue("salt", QString::fromUtf8(info.passwordSalt));
    settings.endGroup(); // username
    settings.endGroup(); // Users

    qCDebug(dcEvDashExperience()) << "Added successfully new user with username" << username;

    m_users.insert(username, info);
    emit userAdded(username);

    return EvDashEngine::EvDashErrorNoError;
}

EvDashEngine::EvDashError EvDashWebServerResource::removeUser(const QString &username)
{
    if (!m_users.contains(username)) {
        qCWarning(dcEvDashExperience()) << "Cannot remove user with username" << username << "because there is no such user.";
        return EvDashEngine::EvDashErrorUserNotFound;
    }

    m_users.remove(username);

    foreach (const QString &token, m_activeTokens.keys()) {
        if (m_activeTokens.value(token).username == username) {
            qCDebug(dcEvDashExperience()) << "Revoke active token" << token << "for user" << username;
            m_activeTokens.remove(token);
        }
    }

    EvDashSettings settings;
    settings.beginGroup("Users");
    settings.remove(username);
    settings.endGroup(); // Users

    qCDebug(dcEvDashExperience()) << "User with username" << username << "removed successfully";

    emit userRemoved(username);

    return EvDashEngine::EvDashErrorNoError;
}

HttpReply *EvDashWebServerResource::redirectToIndex()
{
    HttpReply *reply = HttpReply::createErrorReply(HttpReply::PermanentRedirect);
    reply->setHeader(HttpReply::LocationHeader, QString(basePath() + "/index.html").toLocal8Bit());
    return reply;
}

bool EvDashWebServerResource::verifyStaticFile(const QString &fileName)
{
    if (QFileInfo::exists(":/dashboard" + fileName))
        return true;

    qCWarning(dcEvDashExperience()) << "Could not find" << fileName << "in resource files";
    return false;
}

HttpReply *EvDashWebServerResource::handleLoginRequest(const HttpRequest &request)
{
    if (request.method() != HttpRequest::Post) {
        HttpReply *reply = HttpReply::createErrorReply(HttpReply::MethodNotAllowed);
        reply->setHeader(HttpReply::AllowHeader, "POST");
        return reply;
    }

    QJsonParseError parseError;
    const QJsonDocument requestDoc = QJsonDocument::fromJson(request.payload(), &parseError);
    if (parseError.error != QJsonParseError::NoError || !requestDoc.isObject()) {
        qCWarning(dcEvDashExperience()) << "Invalid login payload" << parseError.errorString();
        QJsonObject errorPayload{{QStringLiteral("success"), false}, {QStringLiteral("error"), QStringLiteral("invalidRequest")}};
        return HttpReply::createJsonReply(QJsonDocument(errorPayload), HttpReply::BadRequest);
    }

    const QJsonObject requestObject = requestDoc.object();
    const QString username = requestObject.value(QStringLiteral("username")).toString();
    const QString password = requestObject.value(QStringLiteral("password")).toString();

    if (!verifyCredentials(username, password)) {
        QJsonObject response{{QStringLiteral("success"), false}, {QStringLiteral("error"), QStringLiteral("unauthorized")}};
        return HttpReply::createJsonReply(QJsonDocument(response), HttpReply::Unauthorized);
    }

    const QString token = issueToken(username);
    const TokenInfo tokenInfo = m_activeTokens.value(token);

    QJsonObject payload{{QStringLiteral("success"), true}, {QStringLiteral("token"), token}, {QStringLiteral("expiresAt"), tokenInfo.expiresAt.toString(Qt::ISODateWithMs)}};

    return HttpReply::createJsonReply(QJsonDocument(payload));
}

HttpReply *EvDashWebServerResource::handleRefreshRequest(const HttpRequest &request)
{
    if (request.method() != HttpRequest::Post) {
        HttpReply *reply = HttpReply::createErrorReply(HttpReply::MethodNotAllowed);
        reply->setHeader(HttpReply::AllowHeader, "POST");
        return reply;
    }

    QJsonParseError parseError;
    const QJsonDocument requestDoc = QJsonDocument::fromJson(request.payload(), &parseError);
    if (parseError.error != QJsonParseError::NoError || !requestDoc.isObject()) {
        QJsonObject errorPayload{{QStringLiteral("success"), false}, {QStringLiteral("error"), QStringLiteral("invalidRequest")}};
        return HttpReply::createJsonReply(QJsonDocument(errorPayload), HttpReply::BadRequest);
    }

    purgeExpiredTokens();

    const QJsonObject requestObject = requestDoc.object();
    const QString token = requestObject.value(QStringLiteral("token")).toString();
    if (token.isEmpty() || !m_activeTokens.contains(token)) {
        QJsonObject response{{QStringLiteral("success"), false}, {QStringLiteral("error"), QStringLiteral("unauthorized")}};
        return HttpReply::createJsonReply(QJsonDocument(response), HttpReply::Unauthorized);
    }

    TokenInfo info = m_activeTokens.value(token);
    info.expiresAt = QDateTime::currentDateTimeUtc().addSecs(s_tokenLifetimeSeconds);
    m_activeTokens.insert(token, info);

    QJsonObject payload{{QStringLiteral("success"), true}, {QStringLiteral("token"), token}, {QStringLiteral("expiresAt"), info.expiresAt.toString(Qt::ISODateWithMs)}};

    return HttpReply::createJsonReply(QJsonDocument(payload));
}

bool EvDashWebServerResource::verifyCredentials(const QString &username, const QString &password) const
{
    const UserInfo info = m_users.value(username);
    if (info.passwordHash != QCryptographicHash::hash(QString(password + info.passwordSalt).toUtf8(), QCryptographicHash::Sha3_512).toBase64()) {
        qCWarning(dcEvDashExperience()) << "Authentication error for user:" << username;
        return false;
    }

    return true;
}

QString EvDashWebServerResource::issueToken(const QString &username)
{
    purgeExpiredTokens();

    const QString token = QUuid::createUuid().toString(QUuid::WithoutBraces);
    TokenInfo info;
    info.username = username;
    info.expiresAt = QDateTime::currentDateTimeUtc().addSecs(s_tokenLifetimeSeconds);
    m_activeTokens.insert(token, info);
    return token;
}

bool EvDashWebServerResource::validateToken(const QString &token)
{
    purgeExpiredTokens();
    auto it = m_activeTokens.find(token);
    if (it == m_activeTokens.end())
        return false;

    if (it->expiresAt < QDateTime::currentDateTimeUtc()) {
        m_activeTokens.erase(it);
        return false;
    }

    return true;
}

void EvDashWebServerResource::purgeExpiredTokens()
{
    const QDateTime now = QDateTime::currentDateTimeUtc();
    auto it = m_activeTokens.begin();
    while (it != m_activeTokens.end()) {
        if (it->expiresAt < now)
            it = m_activeTokens.erase(it);
        else
            ++it;
    }
}
