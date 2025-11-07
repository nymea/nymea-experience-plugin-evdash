#ifndef EVDASHWEBSERVERRESOURCE_H
#define EVDASHWEBSERVERRESOURCE_H

#include <QObject>

#include <webserver/webserverresource.h>

class EvDashWebServerResource : public WebServerResource
{
    Q_OBJECT
public:
    explicit EvDashWebServerResource(QObject *parent = nullptr);

    bool authenticationRequired() const override;

    HttpReply *processRequest(const HttpRequest &request) override;

private:
    HttpReply *redirectToIndex();

    bool verifyStaticFile(const QString &fileName);
};

#endif // EVDASHWEBSERVERRESOURCE_H
