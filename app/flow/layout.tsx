import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Flow"
};

export default function FlowLayout({ children }: { children: React.ReactNode }) {
  return children;
}
