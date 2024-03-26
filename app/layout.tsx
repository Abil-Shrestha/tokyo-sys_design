import type { Metadata } from "next";
import { Inter } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const array = localFont({
  src: [
    {
      path: "../public/fonts/array/Array-Regular.woff",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/fonts/array/Array-Bold.woff2",
      weight: "600",
      style: "normal",
    },
  ],
  variable: "--font-array",
});

const pramukh = localFont({
  src: [
    {
      path: "../public/fonts/pramukh/PramukhRounded-Regular.woff",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/fonts/pramukh/PramukhRounded-Italic.woff",
      weight: "400",
      style: "italic",
    },
  ],
  variable: "--font-pramukh",
});

const melodrama = localFont({
  src: [
    {
      path: "../public/fonts/melodrama/Melodrama-Regular.woff",
      weight: "400",
      style: "normal",
    },
  ],
  variable: "--font-melodrama",
});

const sligoil = localFont({
  src: [
    {
      path: "../public/fonts/sligoil/Sligoil-Micro.woff",
      weight: "400",
      style: "normal",
    },
  ],
  variable: "--font-sligoil",
});

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Nueve tokyo gradients",
  description: "Deez Gradients",
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
      className={`${inter.className} ${array.variable} ${pramukh.variable} ${melodrama.variable} ${sligoil.variable} antialiased`}
      suppressHydrationWarning={true}
    >
      <body className={inter.className}>
        <main className="p-6 pt-3 md:pt-6 min-h-screen">{children}</main>
      </body>
    </html>
  );
}
