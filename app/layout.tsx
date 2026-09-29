import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Astra — Your sky. Your pace.",
  description:
    "Explore an endless world in an unbranded passenger jet. A cinematic browser flight simulator with real aircraft sounds, day and night, and a runway beyond every horizon.",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#142033",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
