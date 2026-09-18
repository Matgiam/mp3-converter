import type { Metadata, Viewport } from "next";
import { Archivo, Doto } from "next/font/google";
import "./globals.css";

// One family, two widths: expanded for faceplate labels, normal for reading.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin", "latin-ext"],
  axes: ["wdth"],
});

// Dot-matrix face for the display, like a VFD panel.
const doto = Doto({
  variable: "--font-doto",
  subsets: ["latin", "latin-ext"],
  weight: ["700", "900"],
  fallback: ["ui-monospace", "monospace"],
});

export const metadata: Metadata = {
  title: "Dubdeck · YouTube to MP3",
  description: "Paste a YouTube link, pick a bitrate, and download the audio as a tagged MP3 with cover art.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e6e8e9" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0e0f" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} ${doto.variable}`}>
      <body>{children}</body>
    </html>
  );
}
