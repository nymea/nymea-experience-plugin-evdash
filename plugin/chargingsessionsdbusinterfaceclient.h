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

#pragma once

#include <QObject>
#include <QDBusConnection>
#include <QList>
#include <QVariantMap>
#include <QStringList>
#include <QDBusServiceWatcher>

class QDBusInterface;
class QDBusPendingCallWatcher;
class QDBusServiceWatcher;

class ChargingSessionsDBusInterfaceClient : public QObject
{
    Q_OBJECT
public:
    explicit ChargingSessionsDBusInterfaceClient(QObject *parent = nullptr);
    ~ChargingSessionsDBusInterfaceClient();

    QList<QVariantMap> sessions() const;

public slots:
    void getSessions(const QStringList &carThingIds = QStringList(), qlonglong startTimestamp = 0, qlonglong endTimestamp = 0);

signals:
    void sessionsReceived(const QList<QVariantMap> &sessions);
    void errorOccurred(const QString &message);

private slots:
    void onCallFinished(QDBusPendingCallWatcher *watcher);
    void onServiceRegistered(const QString &service);
    void onServiceUnregistered(const QString &service);

private:
    bool ensureInterface();

    QDBusConnection m_connection;
    QDBusInterface *m_interface = nullptr;
    QDBusServiceWatcher *m_serviceWatcher = nullptr;
    QList<QVariantMap> m_sessions;
};
