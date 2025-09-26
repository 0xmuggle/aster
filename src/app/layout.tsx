import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { EProvider } from "@/components/EProvider";

export const metadata: Metadata = {
  title: "Aster Trader",
  description: "Manage your trading accounts",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-white text-sm">
        <main className="container mx-auto p-4">
          <EProvider>{children}</EProvider>
        </main>
      </body>
    </html>
  );
}
