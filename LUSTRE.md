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
- A shared album is one set of photos on many televisions. The phone creates it and adds photos with the same Picker flow. A television joins with an 8-character code, or the phone scans that television’s code and adds it. Each television plays at its own pace. They are not locked together. The phone can remove a photo, delete the album, or remove a television. A television can leave. Copies already on a television keep playing if the server cannot be reached. Home Assistant still launches whatever album is already saved on that television, by `params.album` name or id.
- Portrait motion glides between faces and the full photo. Randomize the move: in from the left, in from the right, or out from the center. Always keep some movement. Show the whole photo at the start or the end. Do not cut off faces. Ignore faces that are inside artwork or frames on a wall.
- A vertical photo sits on a blurred copy of itself. The preference is None, Smooth, Cinema, Feathered, or Color wash. It is stored on the TV. Color wash is the default until they pick another.
- Fade about 2 seconds between photos. A photo should stay under 20 seconds and still feel like a glide.
- The first photo starts the show. The rest load behind it. Every show plays from the earliest photo taken to the latest. Saved albums keep that time.
- The opening screen shows the version once. It does not offer “Open here” or “On this device”. LG does not let the app save a new package onto the television, so do not call the download service. From 1.2.8 on, a newer published version is loaded from lustre.show the next time the app opens.

## Do not forget

- webOS cannot run a server on the TV. Home Assistant launches Lustre with `system.launcher/launch`, app id `com.lustre.tv`, and `params.album` set to a saved album name or id. That album plays immediately. A matching name uses the newest album. Without `album`, a screensaver album still plays if one is set.
- Pairing codes, shared-album membership, join codes, and shared photo bytes are stored in Postgres (`DATABASE_URL`). An in-memory map is not used. Without `DATABASE_URL` on Vercel the pairing and shared-album routes fail closed, because a local file would not be shared across server instances. Local development and tests use PGLite when `DATABASE_URL` is unset. The schema is `migrations/0002_shared_albums.sql`. The server applies it the first time it opens the database and records that in `_migrations`. Do not point this app at a production database just to try a migration.
- Google Picker links expire in about an hour and need the OAuth bearer, so a shared album cannot keep those links. The phone signs in, the server downloads each selected photo at `=w1600-h1600` (smaller if needed), and stores the bytes in Postgres. The Google token is deleted when that save finishes. Televisions never receive it. One photo is saved per request so a serverless call can finish. Vercel’s response limit is about 4.5 MB, so a stored photo is refused above 4 MB. An album holds up to 200 photos.
- A television asks the server about every 30 seconds whether the revision changed. If it did not, the reply is a small unchanged note. New bytes are downloaded one photo at a time, after the first photo has already started. webOS does not run a server; the television calls out.
- The phone keeps an owner key in its browser storage. That key is required to add or remove photos and televisions. Losing the key means the album cannot be managed from that phone; televisions already joined keep playing. The key is shown on the shared-album page. It is not a Google password and it must not be committed.
- Known limits: the Picker does not watch a Google Photos album. Adding photos means selecting them again and pressing Done. Removing a photo is done on the Lustre phone page, not by deleting it in Google. Photos added during a show join the rotation without restarting the current glide; the next time that album starts, it plays from earliest to latest. A television that was off catches up the next time it can reach the server. Leaving or being removed stops new photos and keeps what is already downloaded.
- Motion on a real LG TV must stay on the GPU: transforms and the Web Animations API, not width, height, or a CSS blur every frame. The side image is a baked plate.
- Fonts ship inside the app. Do not rely on the simulator’s fonts.
- Google accounts other than the owner can use it. If someone is blocked, it is the Google unverified-app warning or a missed Done press, not an allow list.
- Alpha v1 is kept under `backup/alpha-v1`. Do not overwrite it.

## Shared album setup

Production needs a Postgres database the Vercel project can reach. Set `DATABASE_URL` in the Vercel project environment. Neon is a fit. The URL is a secret. Do not commit it, and do not run the migration by hand against a live database from a workstation unless you mean to change that database. The first request after deploy applies `migrations/0002_shared_albums.sql` once.

No extra blob host is required. Photo bytes live in the `shared_photos` table. That keeps one database for membership and for the pictures. A large album is a large Postgres row set; 200 photos at a few hundred kilobytes each is the size to plan for. Deleting a photo or the album deletes those bytes.

The phone page is `/tv/share.html`. The television page is unchanged: Albums, then a join code or “Use phone”.

## Publish

The site publish updates lustre.show. The home page links to `/install` for the Developer Mode steps. A television running 1.2.8 or newer picks up the next published version when Lustre opens again. Anything older has to be installed once from a computer, because the set blocks the download.

Windows install, after the device is already set up:

```
cd %USERPROFILE%\Downloads
ares-install --device tv com.lustre.tv_X.Y.Z_all.ipk
ares-launch --device tv com.lustre.tv
```
