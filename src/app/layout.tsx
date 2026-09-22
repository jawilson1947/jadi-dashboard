import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "JADI Dashboard", template: "%s · JADI Dashboard" },
  description: "Student billing, enrollment, and financial-clearance analysis",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
