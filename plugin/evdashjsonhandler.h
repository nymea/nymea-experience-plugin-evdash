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

#ifndef ENERGYJSONHANDLER_H
#define ENERGYJSONHANDLER_H

#include <QObject>

#include <jsonrpc/jsonhandler.h>

class EvDashEngine;
class EvDashWebServerResource;

class EvDashJsonHandler : public JsonHandler
{
    Q_OBJECT
public:
    explicit EvDashJsonHandler(EvDashEngine *engine, EvDashWebServerResource *resource, QObject *parent = nullptr);

    QString name() const override;

    Q_INVOKABLE JsonReply *GetEnabled(const QVariantMap &params);
    Q_INVOKABLE JsonReply *SetEnabled(const QVariantMap &params);

    Q_INVOKABLE JsonReply *GetUsers(const QVariantMap &params);
    Q_INVOKABLE JsonReply *AddUser(const QVariantMap &params);
    Q_INVOKABLE JsonReply *RemoveUser(const QVariantMap &params);

signals:
    void EnabledChanged(const QVariantMap &params);

    void UserAdded(const QVariantMap &params);
    void UserRemoved(const QVariantMap &params);

private:
    EvDashEngine *m_engine = nullptr;
    EvDashWebServerResource *m_resource = nullptr;

};

#endif // ENERGYJSONHANDLER_H
