import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BrickLink Price Tracker",
  description: "Track and analyze BrickLink LEGO price data",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
