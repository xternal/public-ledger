"use client";

import { useState } from "react";

/** Copies a code example. Nothing leaves the browser; the button says when it worked. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="cursor-pointer rounded-md px-2 py-1 text-caption font-medium text-muted shadow-[var(--shadow-control)] hover:text-ink"
    >
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Select and copy" : label}</span>
    </button>
  );
}

/** A copyable code block: the command on a sunk panel, the button above it. */
export function CodeBlock({ code, caption }: { code: string; caption: string }) {
  return (
    <figure className="m-0 grid min-w-0 gap-1.5">
      <figcaption className="flex items-center justify-between gap-3 text-label text-muted">
        <span>{caption}</span>
        <CopyButton text={code} />
      </figcaption>
      <pre className="m-0 overflow-x-auto whitespace-pre-wrap rounded-panel bg-sunk p-4 text-[13px] leading-relaxed [overflow-wrap:anywhere]">
        <code>{code}</code>
      </pre>
    </figure>
  );
}
