import type { Metadata, Viewport } from "next";
import "./reference.css";
import "./globals.css";
export const metadata: Metadata = {
  title: "Beacon",
  description: "Закрытое сообщество",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Beacon", statusBarStyle: "default" },
  icons: { apple: "/icon-192.png" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#17215b",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="capture">{children}</body>
    </html>
  );
}
