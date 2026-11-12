# Lustre

Lustre is a photo player for LG televisions. The live site is [lustre.show](https://lustre.show). The current build is **1.2.14**.

[![Add Lustre to your Home Assistant](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=amartirosyan&repository=luster&category=integration)

Press the button above. It opens Home Assistant and adds this repository. On Home Assistant 2026.11 or newer that is Settings, Marketplace. On an older version it is HACS. Choose Lustre, then Download. After it finishes, go to Settings, Devices & services, Add integration, and choose Lustre. Pick the LG televisions. You do not copy any files.

The address you save on the television is `homeassistant.local:8123`, or the IP if that name does not resolve. The first album you save becomes the screensaver when none is set. Press Sync on an album loaded from the phone. The other televisions that are on ask before they download.

`LUSTRE.md` is the handoff for the bot that maintains this repo. The television app lives in `public/tv`. The site is the TanStack app in `src`. The Home Assistant integration lives in `custom_components/lustre`.
