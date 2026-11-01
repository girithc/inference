"use client";

import { useEffect, useRef } from "react";

export function ScrollProgress() {
  const fill = useRef<HTMLDivElement>(null);
  const rider = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;

    const update = () => {
      raf = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const frac = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      if (fill.current) fill.current.style.transform = `scaleY(${frac})`;
      if (rider.current) rider.current.style.top = `${frac * 100}%`;
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="rail" aria-hidden="true">
      <div className="rail-line" />
      <div className="rail-fill" ref={fill} />
      <div className="rail-rider" ref={rider} />
    </div>
  );
}
