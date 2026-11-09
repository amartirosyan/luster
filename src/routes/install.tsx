import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/install")({
  head: () => ({
    meta: [
      { title: "Install · Lustre" },
      {
        name: "description",
        content: "Install Lustre on an LG TV with Developer Mode.",
      },
    ],
  }),
  component: Install,
});

function Install() {
  const [version, setVersion] = useState("1.2.14");

  useEffect(() => {
    let gone = false;
    fetch("/version.json", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { version?: string } | null) => {
        if (gone || !body?.version) return;
        setVersion(body.version);
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, []);

  const file = `com.lustre.tv_${version}_all.ipk`;

  return (
    <article className="lustre-doc">
      <p className="lustre-doc-kicker">Lustre</p>
      <h1>Install on an LG TV</h1>
      <p className="lustre-doc-date">Developer Mode is required. This is a test install from your computer, not the LG Content Store.</p>
      <p>
        The television and the computer need to be on the same Wi-Fi. A guest network usually
        blocks the connection.
      </p>

      <h2>1. Turn on Developer Mode</h2>
      <ol>
        <li>
          Sign in at{" "}
          <a href="https://webostv.developer.lge.com">webostv.developer.lge.com</a> if you do
          not already have an account.
        </li>
        <li>On the television, open the LG Content Store and search for Developer Mode.</li>
        <li>Install that app, then open it from your apps.</li>
        <li>Sign in with the email and password from the developer site.</li>
        <li>Select Dev Mode Status so it turns on. The television restarts.</li>
        <li>Open Developer Mode again and select Key Server.</li>
      </ol>
      <p>
        Leave that screen up. The bottom left shows a 6-character passphrase. Developer Mode
        is a session: when it expires, or after enough restarts without a network, LG turns
        it off and removes test apps. Extend the session in this same app.
      </p>

      <h2>2. Install the tools</h2>
      <p>
        On the computer, install{" "}
        <a href="https://nodejs.org">Node.js</a>, then open a new terminal and run:
      </p>
      <pre>
        <code>npm install -g @webos-tools/cli</code>
      </pre>
      <p>Close the terminal, open it again, and check that the command is there:</p>
      <pre>
        <code>ares-install --version</code>
      </pre>

      <h2>3. Download Lustre</h2>
      <p>
        <a href={`/${file}`} download={file}>
          Download {file}
        </a>
      </p>

      <h2>4. Connect the computer to the TV</h2>
      <p>Add the television. The username is always <code>prisoner</code> and the port is <code>9922</code>.</p>
      <pre>
        <code>ares-setup-device</code>
      </pre>
      <ol>
        <li>Choose add.</li>
        <li>Device name: tv</li>
        <li>IP address: the address shown in Developer Mode.</li>
        <li>Port: 9922</li>
        <li>User: prisoner</li>
        <li>Set it as the default device and save.</li>
      </ol>
      <p>With Key Server still on, fetch the key and type the passphrase from the television:</p>
      <pre>
        <code>ares-novacom --device tv --getkey</code>
      </pre>
      <p>Check the connection:</p>
      <pre>
        <code>ares-device --system-info --device tv</code>
      </pre>

      <h2>5. Install and open it</h2>
      <p>On Windows, from the folder where the file was saved:</p>
      <pre>
        <code>{`cd %USERPROFILE%\\Downloads
ares-install --device tv ${file}
ares-launch --device tv com.lustre.tv`}</code>
      </pre>
      <p>On a Mac or Linux, use the folder you downloaded into:</p>
      <pre>
        <code>{`cd ~/Downloads
ares-install --device tv ${file}
ares-launch --device tv com.lustre.tv`}</code>
      </pre>
      <p>Lustre then appears with your other apps. Open it from the home screen after that.</p>

      <h2>6. Add photos</h2>
      <p>
        Scan the code with your phone, choose the photos in Google Photos, and press Done.
        On the remote, up and down move the highlight and OK presses it. You do not need
        the pointer. Left and right change the photo during a show.
      </p>

      <h2>Later versions</h2>
      <p>
        After this install, opening Lustre loads a newer published version from the site.
        Use the computer again only if the app was removed, or if you want a new home-screen
        icon. The icon does not change by itself.
      </p>

      <h2>Home Assistant</h2>
      <p>
        Home Assistant can open Lustre and play an album that is already saved on that
        television. Add the LG webOS TV integration first and accept the connection on the
        TV. Home Assistant does not install Lustre, and it does not copy photos. Each set
        keeps its own albums. A shared album plays the same way once it is on that
        television, and each television keeps its own pace.
      </p>
      <p>
        Use the album name shown in Lustre, or its id. Capital letters do not matter. If two
        albums share a name, the newer one plays. The television needs to be on.
      </p>
      <pre>
        <code>{`action: webostv.command
target:
  entity_id: media_player.living_room_tv
data:
  command: system.launcher/launch
  payload:
    id: com.lustre.tv
    params:
      album: Sunday`}</code>
      </pre>
      <p>
        Change the entity to your television and <code>Sunday</code> to the album name. The
        same action works in a script or an automation. Leave out <code>params</code> to open
        Lustre on its screensaver album, if one is set.
      </p>

      <h2>If the computer cannot see the TV</h2>
      <ul>
        <li>Dev Mode Status is on, and Key Server was selected before the key command.</li>
        <li>The passphrase is the 6 characters on the screen now. It is case sensitive.</li>
        <li>The IP address is the one on that screen, not a guess.</li>
        <li>The computer is on the same network as the television.</li>
      </ul>
      <p>Then fetch the key again and check the connection:</p>
      <pre>
        <code>{`ares-novacom --device tv --getkey
ares-device --system-info --device tv`}</code>
      </pre>

      <p className="lustre-doc-nav">
        <Link to="/">Home</Link>
        <a href={`/${file}`} download={file}>
          Download
        </a>
      </p>
    </article>
  );
}
