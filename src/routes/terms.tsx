import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service · Lustre" },
      {
        name: "description",
        content: "The terms for using Lustre, the television photo show.",
      },
    ],
  }),
  component: Terms,
});

function Terms() {
  return (
    <article className="lustre-doc">
      <p className="lustre-doc-kicker">Lustre</p>
      <h1>Terms of Service</h1>
      <p className="lustre-doc-date">Effective 9 November 2026</p>
      <p>
        These terms cover the Lustre photo show at <a href="https://lustre.show">lustre.show</a>{" "}
        and the Lustre application for LG webOS televisions. By scanning a code, signing in
        with Google, or playing a show, you agree to them.
      </p>

      <h2>The service</h2>
      <p>
        Lustre plays photos you choose on a television. You pick the photos in Google Photos
        on your phone. Lustre then shows those photos, and it can keep a copy on the
        television as an album. A shared album also keeps a copy on Lustre’s server until
        you delete that photo or that album. Lustre is not a backup of your Google Photos
        library, and it does not replace the television’s own screensaver.
      </p>

      <h2>Your account</h2>
      <p>
        You sign in with a Google account you are allowed to use. You choose which photos to
        send. You are responsible for the rights to those photos. Do not send photos you are
        not allowed to display.
      </p>

      <h2>Acceptable use</h2>
      <p>Do not use Lustre to break the law, to harm someone, or to interfere with the service. We may stop a session that is used that way.</p>

      <h2>Google</h2>
      <p>
        Google Photos is Google’s service. Your use of it follows Google’s terms as well as
        these. Lustre only receives the photos you select, as described in the{" "}
        <Link to="/privacy">Privacy Policy</Link>.
      </p>

      <h2>The television</h2>
      <p>
        Saved albums stay on the television until you remove them. Clearing the app, or
        removing the app, can delete those copies. Lustre does not promise that a television
        will keep them forever.
      </p>

      <h2>As is</h2>
      <p>
        Lustre is provided as is. The show can fail if Google, the network, or the television
        fails. We do not promise uninterrupted service. To the extent the law allows, Lustre
        is not liable for lost photos, lost shows, or damage from using the service. Nothing
        here limits liability that the law does not allow to be limited.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms by posting a new version on this page. The date at the top
        will change. Continuing to use Lustre after that means you accept the new terms.
      </p>

      <h2>Contact</h2>
      <p>
        <a href="mailto:privacy@lustre.show">privacy@lustre.show</a>
      </p>

      <p className="lustre-doc-nav">
        <Link to="/">Home</Link>
        <Link to="/privacy">Privacy</Link>
      </p>
    </article>
  );
}
