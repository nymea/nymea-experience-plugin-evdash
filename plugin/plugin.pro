TEMPLATE = lib
TARGET = $$qtLibraryTarget(nymea_experiencepluginevdash)

include(../config.pri)

CONFIG += plugin link_pkgconfig
PKGCONFIG += nymea

EVDASH_DEBIAN_VERSION = $$system(dpkg-parsechangelog --file $${_PRO_FILE_PWD_}/../debian/changelog --show-field Version)
EVDASH_BACKEND_VERSION = $$replace(EVDASH_DEBIAN_VERSION, ^[0-9]+:, )
EVDASH_BACKEND_VERSION = $$replace(EVDASH_BACKEND_VERSION, -[^-]+$, )
EVDASH_DASHBOARD_VERSION = 1.1.0
EVDASH_COPYRIGHT_YEAR = $$system(date +%Y)

isEmpty(EVDASH_BACKEND_VERSION): error("Could not determine the EV-Dash backend version from debian/changelog")
isEmpty(EVDASH_DASHBOARD_VERSION): error("The EV-Dash dashboard version must not be empty")
isEmpty(EVDASH_COPYRIGHT_YEAR): error("Could not determine the EV-Dash copyright year")

DEFINES += EVDASH_BACKEND_VERSION=\\\"$${EVDASH_BACKEND_VERSION}\\\"
DEFINES += EVDASH_DASHBOARD_VERSION=\\\"$${EVDASH_DASHBOARD_VERSION}\\\"
DEFINES += EVDASH_COPYRIGHT_YEAR=\\\"$${EVDASH_COPYRIGHT_YEAR}\\\"

RESOURCES += ../dashboard.qrc

QT -= gui
QT += network websockets dbus

HEADERS += experiencepluginevdash.h \
    energymanagerdbusclient.h \
    chargingsessionsdbusinterfaceclient.h \
    evdashengine.h \
    evdashjsonhandler.h \
    evdashsettings.h \
    evdashwebserverresource.h

SOURCES += experiencepluginevdash.cpp \
    energymanagerdbusclient.cpp \
    chargingsessionsdbusinterfaceclient.cpp \
    evdashengine.cpp \
    evdashjsonhandler.cpp \
    evdashsettings.cpp \
    evdashwebserverresource.cpp

target.path = $$[QT_INSTALL_LIBS]/nymea/experiences/
INSTALLS += target

# Install translation files
TRANSLATIONS *= $$files($${_PRO_FILE_PWD_}/translations/*ts, true)
lupdate.depends = FORCE
lupdate.depends += qmake_all
lupdate.commands = lupdate -recursive -no-obsolete $${_PRO_FILE_PWD_}/experience.pro
QMAKE_EXTRA_TARGETS += lupdate

# make lrelease to build .qm from .ts
lrelease.depends = FORCE
lrelease.commands += lrelease $$files($$_PRO_FILE_PWD_/translations/*.ts, true);
QMAKE_EXTRA_TARGETS += lrelease

translations.depends += lrelease
translations.path = /usr/share/nymea/translations
translations.files = $$[QT_SOURCE_TREE]/translations/*.qm
INSTALLS += translations
