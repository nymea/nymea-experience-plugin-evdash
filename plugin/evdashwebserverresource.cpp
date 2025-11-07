#include "evdashwebserverresource.h"

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
    return HttpReply::createSuccessReply();
}
