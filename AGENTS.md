# Agent Instructions

Welcome to the nymea EV-Dash experience plugin repository. Please keep the following guidelines in mind when working on this codebase:

## Purpose
The dashboard should should give an overview of conofugred ev chargers in the system, show the status of each ev charger, information and provide 

## Structure
- The `plugin` directory contains the Qt c++ implementation of the experience plugin
  - The `EvDashJsonHandler` class provides the JSON RPC API definition and declaration of the experience
  - The `EvDashWebServerResource` represents the webserver HTTP backend and handles REST API requests and file requests starting with the path /evdash. This class provides file access to the static resources and provides secure generated data access
- The `dashboard` folder contains the webinterface, a html + js file based website representing the frontend. The interface will be compiled into the plugin using the dashboard.qrc file.
- The dashboard should be brandable, providing 3 colors and icons should allow to change the style of the webinterface
- The dashboard uses a websocket to communicate with the API interface in `EvDashEngine`.

## General workflow
- Keep pull request descriptions concise but informative, mentioning both user-visible changes and internal refactors.
- Prefer focused commits that touch related files together.

## C++/Qt coding style
- Follow the Qt coding conventions: camelCase for method names and member variables beginning with `m_`.
- Keep `#include` directives alphabetised within their groups (project headers before Qt and system headers).
- Use Qt container classes where the rest of the code already does so.
- Use Qt logging helpers (`qCDebug(dcEvDashExperience())`, `qCWarning(dcEvDashExperience())`, etc.) for new diagnostics. 

## Tests and verification
- When possible, run the relevant unit or integration tests and mention them in the final summary.

Thank you for contributing!
