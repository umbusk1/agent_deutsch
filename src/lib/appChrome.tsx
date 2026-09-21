"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type PipelineChrome = {
  steps: string[];
  activeIndex: number;
  furthestIndex: number;
  loading: boolean;
  onStepClick: (i: number) => void;
} | null;

export type FooterChrome =
  | { mode: "procesando"; messages: string[] }
  | { mode: "esperando"; label: string; onClick: () => void; disabled?: boolean }
  | null;

type ChromeState = { pipeline: PipelineChrome; footer: FooterChrome };

const ChromeContext = createContext<ChromeState>({ pipeline: null, footer: null });
const ChromeSetterContext = createContext<(state: ChromeState) => void>(() => {});

export function AppChromeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ChromeState>({ pipeline: null, footer: null });
  return (
    <ChromeSetterContext.Provider value={setState}>
      <ChromeContext.Provider value={state}>{children}</ChromeContext.Provider>
    </ChromeSetterContext.Provider>
  );
}

/** Lectura, para Header/Footer. */
export function useAppChrome(): ChromeState {
  return useContext(ChromeContext);
}

/**
 * Escritura, para la página que gobierna el flujo (hoy solo /nuevo). Sin arreglo de dependencias a
 * propósito: recalcular pipeline/footer en cada render es barato (un setState de contexto) y evita el
 * riesgo de un array de dependencias incompleto dada la cantidad de estado del flujo que los alimenta.
 * Limpia a null al desmontar, para que otras páginas no hereden el chrome de la última visitada.
 */
export function useSetAppChrome(pipeline: PipelineChrome, footer: FooterChrome) {
  const setState = useContext(ChromeSetterContext);
  useEffect(() => {
    setState({ pipeline, footer });
  });
  useEffect(() => {
    return () => setState({ pipeline: null, footer: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
