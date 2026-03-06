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

QVariantList EnergyManagerDbusClient::chargingConfigurations() const
{
    return m_chargingConfigurations;
}

QVariantList EnergyManagerDbusClient::chargingStates() const
{
    return m_chargingStates;
}

void EnergyManagerDbusClient::refreshChargingData()
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

    const QDBusReply<QVariantList> chargingConfigurationsReply = m_interface->call(QStringLiteral("chargingConfigurations"));
    if (!chargingConfigurationsReply.isValid()) {
        emit errorOccurred(chargingConfigurationsReply.error().message());
        return;
    }

    const QDBusReply<QVariantList> chargingStatesReply = m_interface->call(QStringLiteral("chargingStates"));
    if (!chargingStatesReply.isValid()) {
        emit errorOccurred(chargingStatesReply.error().message());
        return;
    }

    m_chargingConfigurations = deserializeVariantMapList(chargingConfigurationsReply.value());
    m_chargingStates = deserializeVariantMapList(chargingStatesReply.value());

    emit chargingConfigurationsUpdated(m_chargingConfigurations);
    emit chargingStatesUpdated(m_chargingStates);
}

QVariantList EnergyManagerDbusClient::deserializeVariantMapList(const QVariantList &values)
{
    QVariantList deserializedValues;
    for (const QVariant &value : values) {
        if (value.canConvert<QVariantMap>()) {
            deserializedValues.append(value.toMap());
            continue;
        }

        const QDBusArgument arg = value.value<QDBusArgument>();
        deserializedValues.append(qdbus_cast<QVariantMap>(arg));
    }

    return deserializedValues;
}

void EnergyManagerDbusClient::onChargingConfigurationAdded(const QVariantMap &chargingConfiguration)
{
    replaceOrAddEntry(m_chargingConfigurations, chargingConfiguration);
    emit chargingConfigurationAdded(chargingConfiguration);
    emit chargingConfigurationsUpdated(m_chargingConfigurations);
}

void EnergyManagerDbusClient::onChargingConfigurationRemoved(const QString &evChargerId)
{
    const int index = indexOfEntry(m_chargingConfigurations, evChargerId);
    if (index >= 0) {
        m_chargingConfigurations.removeAt(index);
        emit chargingConfigurationRemoved(evChargerId);
        emit chargingConfigurationsUpdated(m_chargingConfigurations);
    }
}

void EnergyManagerDbusClient::onChargingConfigurationChanged(const QVariantMap &chargingConfiguration)
{
    replaceOrAddEntry(m_chargingConfigurations, chargingConfiguration);
    emit chargingConfigurationChanged(chargingConfiguration);
    emit chargingConfigurationsUpdated(m_chargingConfigurations);
}

void EnergyManagerDbusClient::onChargingStateAdded(const QVariantMap &chargingState)
{
    replaceOrAddEntry(m_chargingStates, chargingState);
    emit chargingStateAdded(chargingState);
    emit chargingStatesUpdated(m_chargingStates);
}

void EnergyManagerDbusClient::onChargingStateRemoved(const QString &evChargerId)
{
    const int index = indexOfEntry(m_chargingStates, evChargerId);
    if (index >= 0) {
        m_chargingStates.removeAt(index);
        emit chargingStateRemoved(evChargerId);
        emit chargingStatesUpdated(m_chargingStates);
    }
}

void EnergyManagerDbusClient::onChargingStateChanged(const QVariantMap &chargingState)
{
    replaceOrAddEntry(m_chargingStates, chargingState);
    emit chargingStateChanged(chargingState);
    emit chargingStatesUpdated(m_chargingStates);
}

int EnergyManagerDbusClient::indexOfEntry(const QVariantList &entries, const QString &evChargerId) const
{
    for (int i = 0; i < entries.count(); ++i) {
        const QVariantMap map = entries.at(i).toMap();
        if (map.value(QStringLiteral("evChargerId")).toString() == evChargerId) {
            return i;
        }
    }
    return -1;
}

void EnergyManagerDbusClient::replaceOrAddEntry(QVariantList &entries, const QVariantMap &entry)
{
    const QString evChargerId = entry.value(QStringLiteral("evChargerId")).toString();
    const int index = indexOfEntry(entries, evChargerId);
    if (index >= 0) {
        entries[index] = entry;
    } else {
        entries.append(entry);
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

    connect(m_interface, SIGNAL(chargingConfigurationAdded(QVariantMap)), this, SLOT(onChargingConfigurationAdded(QVariantMap)), Qt::UniqueConnection);
    connect(m_interface, SIGNAL(chargingConfigurationRemoved(QString)), this, SLOT(onChargingConfigurationRemoved(QString)), Qt::UniqueConnection);
    connect(m_interface, SIGNAL(chargingConfigurationChanged(QVariantMap)), this, SLOT(onChargingConfigurationChanged(QVariantMap)), Qt::UniqueConnection);

    connect(m_interface, SIGNAL(chargingStateAdded(QVariantMap)), this, SLOT(onChargingStateAdded(QVariantMap)), Qt::UniqueConnection);
    connect(m_interface, SIGNAL(chargingStateRemoved(QString)), this, SLOT(onChargingStateRemoved(QString)), Qt::UniqueConnection);
    connect(m_interface, SIGNAL(chargingStateChanged(QVariantMap)), this, SLOT(onChargingStateChanged(QVariantMap)), Qt::UniqueConnection);

    return true;
}

void EnergyManagerDbusClient::onServiceRegistered(const QString &service)
{
    if (service != kDbusService) {
        return;
    }

    if (setupInterface()) {
        refreshChargingData();
    }
}

void EnergyManagerDbusClient::onServiceUnregistered(const QString &service)
{
    if (service != kDbusService) {
        return;
    }

    delete m_interface;
    m_interface = nullptr;
    m_chargingConfigurations.clear();
    m_chargingStates.clear();
    emit chargingConfigurationsUpdated(m_chargingConfigurations);
    emit chargingStatesUpdated(m_chargingStates);
}
