"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ModelCard, type ModelSection } from "@/components/ModelCard";
import { catalog } from "@/lib/catalog";

export default function HomePage() {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<ModelSection | null>(null);

  useEffect(() => {
    const syncFromHash = () => {
      const id = window.location.hash.slice(1);
      if (catalog.some((model) => model.id === id)) {
        setActiveId(id);
        setActiveSection("architecture");
      }
    };

    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  const visibleModels = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return catalog;

    return catalog.filter((model) =>
      [model.name, model.vendor, model.modality, model.id]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [query]);

  const openSection = useCallback(
    (id: string, section: ModelSection) => {
      if (activeId === id && activeSection === section) {
        setActiveId(null);
        setActiveSection(null);
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        return;
      }

      setActiveId(id);
      setActiveSection(section);
      window.history.replaceState(null, "", `#${id}`);
    },
    [activeId, activeSection],
  );

  return (
    <>
      <header className="topbar">
        <a className="brand" href="#">
          <span className="brand-mark" aria-hidden="true" />
          <span>Inference Playground</span>
        </a>
      </header>

      <main className="catalog">
        <section className="catalog-header" aria-labelledby="catalog-title">
          <div>
            <h1 id="catalog-title">All models</h1>
            <p>Select a model concept to open its architecture, playground, or kernels.</p>
          </div>
          <label className="search-label" htmlFor="model-search">
            <span className="visually-hidden">Search models</span>
            <input
              id="model-search"
              type="search"
              placeholder="Search models"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </section>

        <div className="model-list" role="list">
          {visibleModels.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              section={activeId === model.id ? activeSection : null}
              onOpenSection={openSection}
            />
          ))}
        </div>

        <p className="empty-state" hidden={visibleModels.length !== 0}>
          No models match that search.
        </p>
      </main>
    </>
  );
}
