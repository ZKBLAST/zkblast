import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppProvider } from "@/components/shell/AppProvider";
import { Header } from "@/components/shell/Header";
import { Footer } from "@/components/shell/Footer";
import { SmoothScroll } from "@/components/shell/SmoothScroll";

export const metadata: Metadata = {
  title: {
    default: "ZKBLAST · Liquidity Without Exposure",
    template: "%s · ZKBLAST",
  },
  description:
    "Zero-knowledge liquidity infrastructure on Robinhood Chain with environment-bound public DLMM and DAMM pools.",
  icons: {
    icon: [{ url: "/zk/logo.png" }, { url: "/zk/logo.png", type: "image/png" }],
    shortcut: "/zk/logo.png",
    apple: "/zk/logo.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#06060c",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AppProvider>
          <SmoothScroll />
          <Header />
          <main id="main" tabIndex={-1} className="outline-none">
            {children}
          </main>
          <Footer />
        </AppProvider>
      </body>
    </html>
  );
}
