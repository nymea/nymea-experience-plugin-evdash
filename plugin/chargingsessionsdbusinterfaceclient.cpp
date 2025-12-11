// SPDX-License-Identifier: GPL-3.0-or-later

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
*
* Copyright (C) 2013 - 2024, nymea GmbH
* Copyright (C) 2024 - 2025, chargebyte austria GmbH
*
* This file is part of nymea-energy-plugin-chargingsessions.
*
* nymea-energy-plugin-chargingsessions is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
*
* nymea-energy-plugin-chargingsessions is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with nymea-energy-plugin-chargingsessions. If not, see <https://www.gnu.org/licenses/>.
*
* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

#include "chargingsessionsdbusinterfaceclient.h"

#include <QDBusArgument>
#include <QDBusInterface>
#include <QDBusPendingCall>
#include <QDBusPendingCallWatcher>
#include <QDBusPendingReply>
#include <QDBusReply>
#include <QDBusError>
#include <QLoggingCategory>

Q_DECLARE_LOGGING_CATEGORY(dcChargingSessions)

static const QString kDbusService = QStringLiteral("io.nymea.energy.chargingsessions");
static const QString kDbusPath = QStringLiteral("/io/nymea/energy/chargingsessions");
static const QString kDbusInterface = QStringLiteral("io.nymea.energy.chargingsessions");

ChargingSessionsDBusInterfaceClient::ChargingSessionsDBusInterfaceClient(QObject *parent) :
    QObject(parent),
    m_connection(QDBusConnection::systemBus())
{
    if (!m_connection.isConnected()) {
        qCWarning(dcChargingSessions()) << "DBus system bus not connected";
    }
}

ChargingSessionsDBusInterfaceClient::~ChargingSessionsDBusInterfaceClient()
{
    delete m_interface;
}

QList<QVariantMap> ChargingSessionsDBusInterfaceClient::sessions() const
{
    return m_sessions;
}

void ChargingSessionsDBusInterfaceClient::getSessions(const QStringList &carThingIds)
{
    if (!ensureInterface()) {
        emit errorOccurred(QStringLiteral("Charging sessions DBus interface is not available"));
        return;
    }

    QDBusPendingCall call = m_interface->asyncCall(QStringLiteral("GetSessions"), carThingIds);
    QDBusPendingCallWatcher *watcher = new QDBusPendingCallWatcher(call, this);
    connect(watcher, &QDBusPendingCallWatcher::finished, this, &ChargingSessionsDBusInterfaceClient::onCallFinished);
}

void ChargingSessionsDBusInterfaceClient::onCallFinished(QDBusPendingCallWatcher *watcher)
{
    QDBusPendingReply<QVariantList> reply = *watcher;
    watcher->deleteLater();

    if (reply.isError()) {
        qCWarning(dcChargingSessions()) << "GetSessions DBus call failed:" << reply.error().message();
        emit errorOccurred(reply.error().message());
        return;
    }

    QList<QVariantMap> sessions;
    const QVariantList values = reply.value();
    for (const QVariant &value : values) {
        if (value.canConvert<QVariantMap>()) {
            sessions.append(value.toMap());
            continue;
        }

        const QDBusArgument arg = value.value<QDBusArgument>();
        sessions.append(qdbus_cast<QVariantMap>(arg));
    }

    m_sessions = sessions;
    emit sessionsReceived(m_sessions);
}

bool ChargingSessionsDBusInterfaceClient::ensureInterface()
{
    if (m_interface && m_interface->isValid()) {
        return true;
    }

    delete m_interface;
    m_interface = nullptr;

    if (!m_connection.isConnected()) {
        qCWarning(dcChargingSessions()) << "DBus system bus not connected";
        return false;
    }

    m_interface = new QDBusInterface(kDbusService, kDbusPath, kDbusInterface, m_connection, this);
    if (!m_interface->isValid()) {
        qCWarning(dcChargingSessions()) << "Charging sessions DBus interface is not available:" << m_connection.lastError().message();
        delete m_interface;
        m_interface = nullptr;
        return false;
    }

    return true;
}
