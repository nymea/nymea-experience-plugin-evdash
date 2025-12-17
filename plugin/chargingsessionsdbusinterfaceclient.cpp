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

#include "chargingsessionsdbusinterfaceclient.h"

#include <QDBusArgument>
#include <QDBusConnectionInterface>
#include <QDBusError>
#include <QDBusInterface>
#include <QDBusPendingCall>
#include <QDBusPendingCallWatcher>
#include <QDBusPendingReply>
#include <QDBusReply>
#include <QDBusServiceWatcher>

static const QString kDbusService = QStringLiteral("io.nymea.energy.chargingsessions");
static const QString kDbusPath = QStringLiteral("/io/nymea/energy/chargingsessions");
static const QString kDbusInterface = QStringLiteral("io.nymea.energy.chargingsessions");

ChargingSessionsDBusInterfaceClient::ChargingSessionsDBusInterfaceClient(QObject *parent)
    : QObject(parent)
    , m_connection(QDBusConnection::systemBus())
{
    m_serviceWatcher = new QDBusServiceWatcher(kDbusService, m_connection, QDBusServiceWatcher::WatchForRegistration | QDBusServiceWatcher::WatchForUnregistration, this);
    connect(m_serviceWatcher, &QDBusServiceWatcher::serviceRegistered, this, &ChargingSessionsDBusInterfaceClient::onServiceRegistered);
    connect(m_serviceWatcher, &QDBusServiceWatcher::serviceUnregistered, this, &ChargingSessionsDBusInterfaceClient::onServiceUnregistered);

    QDBusConnectionInterface *bus = m_connection.interface();
    if (bus && bus->isServiceRegistered(kDbusService)) {
        onServiceRegistered(kDbusService);
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

void ChargingSessionsDBusInterfaceClient::getSessions(const QStringList &carThingIds, qlonglong startTimestamp, qlonglong endTimestamp)
{
    if (!ensureInterface()) {
        emit errorOccurred(QStringLiteral("Charging sessions DBus interface is not available"));
        return;
    }

    QDBusPendingCall call = m_interface->asyncCall(QStringLiteral("GetSessions"), carThingIds, startTimestamp, endTimestamp);
    QDBusPendingCallWatcher *watcher = new QDBusPendingCallWatcher(call, this);
    connect(watcher, &QDBusPendingCallWatcher::finished, this, &ChargingSessionsDBusInterfaceClient::onCallFinished);
}

void ChargingSessionsDBusInterfaceClient::onCallFinished(QDBusPendingCallWatcher *watcher)
{
    QDBusPendingReply<QVariantList> reply = *watcher;
    watcher->deleteLater();

    if (reply.isError()) {
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
        return false;
    }

    m_interface = new QDBusInterface(kDbusService, kDbusPath, kDbusInterface, m_connection, this);
    if (!m_interface->isValid()) {
        delete m_interface;
        m_interface = nullptr;
        return false;
    }

    return true;
}

void ChargingSessionsDBusInterfaceClient::onServiceRegistered(const QString &service)
{
    Q_UNUSED(service)
    ensureInterface();
}

void ChargingSessionsDBusInterfaceClient::onServiceUnregistered(const QString &service)
{
    Q_UNUSED(service)
    if (m_interface) {
        m_interface->deleteLater();
    }
    m_interface = nullptr;
}
