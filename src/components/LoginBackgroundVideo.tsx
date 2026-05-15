"use client";

import { useEffect, useRef, useState } from "react";

const CROSSFADE_SEC = 1.2;

export default function LoginBackgroundVideo({ src }: { src: string }) {
  const aRef = useRef<HTMLVideoElement | null>(null);
  const bRef = useRef<HTMLVideoElement | null>(null);
  const [active, setActive] = useState<"a" | "b">("a");
  const swappingRef = useRef(false);

  useEffect(() => {
    const a = aRef.current;
    const b = bRef.current;
    if (!a || !b) return;
    a.play().catch(() => {});
    b.pause();
    b.currentTime = 0;
  }, []);

  function handleTimeUpdate(which: "a" | "b") {
    if (which !== active) return;
    const current = which === "a" ? aRef.current : bRef.current;
    const other = which === "a" ? bRef.current : aRef.current;
    if (!current || !other) return;
    const dur = current.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    if (current.currentTime >= dur - CROSSFADE_SEC && !swappingRef.current) {
      swappingRef.current = true;
      other.currentTime = 0;
      other.play().catch(() => {});
      setActive(which === "a" ? "b" : "a");
      window.setTimeout(() => {
        swappingRef.current = false;
        current.pause();
        current.currentTime = 0;
      }, CROSSFADE_SEC * 1000);
    }
  }

  const base =
    "pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-[1200ms] ease-linear";

  return (
    <>
      <video
        ref={aRef}
        className={`${base} ${active === "a" ? "opacity-100" : "opacity-0"}`}
        autoPlay
        muted
        playsInline
        preload="auto"
        aria-hidden
        onTimeUpdate={() => handleTimeUpdate("a")}
      >
        <source src={src} type="video/mp4" />
      </video>
      <video
        ref={bRef}
        className={`${base} ${active === "b" ? "opacity-100" : "opacity-0"}`}
        muted
        playsInline
        preload="auto"
        aria-hidden
        onTimeUpdate={() => handleTimeUpdate("b")}
      >
        <source src={src} type="video/mp4" />
      </video>
    </>
  );
}
