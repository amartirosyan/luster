import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy · Lustre" },
      {
        name: "description",
        content: "How Lustre uses the photos you choose from Google Photos.",
      },
    ],
  }),
  component: Privacy,
});

function Privacy() {
  return (
    <article className="lustre-doc">
      <p className="lustre-doc-kicker">Lustre</p>
      <h1>Privacy Policy</h1>
      <p className="lustre-doc-date">Effective 9 November 2026</p>
      <p>
        Lustre is a television photo show at <a href="https://lustre.show">lustre.show</a>.
        This policy explains what we receive when you connect Google Photos, what we do with
        it, and how to remove it. Lustre is not directed at children under 13.
      </p>

      <h2>What you sign in to</h2>
      <p>
        Sign-in happens on your phone, not by typing a password on the television. Lustre
        asks Google only for this permission:
      </p>
      <p>
        <code>https://www.googleapis.com/auth/photospicker.mediaitems.readonly</code>
      </p>
      <p>
        That is the Google Photos Picker. It lets Lustre see and download the photos you
        select in that session, and nothing else. Lustre cannot browse your library, your
        albums, your contacts, or your email.
      </p>

      <h2>What we receive</h2>
      <p>When you press Done in Google Photos, Google gives Lustre, for those photos only:</p>
      <ul>
        <li>A short-lived access token for that session</li>
        <li>The file name, type, and the time the photo was taken, when Google provides them</li>
        <li>A temporary address Lustre uses to download the picture</li>
        <li>The picture itself, which the television downloads from Google</li>
      </ul>

      <h2>How we use it</h2>
      <p>
        The pictures are shown as a slideshow on the television. If you save an album, the
        copies stay on that television so the show can play again without signing in. Lustre
        does not use Google data for advertising, and it does not sell it.
      </p>
      <p>
        Lustre’s use and transfer of information received from Google APIs will adhere to
        the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2>Where it is stored</h2>
      <p>
        The television keeps saved albums in its own local storage. A show you send to one
        television is downloaded by that television. For that one-television handoff, the
        server keeps the short-lived Google access token only until the television has
        received the selection, the code expires, or you start again. The token is not a
        standing login.
      </p>
      <p>
        A shared album is different. The pictures you select are copied onto Lustre’s server
        so every television you add can download them, including a television in another
        house. Google’s photo links expire after about an hour, so the server keeps the
        picture bytes themselves. The Google token stays on the server for that save and is
        deleted when the save finishes or the sign-in expires. It is not sent to the
        televisions. Each television gets its own membership, which you can remove. The
        join code adds a television; making a new code stops future joins and does not
        remove televisions already in the album.
      </p>

      <h2>Who else sees it</h2>
      <p>
        Google receives the sign-in and the picker request, because that is how the photos
        are chosen and downloaded. Lustre does not give your photos or your Google token to
        anyone else. We do not let people at Lustre read your photos unless you ask us to
        help with a problem, we need to for security, or the law requires it.
      </p>

      <h2>How to remove it</h2>
      <p>
        On the television, open Albums and remove an album. That deletes those copies from
        the television. Leave stops that television from receiving new shared photos and
        keeps what it already downloaded. On the phone, remove a photo or delete the shared
        album to delete those copies from Lustre’s server. Televisions drop a removed photo
        the next time they check in. To stop Lustre from asking Google again, revoke Lustre
        at{" "}
        <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy or your Google data:{" "}
        <a href="mailto:privacy@lustre.show">privacy@lustre.show</a>.
      </p>

      <p className="lustre-doc-nav">
        <Link to="/">Home</Link>
        <Link to="/terms">Terms</Link>
      </p>
    </article>
  );
}
