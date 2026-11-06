import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

export const Route = createFileRoute("/")({ component: Home });

type NLRoot = HTMLElement & { __nlStop?: () => void };
type NLWindow = Window & { __nlMount?: () => void };

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
      script.src = "/tv/js/preview-bridge.js?v=33";
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
      </nav>
    </>
  );
}
