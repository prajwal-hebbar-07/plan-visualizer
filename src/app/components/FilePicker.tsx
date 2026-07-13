"use client";

import { useCallback, useEffect, useState } from "react";

interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

interface Listing {
  root: string;
  dir: string;
  parent: string | null;
  entries: DirEntry[];
}

export function FilePicker({
  selectedPath,
  onSelect,
}: {
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // The fetch itself only mutates state from async callbacks, so it is safe to
  // call synchronously from an effect (no cascading synchronous renders).
  const fetchDir = useCallback((dir: string) => {
    fetch(`/api/plans?dir=${encodeURIComponent(dir)}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Failed to list");
        setListing(data as Listing);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  // Navigation clicks want the immediate "Loading…" flip; effects don't.
  const load = useCallback(
    (dir: string) => {
      setLoading(true);
      fetchDir(dir);
    },
    [fetchDir],
  );

  useEffect(() => {
    fetchDir("");
  }, [fetchDir]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Plans
        </h2>
        <p
          className="mt-1 truncate font-mono text-[11px] text-zinc-400"
          title={listing?.root}
        >
          {listing ? `…/${listing.root.split("/").slice(-1)[0]}${listing.dir ? "/" + listing.dir : ""}` : "…"}
        </p>
      </div>

      <div className="flex-1 overflow-auto p-2">
        {loading && (
          <p className="px-2 py-1 text-xs text-zinc-400">Loading…</p>
        )}
        {error && (
          <p className="px-2 py-1 text-xs text-red-500">{error}</p>
        )}
        {listing && listing.parent !== null && (
          <button
            onClick={() => load(listing.parent ?? "")}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <span className="text-zinc-400">↰</span> ..
          </button>
        )}
        {listing?.entries.map((e) =>
          e.isDir ? (
            <button
              key={e.path}
              onClick={() => load(e.path)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <span className="text-amber-500">📁</span>
              <span className="truncate">{e.name}</span>
            </button>
          ) : (
            <button
              key={e.path}
              onClick={() => onSelect(e.path)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                selectedPath === e.path
                  ? "bg-indigo-100 font-medium text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              <span className="text-indigo-400">📄</span>
              <span className="truncate">{e.name.replace(/\.md$/, "")}</span>
            </button>
          ),
        )}
        {listing && listing.entries.length === 0 && !loading && (
          <p className="px-2 py-1 text-xs text-zinc-400">No .md files here.</p>
        )}
      </div>
    </div>
  );
}
