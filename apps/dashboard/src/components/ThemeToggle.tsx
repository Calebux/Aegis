"use client";

import { useEffect, useSyncExternalStore } from "react";

const THEME_EVENT = "aegis-theme-change";

function subscribe(callback: () => void) {
  window.addEventListener(THEME_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(THEME_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function getSnapshot() {
  return document.documentElement.getAttribute("data-theme") === "light";
}

function getServerSnapshot() {
  return false;
}

export function ThemeToggle() {
  const light = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    const next = localStorage.getItem("aegis-theme") === "light";
    if (next) {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    window.dispatchEvent(new Event(THEME_EVENT));
  }, []);

  function toggle() {
    const next = !light;
    document.documentElement.toggleAttribute("data-theme", next);
    if (next) document.documentElement.setAttribute("data-theme", "light");
    localStorage.setItem("aegis-theme", next ? "light" : "dark");
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  return (
    <button onClick={toggle} className="theme-toggle" title="Toggle light/dark mode">
      {light ? "DARK" : "LIGHT"}
    </button>
  );
}
