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
        <span className="app-header-title">Agente Deutsch: Análisis de la calidad explicativa de textos.</span>
        <nav className="app-header-nav">
          <Link href="/nuevo" aria-current={pathname === "/nuevo" ? "page" : undefined}>
            Subir texto
          </Link>
          <Link href="/" aria-current={pathname === "/" ? "page" : undefined}>
            Ver Biblioteca
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
