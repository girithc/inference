import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Inference Model Playground",
  description: "Browse and try every available inference model in one TypeScript playground.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
