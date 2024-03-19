import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Nueve tokyo gradients",
  description: "Deeznuts",
};

export const viewport = {
  themeColor: "transparent",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.className} antialiased`}
      suppressHydrationWarning={true}
    >
      <body className={inter.className}>
        <main className="p-6 pt-3 md:pt-6 min-h-screen">{children}</main>
      </body>
    </html>
  );
}
