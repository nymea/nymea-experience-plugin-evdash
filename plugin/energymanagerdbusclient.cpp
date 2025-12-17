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

#include "energymanagerdbusclient.h"

#include <QDBusArgument>
#include <QDBusConnection>
#include <QDBusConnectionInterface>
#include <QDBusInterface>
#include <QDBusMessage>
#include <QDBusMetaType>
#include <QDBusPendingCall>
#include <QDBusPendingCallWatcher>
#include <QDBusReply>
#include <QDBusServiceWatcher>

static const QString kDbusService = QStringLiteral("io.nymea.energymanager");
static const QString kDbusPath = QStringLiteral("/io/nymea/energymanager");
static const QString kDbusInterface = QStringLiteral("io.nymea.energymanager");

EnergyManagerDbusClient::EnergyManagerDbusClient(QObject *parent)
    : QObject(parent)
    , m_connection(QDBusConnection::systemBus())
{
    if (!m_connection.isConnected()) {
        emit errorOccurred(QStringLiteral("DBus system bus not connected"));
        return;
    }

    m_serviceWatcher = new QDBusServiceWatcher(kDbusService, m_connection, QDBusServiceWatcher::WatchForRegistration | QDBusServiceWatcher::WatchForUnregistration, this);
    connect(m_serviceWatcher, &QDBusServiceWatcher::serviceRegistered, this, &EnergyManagerDbusClient::onServiceRegistered);
    connect(m_serviceWatcher, &QDBusServiceWatcher::serviceUnregistered, this, &EnergyManagerDbusClient::onServiceUnregistered);

    QDBusConnectionInterface *bus = m_connection.interface();
    if (bus && bus->isServiceRegistered(kDbusService)) {
        onServiceRegistered(kDbusService);
    }
}

EnergyManagerDbusClient::~EnergyManagerDbusClient() {}

QVariantList EnergyManagerDbusClient::chargingInfos() const
{
    return m_chargingInfos;
}

void EnergyManagerDbusClient::refreshChargingInfos()
{
    if (!m_interface || !m_interface->isValid()) {
        if (!setupInterface()) {
            emit errorOccurred(QStringLiteral("EnergyManager DBus interface is not available"));
            return;
        }
    }

    if (!m_interface) {
        emit errorOccurred(QStringLiteral("EnergyManager DBus interface is not available"));
        return;
    }

    QDBusReply<QVariantList> reply = m_interface->call(QStringLiteral("chargingInfos"));
    if (!reply.isValid()) {
        emit errorOccurred(reply.error().message());
        return;
    }

    QVariantList convertedInfos;
    const QVariantList infos = reply.value();
    for (const QVariant &value : infos) {
        if (value.canConvert<QVariantMap>()) {
            convertedInfos.append(value.toMap());
            continue;
        }

        const QDBusArgument arg = value.value<QDBusArgument>();
        convertedInfos.append(qdbus_cast<QVariantMap>(arg));
    }

    m_chargingInfos = convertedInfos;
    emit chargingInfosUpdated(m_chargingInfos);
}

void EnergyManagerDbusClient::onChargingInfoAdded(const QVariantMap &chargingInfo)
{
    replaceOrAdd(chargingInfo);
    emit chargingInfoAdded(chargingInfo);
    emit chargingInfosUpdated(m_chargingInfos);
}

void EnergyManagerDbusClient::onChargingInfoRemoved(const QString &evChargerId)
{
    int index = indexOfInfo(evChargerId);
    if (index >= 0) {
        m_chargingInfos.removeAt(index);
        emit chargingInfoRemoved(evChargerId);
        emit chargingInfosUpdated(m_chargingInfos);
    }
}

void EnergyManagerDbusClient::onChargingInfoChanged(const QVariantMap &chargingInfo)
{
    replaceOrAdd(chargingInfo);
    emit chargingInfoChanged(chargingInfo);
    emit chargingInfosUpdated(m_chargingInfos);
}

int EnergyManagerDbusClient::indexOfInfo(const QString &evChargerId) const
{
    for (int i = 0; i < m_chargingInfos.count(); ++i) {
        const QVariantMap map = m_chargingInfos.at(i).toMap();
        if (map.value(QStringLiteral("evChargerId")).toString() == evChargerId) {
            return i;
        }
    }
    return -1;
}

void EnergyManagerDbusClient::replaceOrAdd(const QVariantMap &chargingInfo)
{
    const QString evChargerId = chargingInfo.value(QStringLiteral("evChargerId")).toString();
    int index = indexOfInfo(evChargerId);
    if (index >= 0) {
        m_chargingInfos[index] = chargingInfo;
    } else {
        m_chargingInfos.append(chargingInfo);
    }
}

bool EnergyManagerDbusClient::setupInterface()
{
    if (!m_connection.isConnected()) {
        return false;
    }

    QDBusConnectionInterface *bus = m_connection.interface();
    if (!bus || !bus->isServiceRegistered(kDbusService)) {
        return false;
    }

    if (m_interface && m_interface->isValid()) {
        return true;
    }

    delete m_interface;
    m_interface = new QDBusInterface(kDbusService, kDbusPath, kDbusInterface, m_connection, this);

    if (!m_interface->isValid()) {
        emit errorOccurred(QStringLiteral("EnergyManager DBus interface is not available"));
        delete m_interface;
        m_interface = nullptr;
        return false;
    }

    connect(m_interface, SIGNAL(chargingInfoAdded(QVariantMap)), this, SLOT(onChargingInfoAdded(QVariantMap)), Qt::UniqueConnection);
    connect(m_interface, SIGNAL(chargingInfoRemoved(QString)), this, SLOT(onChargingInfoRemoved(QString)), Qt::UniqueConnection);
    connect(m_interface, SIGNAL(chargingInfoChanged(QVariantMap)), this, SLOT(onChargingInfoChanged(QVariantMap)), Qt::UniqueConnection);

    return true;
}

void EnergyManagerDbusClient::onServiceRegistered(const QString &service)
{
    if (service != kDbusService) {
        return;
    }

    if (setupInterface()) {
        refreshChargingInfos();
    }
}

void EnergyManagerDbusClient::onServiceUnregistered(const QString &service)
{
    if (service != kDbusService) {
        return;
    }

    delete m_interface;
    m_interface = nullptr;
    m_chargingInfos.clear();
    emit chargingInfosUpdated(m_chargingInfos);
}
