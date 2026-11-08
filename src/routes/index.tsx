import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/")({ component: Home });

type NLRoot = HTMLElement & { __nlStop?: () => void };
type NLWindow = Window & { __nlMount?: () => void };

type Pack = { version: string; ipk: string; zip: string };

function latestPack(version: string): Pack {
  return {
    version,
    ipk: `/com.lustre.tv_${version}_all.ipk`,
    zip: `/lustre-simulator-${version}.zip`,
  };
}

function Downloads() {
  const [pack, setPack] = useState<Pack>(() => latestPack("1.2.13"));
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let gone = false;
    fetch("/version.json", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { version?: string } | null) => {
        if (gone || !body?.version) return;
        setPack(latestPack(body.version));
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, []);

  return (
    <div className="lustre-download">
      {open ? (
        <div className="lustre-download-choices">
          <a href={pack.ipk} download={`com.lustre.tv_${pack.version}_all.ipk`}>
            Television {pack.version}
          </a>
          <a href={pack.zip} download={`lustre-simulator-${pack.version}.zip`}>
            Simulator {pack.version}
          </a>
        </div>
      ) : null}
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        Download
      </button>
    </div>
  );
}

function Home() {
  const ref = useRef<NLRoot>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.dataset.nlRoot = "1";
    const w = window as NLWindow;

    function mount() {
      w.__nlMount?.();
    }

    let script = document.querySelector<HTMLScriptElement>("script[data-nl-bridge]");
    if (!script) {
      script = document.createElement("script");
      script.type = "module";
      script.src = "/tv/js/preview-bridge.js?v=44";
      script.dataset.nlBridge = "1";
      script.addEventListener("load", mount);
      document.head.appendChild(script);
    } else {
      script.addEventListener("load", mount);
      mount();
    }

    return () => {
      script?.removeEventListener("load", mount);
      el.__nlStop?.();
      delete el.dataset.nlMounted;
    };
  }, []);

  return (
    <>
      <main ref={ref} className="nl-root">
        <p className="nl-status">Lustre</p>
      </main>
      <nav className="lustre-legal" aria-label="Legal">
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="/install">Install</a>
        <Downloads />
      </nav>
    </>
  );
}