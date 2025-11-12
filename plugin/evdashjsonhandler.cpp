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
#include <QLoggingCategory>

Q_DECLARE_LOGGING_CATEGORY(dcEvDashExperience)

EvDashJsonHandler::EvDashJsonHandler(EvDashEngine *engine, QObject *parent):
    JsonHandler{parent},
    m_engine{engine}
{
    registerEnum<EvDashEngine::EvDashError>();

    QVariantMap params, returns;
    QString description;

    params.clear(); returns.clear();
    description = "Get the enabled status of EV Dash service.";
    returns.insert("enabled", enumValueName(Bool));
    registerMethod("GetEnabled", description, params, returns);

    params.clear(); returns.clear();
    description = "Enable/Disable the EV Dash service.";
    params.insert("enabled", enumValueName(Bool));
    returns.insert("evDashError", enumRef<EvDashEngine::EvDashError>());
    registerMethod("SetEnabled", description, params, returns);

    // Notifications
    params.clear();
    description = "Emitted whenever the EV Dash service has been enabled or disabled.";
    params.insert("enabled", enumValueName(Bool));
    registerNotification("EnabledChanged", description, params);

    connect(m_engine, &EvDashEngine::enabledChanged, this, [=](bool enabled){
        emit EnabledChanged({{"enabled", enabled}});
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

