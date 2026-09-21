import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppChromeProvider } from "@/lib/appChrome";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agente Deutsch",
  description: "Análisis crítico de la calidad explicativa de un texto de opinión.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <AppChromeProvider>
          <Header />
          {children}
          <Footer />
        </AppChromeProvider>
      </body>
    </html>
  );
}
