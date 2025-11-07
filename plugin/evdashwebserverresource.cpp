#include "evdashwebserverresource.h"

#include <QFileInfo>

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

    // Verify methods
    if (request.method() != HttpRequest::Get) {
        HttpReply *reply = HttpReply::createErrorReply(HttpReply::MethodNotAllowed);
        reply->setHeader(HttpReply::AllowHeader, "GET");
        return reply;
    }

    // Redirect base url to index
    if (request.url().path() == basePath() || request.url().path() ==  basePath() + "/") {
        qCDebug(dcEvDashExperience()) << "Base URL called, redirect to main page...";
        return redirectToIndex();
    }

    // Check if this is a static file we can provide
    QString fileName = request.url().path().remove(basePath());
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

