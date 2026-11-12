# Lustre

You own Lustre. It is a quiet, cinematic photo show for LG webOS televisions. People scan a code on the TV, pick photos in Google Photos on a phone, and the TV plays them with a slow glide. The site is https://lustre.show. The domain DNS is Cloudflare, A record `@` to `216.150.1.1`.

Do not rebuild it. Change the working app. Keep the motion smooth even if a photo takes longer. Never add sudden zooms.

## Version

Current release is **1.2.14**.

On every publish, raise only the last number: 1.2.3, 1.2.4, and so on. Do not change 1 or 2 unless Armen asks.

Keep these in step, then rebuild both packages:

- `public/tv/appinfo.json`
- `public/tv/js/player.js` (`REV`)
- `public/version.json`
- `public/tv/version.json`
- the IPK name `com.lustre.tv_X.Y.Z_all.ipk`
- the simulator zip `lustre-simulator-X.Y.Z.zip`

Package with `ares-package` from `public/tv` into `public/`. The simulator zip is the `public/tv` folder, not the IPK. The site buttons must point at those versioned files. Do not leave them on `lustre-webos.zip`.

## What it does

- Phone pairing by QR. Sign-in happens on the phone, not by typing a password on the TV.
- Google Photos Picker only. Scope is `https://www.googleapis.com/auth/photospicker.mediaitems.readonly`. Client id is `138429037112-mdemf0lnbie5vsjtl2h1ssqt8nbh5mt2.apps.googleusercontent.com`. The Cloud project is `northlight`. Branding is verified. The Photos scope is not a sensitive scope that needs extra approval. The app does not read a whole library or album. The person must select photos and press Done.
- After a phone opens the code, the TV shows a new code and still collects the photos from the scanned one.
- Photos are saved on that television as an album. Albums can be renamed, played, and chosen as the screensaver.
- Portrait motion glides between faces and the full photo. Randomize the move: in from the left, in from the right, or out from the center. Always keep some movement. Show the whole photo at the start or the end. Do not cut off faces. Ignore faces that are inside artwork or frames on a wall.
- A vertical photo sits on a blurred copy of itself. The preference is None, Smooth, Cinema, Feathered, or Color wash. It is stored on the TV. Color wash is the default until they pick another.
- Fade about 2 seconds between photos. A photo should stay under 20 seconds and still feel like a glide.
- The first photo starts the show. The rest load behind it. Every show plays from the earliest photo taken to the latest. Saved albums keep that time.
- The opening screen shows the version once. It does not offer “Open here” or “On this device”. LG does not let the app save a new package onto the television, so do not call the download service. From 1.2.8 on, a newer published version is loaded from lustre.show the next time the app opens.

## Do not forget

- webOS cannot run a server on the TV, and it cannot find Home Assistant on the network. The address is saved in Preferences on the television. Sync on an album posts `{ pair, screensaver: true }` to `http://that-address:8123/api/webhook/lustre`. The integration in `custom_components/lustre` then opens the other televisions, and each one asks before it downloads. That folder must stay at the repository root so the Marketplace can install it. `hacs.json` and the button in `README.md` are part of that. The session on lustre.show lasts about an hour. A newly saved album becomes the screensaver when none is set. `params.album` still plays a saved album by name or id. Without those params, a screensaver album still plays if one is set.
- Pairing state is an in-memory map on the server. A phone and a TV can hit different copies and the code looks expired. A new code fixes that one time. Durable pairing storage is not built.
- Motion on a real LG TV must stay on the GPU: transforms and the Web Animations API, not width, height, or a CSS blur every frame. The side image is a baked plate.
- Fonts ship inside the app. Do not rely on the simulator’s fonts.
- Google accounts other than the owner can use it. If someone is blocked, it is the Google unverified-app warning or a missed Done press, not an allow list.
- Alpha v1 is kept under `backup/alpha-v1`. Do not overwrite it.

## Publish

The site publish updates lustre.show. The home page links to `/install` for the Developer Mode steps. A television running 1.2.8 or newer picks up the next published version when Lustre opens again. Anything older has to be installed once from a computer, because the set blocks the download.

Windows install, after the device is already set up:

```
cd %USERPROFILE%\Downloads
ares-install --device tv com.lustre.tv_X.Y.Z_all.ipk
ares-launch --device tv com.lustre.tv
```
