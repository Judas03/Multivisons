import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Multivisons | AI-assisted project agreements",
  description: "A hackathon prototype for jointly accepted work scope and milestone payments.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
