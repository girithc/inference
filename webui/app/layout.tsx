import type { Metadata } from "next";
import "./globals.css";
import { TopBar, Footer } from "@/components/chrome";
import { ScrollProgress } from "@/components/ScrollProgress";

export const metadata: Metadata = {
  title: "INFERENCE✳ — MODAL STUDIO",
  description:
    "Connect to GitHub, edit inference code, deploy to Modal, stream logs. The cockpit for a Modal inference cookbook.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        {/* React hoists these font links into <head> */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
        <ScrollProgress />
        <TopBar />
        {children}
        <Footer />
      </body>
    </html>
  );
}
