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

#include "experiencepluginevdash.h"

#include "evdashengine.h"
#include "evdashjsonhandler.h"
#include "evdashwebserverresource.h"

#include <jsonrpc/jsonrpcserver.h>
#include <loggingcategories.h>

NYMEA_LOGGING_CATEGORY(dcEvDashExperience, "EvDashExperience")

ExperiencePluginEvDash::ExperiencePluginEvDash() {}

void ExperiencePluginEvDash::init()
{
    qCDebug(dcEvDashExperience()) << "Initializing experience...";

    m_resource = new EvDashWebServerResource(this);
    m_engine = new EvDashEngine(thingManager(), logEngine(), m_resource, this);

    jsonRpcServer()->registerExperienceHandler(new EvDashJsonHandler(m_engine, m_resource, this), 1, 0);
}

WebServerResource *ExperiencePluginEvDash::webServerResource() const
{
    return m_resource;
}
