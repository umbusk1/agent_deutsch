"use client";

import { useEffect } from "react";
import { Loader } from "./Loader";
import { useAppChrome } from "@/lib/appChrome";

export function Footer() {
  const { footer } = useAppChrome();
  const alterno = footer !== null;

  // El footer alterno es fijo sobre el contenido: se agrega espacio abajo del body mientras está activo
  // para que no tape las últimas líneas de la página.
  useEffect(() => {
    document.body.classList.toggle("app-footer-fixed-activo", alterno);
    return () => document.body.classList.remove("app-footer-fixed-activo");
  }, [alterno]);

  if (footer === null) {
    return (
      <footer className="app-footer">
        {/* eslint-disable-next-line @next/next/no-img-element -- logo estático, sin animación */}
        <img src="/umbusk-loader.png" alt="Umbusk" className="app-footer-logo" />
        <p>
          Vibecoded by{" "}
          <a href="https://umbusk.com/" target="_blank" rel="noopener noreferrer">
            Umbusk
          </a>{" "}
          y Claude de{" "}
          <a href="https://anthropic.com/" target="_blank" rel="noopener noreferrer">
            Anthropic
          </a>
        </p>
        <p className="app-footer-disclaimer">Claude es IA y puede cometer errores. Por favor, verifica los resultados.</p>
      </footer>
    );
  }

  return (
    <footer className="app-footer app-footer-fijo">
      <div className={`app-footer-fijo-inner app-footer-fijo-inner-${footer.mode}`}>
        {footer.mode === "procesando" ? (
          <Loader messages={footer.messages} />
        ) : (
          <button className="primary" onClick={footer.onClick} disabled={footer.disabled}>
            {footer.label}
          </button>
        )}
      </div>
    </footer>
  );
}
