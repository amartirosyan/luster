# Lustre

Lustre is a photo player for LG televisions. The live site is [lustre.show](https://lustre.show). The current build is **1.2.14**.

[![Add Lustre to your Home Assistant](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=amartirosyan&repository=luster&category=integration)

## Install

On this page in Home Assistant, press **Install**. Then go to Settings, Devices & services, add Lustre, and choose the LG televisions. The LG webOS TV integration has to be set up first. You do not copy any files.

## On the television

Open Preferences and save the Home Assistant address, such as `homeassistant.local:8123`. Load the photos from the phone. The first album becomes the screensaver when none is set. Press Sync on that album. Each other television that is on asks before it downloads.

Home Assistant does not copy the photos. It only keeps a short code for about an hour. A television that is off during that hour cannot catch up.

The television app lives in `public/tv`. The Home Assistant integration lives in `custom_components/lustre`.
