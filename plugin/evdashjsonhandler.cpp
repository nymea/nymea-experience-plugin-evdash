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

#include "evdashjsonhandler.h"
#include "evdashengine.h"
#include "evdashwebserverresource.h"

#include <QLoggingCategory>

Q_DECLARE_LOGGING_CATEGORY(dcEvDashExperience)

EvDashJsonHandler::EvDashJsonHandler(EvDashEngine *engine, EvDashWebServerResource *resource, QObject *parent):
    JsonHandler{parent},
    m_engine{engine},
    m_resource{resource}
{
    registerEnum<EvDashEngine::EvDashError>();

    QString description;
    QVariantMap params, returns;


    params.clear(); returns.clear();
    description = "Get the enabled status of EV Dash service.";
    returns.insert("enabled", enumValueName(Bool));
    registerMethod("GetEnabled", description, params, returns);

    params.clear(); returns.clear();
    description = "Enable/Disable the EV Dash service.";
    params.insert("enabled", enumValueName(Bool));
    returns.insert("evDashError", enumRef<EvDashEngine::EvDashError>());
    registerMethod("SetEnabled", description, params, returns);


    params.clear(); returns.clear();
    description = "Get the list of available users names.";
    returns.insert("usernames", enumValueName(StringList));
    registerMethod("GetUsers", description, params, returns);

    params.clear(); returns.clear();
    description = "Add a new user with the given username and password.";
    params.insert("username", enumValueName(String));
    params.insert("password", enumValueName(String));
    returns.insert("evDashError", enumRef<EvDashEngine::EvDashError>());
    registerMethod("AddUser", description, params, returns);

    params.clear(); returns.clear();
    description = "Remove the user with the given username.";
    params.insert("username", enumValueName(String));
    returns.insert("evDashError", enumRef<EvDashEngine::EvDashError>());
    registerMethod("RemoveUser", description, params, returns);

    // Notifications
    params.clear();
    description = "Emitted whenever the EV Dash service has been enabled or disabled.";
    params.insert("enabled", enumValueName(Bool));
    registerNotification("EnabledChanged", description, params);

    connect(m_engine, &EvDashEngine::enabledChanged, this, [this](bool enabled){
        emit EnabledChanged({{"enabled", enabled}});
    });

    params.clear();
    description = "Emitted whenever a new username has been added for the dashboard.";
    params.insert("username", enumValueName(String));
    registerNotification("UserAdded", description, params);

    connect(m_resource, &EvDashWebServerResource::userAdded, this, [this](const QString &username){
        emit UserAdded({{"username", username}});
    });

    params.clear();
    description = "Emitted whenever a username has been removed from the dashboard.";
    params.insert("username", enumValueName(String));
    registerNotification("UserRemoved", description, params);

    connect(m_resource, &EvDashWebServerResource::userRemoved, this, [this](const QString &username){
        emit UserRemoved({{"username", username}});
    });
}

QString EvDashJsonHandler::name() const
{
    return "EvDash";
}

JsonReply *EvDashJsonHandler::GetEnabled(const QVariantMap &params)
{
    Q_UNUSED(params)

    QVariantMap returns;
    returns.insert("enabled", m_engine->enabled());
    return createReply(returns);
}

JsonReply *EvDashJsonHandler::SetEnabled(const QVariantMap &params)
{
    bool enabled = params.value("enabled").toBool();

    EvDashEngine::EvDashError error = EvDashEngine::EvDashErrorNoError;
    if (!m_engine->setEnabled(enabled))
        error = EvDashEngine::EvDashErrorBackendError;

    QVariantMap returns;
    returns.insert("evDashError", enumValueName(error));
    return createReply(returns);
}

JsonReply *EvDashJsonHandler::GetUsers(const QVariantMap &params)
{
    Q_UNUSED(params)

    QVariantMap returns;
    returns.insert("usernames", m_resource->usernames());
    return createReply(returns);
}

JsonReply *EvDashJsonHandler::AddUser(const QVariantMap &params)
{
    QString username = params.value("username").toString();
    QString password = params.value("password").toString();

    EvDashEngine::EvDashError error = m_resource->addUser(username, password);

    QVariantMap returns;
    returns.insert("evDashError", enumValueName(error));
    return createReply(returns);
}

JsonReply *EvDashJsonHandler::RemoveUser(const QVariantMap &params)
{
    QString username = params.value("username").toString();

    EvDashEngine::EvDashError error = m_resource->removeUser(username);

    QVariantMap returns;
    returns.insert("evDashError", enumValueName(error));
    return createReply(returns);

}

