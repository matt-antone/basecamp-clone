import type { Metadata } from "next";
import "./styles.css";
import ThemeToggle from "./theme-toggle";

export const metadata: Metadata = {
  title: "Basecamp Clone",
  description: "Basecamp 2 replacement with Supabase + Dropbox"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" className="light" suppressHydrationWarning>
      <body>
        <ThemeToggle />
        <div className="appFrame">{children}</div>
      </body>
    </html>
  );
}
