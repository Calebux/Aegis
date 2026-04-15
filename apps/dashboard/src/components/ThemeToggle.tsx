"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [light, setLight] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("aegis-theme");
    if (saved === "light") {
      document.documentElement.setAttribute("data-theme", "light");
      setLight(true);
    }
  }, []);

  function toggle() {
    const next = !light;
    setLight(next);
    if (next) {
      document.documentElement.setAttribute("data-theme", "light");
      localStorage.setItem("aegis-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("aegis-theme", "dark");
    }
  }

  return (
    <button onClick={toggle} className="theme-toggle" title="Toggle light/dark mode">
      {light ? "DARK" : "LIGHT"}
    </button>
  );
}
