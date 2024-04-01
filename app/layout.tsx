import type { Metadata } from "next";
import { Inter } from "next/font/google";
import localFont from "next/font/local";
import Footer from "@/src/components/Footer";
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

const outward = localFont({
  src: [
    {
      path: "../public/fonts/outward/outward-borders-webfont.woff",
      weight: "400",
      style: "normal",
    },
  ],
  variable: "--font-outward",
});

const milkman = localFont({
  src: [
    {
      path: "../public/fonts/milkman/milkman.woff",
      weight: "400",
      style: "normal",
    },
  ],
  variable: "--font-milkman",
});

const geist = localFont({
  src: [
    {
      path: "../public/fonts/geistmono/GeistMono-Regular.woff",
      weight: "400",
      style: "normal",
    },
  ],
  variable: "--font-geistmono",
});

const migra = localFont({
  src: [
    {
      path: "../public/fonts/migra/MigraItalic-ExtraboldItalic.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../public/fonts/migra/MigraItalic-ExtralightItalic.woff2",
      weight: "200",
      style: "italic",
    },
  ],
  variable: "--font-migra",
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
      className={`${inter.className} ${array.variable} ${geist.variable} ${pramukh.variable} ${melodrama.variable} ${migra.variable} ${sligoil.variable} ${milkman.variable} ${outward.variable} antialiased`}
      suppressHydrationWarning={true}
    >
      <body className={inter.className}>
        <main className="min-h-screen">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
