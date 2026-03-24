import type { Metadata } from "next";
import { Instrument_Sans, Newsreader } from "next/font/google";
import Script from "next/script";
import "./styles.css";
import ThemeToggle from "./theme-toggle";

export const metadata: Metadata = {
  title: "Basecamp Clone",
  description: "Basecamp 2 replacement with Supabase + Dropbox"
};

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  display: "swap"
});

const newsreader = Newsreader({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display"
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" className="light" suppressHydrationWarning>
      <head>
        <Script id="theme-init" strategy="beforeInteractive">
          {`(() => {
            try {
              const key = "basecamp-clone-theme";
              const saved = window.localStorage.getItem(key);
              const theme =
                saved === "light" || saved === "dark"
                  ? saved
                  : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
              const root = document.documentElement;
              root.dataset.theme = theme;
              root.classList.remove("light", "dark");
              root.classList.add(theme);
            } catch {}
          })();`}
        </Script>
      </head>
      <body className={`${instrumentSans.className} ${newsreader.variable}`}>
        <ThemeToggle />
        <div className="appFrame">{children}</div>
      </body>
    </html>
  );
}
