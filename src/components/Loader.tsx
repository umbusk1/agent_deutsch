"use client";

import { useEffect, useState } from "react";

type LoaderProps = {
  /** Frases efímeras que rotan mientras se procesa, dando sensación de actividad sin exponer el detalle interno. */
  messages: string[];
  intervalMs?: number;
};

export function Loader({ messages, intervalMs = 1800 }: LoaderProps) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (messages.length <= 1) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % messages.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [messages, intervalMs]);

  return (
    <div className="umbusk-loader-block">
      <div className="umbusk-loader-wrap" role="status" aria-label="Umbusk está procesando">
        {/* eslint-disable-next-line @next/next/no-img-element -- animación con transform/CSS puro, no necesita next/image */}
        <img className="umbusk-loader" alt="" src="/umbusk-loader.png" />
      </div>
      {messages[index] && <p className="umbusk-loader-message">{messages[index]}</p>}
    </div>
  );
}
