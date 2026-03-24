import type { Metadata } from "next";
import { Instrument_Sans, Newsreader } from "next/font/google";
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
      <body className={`${instrumentSans.className} ${newsreader.variable}`}>
        <ThemeToggle />
        <div className="appFrame">{children}</div>
      </body>
    </html>
  );
}
