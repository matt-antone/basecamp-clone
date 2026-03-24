"use client";

import { Suspense, type ReactNode, useEffect, useState } from "react";

type ClientSuspenseProps = {
  children: ReactNode;
  fallback: ReactNode;
};

export function ClientSuspense({ children, fallback }: ClientSuspenseProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return <>{fallback}</>;
  }

  return <Suspense fallback={fallback}>{children}</Suspense>;
}
