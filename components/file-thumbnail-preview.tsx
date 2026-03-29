"use client";

import React from "react";
import { type ReactNode, useEffect, useState } from "react";
import { ensureAccessToken } from "@/lib/browser-auth";

const OFFICE_MIME_TYPES = new Set([
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "application/rtf"
]);

const OFFICE_EXTENSIONS = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf"]);

const DEFAULT_POLL_AFTER_MS = 2000;

export type ThumbnailPreviewProps = {
  projectId: string;
  fileId: string;
  filename: string;
  mimeType: string;
  thumbnailUrl?: string | null;
  accessToken?: string | null;
  onToken?: (token: string | null) => void;
  alt: string;
  fallback: ReactNode;
  imageClassName?: string;
};

type ThumbnailPollResult =
  | { state: "ready"; thumbnailUrl: string }
  | { state: "queued"; pollAfterMs: number }
  | { state: "missing" };

export function buildThumbnailRoutePath(projectId: string, fileId: string) {
  return `/projects/${encodeURIComponent(projectId.trim())}/files/${encodeURIComponent(fileId.trim())}/thumbnail`;
}

export function isThumbnailPreviewSupported(args: { filename: string; mimeType: string }) {
  const mimeType = args.mimeType.toLowerCase().trim();
  const extension = getNormalizedExtension(args.filename);

  if (mimeType.startsWith("image/")) {
    return true;
  }

  if (mimeType === "application/pdf" || extension === "pdf") {
    return true;
  }

  return OFFICE_MIME_TYPES.has(mimeType) || OFFICE_EXTENSIONS.has(extension);
}

export async function requestThumbnailPreview(args: {
  projectId: string;
  fileId: string;
  accessToken?: string | null;
  onToken?: (token: string | null) => void;
  signal?: AbortSignal;
}): Promise<ThumbnailPollResult> {
  const path = buildThumbnailRoutePath(args.projectId, args.fileId);
  const send = (token: string | null) =>
    fetch(path, {
      credentials: "same-origin",
      redirect: "manual",
      signal: args.signal,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });

  let accessToken = await resolveAccessToken({
    accessToken: args.accessToken,
    onToken: args.onToken
  });
  let response = await send(accessToken);
  if (response.status === 401 && args.onToken) {
    accessToken = await resolveAccessToken({
      accessToken: null,
      onToken: args.onToken
    });
    if (accessToken) {
      response = await send(accessToken);
    }
  }

  if (response.status === 307) {
    const location = response.headers.get("location")?.trim();
    if (location) {
      return { state: "ready", thumbnailUrl: location };
    }
    return { state: "missing" };
  }

  if (response.status === 202) {
    const payload = await response.json().catch(() => null);
    const pollAfterMs =
      typeof payload?.pollAfterMs === "number" && Number.isFinite(payload.pollAfterMs) && payload.pollAfterMs > 0
        ? payload.pollAfterMs
        : DEFAULT_POLL_AFTER_MS;
    return { state: "queued", pollAfterMs };
  }

  return { state: "missing" };
}

export function ThumbnailPreview({
  projectId,
  fileId,
  filename,
  mimeType,
  thumbnailUrl,
  accessToken,
  onToken,
  alt,
  fallback,
  imageClassName
}: ThumbnailPreviewProps) {
  const initialThumbnailUrl = normalizeThumbnailUrl(thumbnailUrl);
  const [resolvedThumbnailUrl, setResolvedThumbnailUrl] = useState<string | null>(initialThumbnailUrl);

  useEffect(() => {
    setResolvedThumbnailUrl(normalizeThumbnailUrl(thumbnailUrl));
  }, [thumbnailUrl]);

  useEffect(() => {
    if (resolvedThumbnailUrl || !isThumbnailPreviewSupported({ filename, mimeType }) || !projectId || !fileId) {
      return;
    }

    const abortController = new AbortController();
    let cancelled = false;

    const run = async () => {
      while (!cancelled) {
        try {
          const next = await requestThumbnailPreview({
            projectId,
            fileId,
            accessToken,
            onToken,
            signal: abortController.signal
          });

          if (cancelled) {
            return;
          }

          if (next.state === "ready") {
            setResolvedThumbnailUrl(next.thumbnailUrl);
            return;
          }

          if (next.state === "queued") {
            await waitForMilliseconds(next.pollAfterMs, abortController.signal);
            continue;
          }

          return;
        } catch (error) {
          if (cancelled || isAbortError(error)) {
            return;
          }
          return;
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [accessToken, fileId, filename, mimeType, onToken, projectId, resolvedThumbnailUrl]);

  if (resolvedThumbnailUrl) {
    return <img src={resolvedThumbnailUrl} alt={alt} className={imageClassName} loading="lazy" />;
  }

  return <>{fallback}</>;
}

function normalizeThumbnailUrl(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function resolveAccessToken(args: {
  accessToken?: string | null;
  onToken?: (token: string | null) => void;
}) {
  const normalizedToken = normalizeAccessToken(args.accessToken);
  if (!args.onToken) {
    return normalizedToken;
  }
  try {
    return await ensureAccessToken(normalizedToken, args.onToken);
  } catch {
    return normalizedToken;
  }
}

function normalizeAccessToken(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getNormalizedExtension(filename: string) {
  const parts = filename.toLowerCase().trim().split(".");
  if (parts.length < 2) {
    return "";
  }
  return parts.at(-1)?.trim() ?? "";
}

function waitForMilliseconds(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }

    const timeoutId = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);

    const onAbort = () => {
      globalThis.clearTimeout(timeoutId);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}
