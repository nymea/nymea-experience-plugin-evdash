// SPDX-License-Identifier: GPL-3.0-or-later

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
*
* Copyright (C) 2013 - 2024, nymea GmbH
* Copyright (C) 2024 - 2025, chargebyte austria GmbH
*
* This file is part of nymea-energy-plugin-nymea.
*
* nymea-energy-plugin-nymea.s free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
*
* nymea-energy-plugin-nymea.s distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with nymea-energy-plugin-nymea. If not, see <https://www.gnu.org/licenses/>.
*
* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

#ifndef ENERGYMANAGERDBUSCLIENT_H
#define ENERGYMANAGERDBUSCLIENT_H

#include <QObject>
#include <QVariantList>
#include <QDBusConnection>

class QDBusInterface;
class QDBusPendingCallWatcher;
class QDBusServiceWatcher;

class EnergyManagerDbusClient : public QObject
{
    Q_OBJECT
public:
    explicit EnergyManagerDbusClient(QObject *parent = nullptr);
    ~EnergyManagerDbusClient();

    QVariantList chargingInfos() const;

public slots:
    void refreshChargingInfos();

signals:
    void chargingInfosUpdated(const QVariantList &chargingInfos);
    void chargingInfoAdded(const QVariantMap &chargingInfo);
    void chargingInfoRemoved(const QString &evChargerId);
    void chargingInfoChanged(const QVariantMap &chargingInfo);
    void errorOccurred(const QString &message);

private slots:
    void onChargingInfoAdded(const QVariantMap &chargingInfo);
    void onChargingInfoRemoved(const QString &evChargerId);
    void onChargingInfoChanged(const QVariantMap &chargingInfo);
    void onServiceRegistered(const QString &service);
    void onServiceUnregistered(const QString &service);

private:
    int indexOfInfo(const QString &evChargerId) const;
    void replaceOrAdd(const QVariantMap &chargingInfo);
    bool setupInterface();

    QDBusConnection m_connection;
    QDBusInterface *m_interface = nullptr;
    QDBusServiceWatcher *m_serviceWatcher = nullptr;
    QVariantList m_chargingInfos;
};

#endif // ENERGYMANAGERDBUSCLIENT_H
