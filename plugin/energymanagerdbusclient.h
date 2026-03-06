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

#ifndef ENERGYMANAGERDBUSCLIENT_H
#define ENERGYMANAGERDBUSCLIENT_H

#include <QDBusConnection>
#include <QObject>
#include <QVariantList>
#include <QVariantMap>

class QDBusInterface;
class QDBusServiceWatcher;

class EnergyManagerDbusClient : public QObject
{
    Q_OBJECT
public:
    explicit EnergyManagerDbusClient(QObject *parent = nullptr);
    ~EnergyManagerDbusClient();

    QVariantList chargingConfigurations() const;
    QVariantList chargingStates() const;

public slots:
    void refreshChargingData();

signals:
    void chargingConfigurationsUpdated(const QVariantList &chargingConfigurations);
    void chargingConfigurationAdded(const QVariantMap &chargingConfiguration);
    void chargingConfigurationRemoved(const QString &evChargerId);
    void chargingConfigurationChanged(const QVariantMap &chargingConfiguration);

    void chargingStatesUpdated(const QVariantList &chargingStates);
    void chargingStateAdded(const QVariantMap &chargingState);
    void chargingStateRemoved(const QString &evChargerId);
    void chargingStateChanged(const QVariantMap &chargingState);

    void errorOccurred(const QString &message);

private slots:
    void onChargingConfigurationAdded(const QVariantMap &chargingConfiguration);
    void onChargingConfigurationRemoved(const QString &evChargerId);
    void onChargingConfigurationChanged(const QVariantMap &chargingConfiguration);
    void onChargingStateAdded(const QVariantMap &chargingState);
    void onChargingStateRemoved(const QString &evChargerId);
    void onChargingStateChanged(const QVariantMap &chargingState);
    void onServiceRegistered(const QString &service);
    void onServiceUnregistered(const QString &service);

private:
    static QVariantList deserializeVariantMapList(const QVariantList &values);
    int indexOfEntry(const QVariantList &entries, const QString &evChargerId) const;
    void replaceOrAddEntry(QVariantList &entries, const QVariantMap &entry);
    bool setupInterface();

    QDBusConnection m_connection;
    QDBusInterface *m_interface = nullptr;
    QDBusServiceWatcher *m_serviceWatcher = nullptr;
    QVariantList m_chargingConfigurations;
    QVariantList m_chargingStates;
};

#endif // ENERGYMANAGERDBUSCLIENT_H
