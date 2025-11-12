#ifndef EVDASHWEBSERVERRESOURCE_H
#define EVDASHWEBSERVERRESOURCE_H

#include <QObject>
#include <QDateTime>
#include <QHash>
#include <QString>

#include <webserver/webserverresource.h>

class QJsonObject;

class EvDashWebServerResource : public WebServerResource
{
    Q_OBJECT
public:
    explicit EvDashWebServerResource(QObject *parent = nullptr);

    HttpReply *processRequest(const HttpRequest &request) override;

    bool validateToken(const QString &token);

private:
    struct TokenInfo {
        QString username;
        QDateTime expiresAt;
    };

    HttpReply *handleLoginRequest(const HttpRequest &request);
    HttpReply *handleRefreshRequest(const HttpRequest &request);
    HttpReply *redirectToIndex();

    bool verifyStaticFile(const QString &fileName);
    bool verifyCredentials(const QString &username, const QString &password) const;
    QString issueToken(const QString &username);
    void purgeExpiredTokens();

    static constexpr int s_tokenLifetimeSeconds = 3600;

    QHash<QString, TokenInfo> m_activeTokens;
};

#endif // EVDASHWEBSERVERRESOURCE_H
