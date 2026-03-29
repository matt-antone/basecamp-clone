"use client";

import { forwardRef, useCallback, useState, type ButtonHTMLAttributes, type MouseEvent } from "react";
import React from "react";

type OneShotButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return typeof value === "object" && value !== null && "then" in value && typeof (value as Promise<unknown>).then === "function";
}

export const OneShotButton = forwardRef<HTMLButtonElement, OneShotButtonProps>(function OneShotButton(
  { disabled, onClick, onMouseDown, ...props },
  ref
) {
  const [isPending, setIsPending] = useState(false);
  const hasActionHandler = Boolean(onClick ?? onMouseDown);

  const runHandler = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const handler = onMouseDown ?? onClick;
      if (!handler) {
        return;
      }

      if (disabled || isPending) {
        event.preventDefault();
        return;
      }

      const result = handler(event);
      if (isPromiseLike(result)) {
        setIsPending(true);
        void result.finally(() => {
          setIsPending(false);
        });
      }
    },
    [disabled, isPending, onClick, onMouseDown]
  );

  const handleMouseDown = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      if (!hasActionHandler) {
        return;
      }
      if (event.button !== 0) {
        return;
      }
      runHandler(event);
    },
    [hasActionHandler, runHandler]
  );

  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      if (!hasActionHandler) {
        return;
      }

      if (event.detail !== 0) {
        event.preventDefault();
        return;
      }

      runHandler(event);
    },
    [hasActionHandler, runHandler]
  );

  return <button {...props} ref={ref} disabled={disabled || isPending} onMouseDown={handleMouseDown} onClick={handleClick} />;
});
