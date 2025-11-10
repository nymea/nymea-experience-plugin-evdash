#include "evdashwebserverresource.h"

#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QUuid>

#include <QLoggingCategory>
Q_DECLARE_LOGGING_CATEGORY(dcEvDashExperience)

EvDashWebServerResource::EvDashWebServerResource(QObject *parent)
    : WebServerResource{"/evdash", parent}
{

}

bool EvDashWebServerResource::authenticationRequired() const
{
    return true;
}

HttpReply *EvDashWebServerResource::processRequest(const HttpRequest &request)
{
    qCDebug(dcEvDashExperience()) << "Process request" << request.url().toString();

    const QString path = request.url().path();

    if (path == basePath() + QStringLiteral("/api/login"))
        return handleLoginRequest(request);

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
        QJsonObject errorPayload {
            {QStringLiteral("success"), false},
            {QStringLiteral("error"), QStringLiteral("invalidRequest")}
        };
        return HttpReply::createJsonReply(QJsonDocument(errorPayload), HttpReply::BadRequest);
    }

    const QJsonObject requestObject = requestDoc.object();
    const QString username = requestObject.value(QStringLiteral("username")).toString();
    const QString password = requestObject.value(QStringLiteral("password")).toString();

    if (!verifyCredentials(username, password)) {
        QJsonObject response {
            {QStringLiteral("success"), false},
            {QStringLiteral("error"), QStringLiteral("unauthorized")}
        };
        return HttpReply::createJsonReply(QJsonDocument(response), HttpReply::Unauthorized);
    }

    const QString token = issueToken(username);
    const TokenInfo tokenInfo = m_activeTokens.value(token);

    QJsonObject payload {
        {QStringLiteral("success"), true},
        {QStringLiteral("token"), token},
        {QStringLiteral("expiresAt"), tokenInfo.expiresAt.toString(Qt::ISODateWithMs)}
    };

    return HttpReply::createJsonReply(QJsonDocument(payload));
}

bool EvDashWebServerResource::verifyCredentials(const QString &username, const QString &password) const
{
    Q_UNUSED(username)
    Q_UNUSED(password)
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

