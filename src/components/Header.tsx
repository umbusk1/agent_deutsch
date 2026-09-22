"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppChrome } from "@/lib/appChrome";

export function Header() {
  const { pipeline } = useAppChrome();
  const pathname = usePathname();

  return (
    <header className="app-header">
      <div className="app-header-top">
        <span className="app-header-title">
          {/* eslint-disable-next-line @next/next/no-img-element -- dos logos fijos, uno por esquema de color */}
          <img
            src="/Logo_Fondo_Claro.png"
            alt="Agente Deutsch: Análisis de la calidad explicativa de textos."
            className="app-header-logo app-header-logo-claro"
          />
          {/* eslint-disable-next-line @next/next/no-img-element -- dos logos fijos, uno por esquema de color */}
          <img
            src="/Logo_Fondo_Oscuro.png"
            alt="Agente Deutsch: Análisis de la calidad explicativa de textos."
            className="app-header-logo app-header-logo-oscuro"
          />
        </span>
        <nav className="app-header-nav">
          <Link href="/nuevo" aria-current={pathname === "/nuevo" ? "page" : undefined}>
            + Nuevo análisis
          </Link>
          <Link href="/" aria-current={pathname === "/" ? "page" : undefined}>
            Biblioteca
          </Link>
          <Link href="/acerca" aria-current={pathname === "/acerca" ? "page" : undefined}>
            Acerca de
          </Link>
        </nav>
      </div>

      {pipeline && (
        <div className="steps-indicator app-header-steps">
          {pipeline.steps.map((label, i) => {
            const reached = i <= pipeline.furthestIndex;
            const clickable = reached && i !== pipeline.activeIndex && !pipeline.loading;
            return (
              <button
                key={label}
                type="button"
                className={`step-dot ${i === pipeline.activeIndex ? "active" : reached ? "done" : ""}`}
                disabled={!clickable}
                onClick={() => pipeline.onStepClick(i)}
              >
                {i}. {label}
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
}
