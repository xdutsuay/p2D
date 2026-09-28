import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Facing,
  HouseGraph,
  LocationType,
  PhotoCatalog,
  PhotoRecord,
  Room,
  ShowsTag,
  UsableFor,
} from "@p2d/schema";
import {
  FACING_OPTIONS,
  SHOWS_OPTIONS,
  USABLE_OPTIONS,
  normalizeAdjacents,
} from "@p2d/schema";
import type { AdjacentDir, AdjacentsMap } from "@p2d/schema";
import NeighborsPanel from "./NeighborsPanel";

type SaveState = "idle" | "saving" | "saved" | "error";
type PanelTab = "label" | "neighbors" | "scale" | "rooms";
type SourceFilter = "all" | "capture" | "manual";

function isCapturePhoto(p: PhotoRecord): boolean {
  return String(p.photo_code || "").startsWith("CAP-") || String(p.id || "").startsWith("cap_");
}

function isLabeled(p: PhotoRecord): boolean {
  const adj = normalizeAdjacents(p);
  const hasAdj = (Object.keys(adj) as AdjacentDir[]).some((d) => {
    const v = adj[d];
    return Boolean(v?.photo_id || v?.note);
  });
  return Boolean(
    p.location_type ||
      p.room_id ||
      p.facing ||
      (p.shows && p.shows.length) ||
      (p.usable_for && p.usable_for.length) ||
      hasAdj
  );
}

function migrateCatalog(c: PhotoCatalog): PhotoCatalog {
  return {
    ...c,
    photos: c.photos.map((p) => {
      const adjacents = normalizeAdjacents(p);
      const {
        adjacent_left: _l,
        adjacent_right: _r,
        adjacent_ahead: _a,
        adjacent_behind: _b,
        ...rest
      } = p;
      return { ...rest, adjacents };
    }),
  };
}

export default function App() {
  const [catalog, setCatalog] = useState<PhotoCatalog | null>(null);
  const [graph, setGraph] = useState<HouseGraph | null>(null);
  const [index, setIndex] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [scaleMode, setScaleMode] = useState(false);
  const [scalePts, setScalePts] = useState<Array<{ x: number; y: number }>>([]);
  const [scaleLen, setScaleLen] = useState("1");
  const [panelTab, setPanelTab] = useState<PanelTab>("label");
  const [roomFilter, setRoomFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const imgRef = useRef<HTMLImageElement>(null);
  const saveTimer = useRef<number | null>(null);
  const filmRef = useRef<HTMLDivElement>(null);

  const reloadData = useCallback(() => {
    Promise.all([
      fetch("/api/catalog").then((r) => r.json()),
      fetch("/api/house-graph").then((r) => r.json()),
    ]).then(([c, g]) => {
      setCatalog(migrateCatalog(c));
      setGraph(g);
      setIndex(0);
    });
  }, []);

  useEffect(() => {
    reloadData();
  }, [reloadData]);

  const allPhotos = catalog?.photos ?? [];
  const roomIds = useMemo(() => {
    const set = new Set<string>();
    for (const p of allPhotos) if (p.room_id) set.add(p.room_id);
    return [...set].sort();
  }, [allPhotos]);

  const photos = useMemo(() => {
    let list = allPhotos;
    if (sourceFilter === "capture") list = list.filter(isCapturePhoto);
    else if (sourceFilter === "manual") list = list.filter((p) => !isCapturePhoto(p));
    if (roomFilter === "all") return list;
    return list.filter((p) => p.room_id === roomFilter);
  }, [allPhotos, roomFilter, sourceFilter]);

  const photo = photos[index] ?? null;

  const labeledCount = useMemo(
    () => photos.filter(isLabeled).length,
    [photos]
  );

  useEffect(() => {
    const el = filmRef.current?.querySelector<HTMLElement>(`[data-idx="${index}"]`);
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [index]);

  const persistCatalog = useCallback(async (next: PhotoCatalog) => {
    setSaveState("saving");
    try {
      const res = await fetch("/api/catalog", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error("save failed");
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1200);
    } catch {
      setSaveState("error");
    }
  }, []);

  const persistGraph = useCallback(async (next: HouseGraph) => {
    setSaveState("saving");
    try {
      const res = await fetch("/api/house-graph", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error("save failed");
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1200);
    } catch {
      setSaveState("error");
    }
  }, []);

  const scheduleCatalogSave = useCallback(
    (next: PhotoCatalog) => {
      setCatalog(next);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void persistCatalog(next);
      }, 400);
    },
    [persistCatalog]
  );

  const patchPhoto = useCallback(
    (patch: Partial<PhotoRecord>) => {
      if (!catalog || !photo) return;
      const photosNext = catalog.photos.map((p) =>
        p.id === photo.id ? { ...p, ...patch } : p
      );
      scheduleCatalogSave({ ...catalog, photos: photosNext });
    },
    [catalog, photo, scheduleCatalogSave]
  );

  const toggleShow = (tag: ShowsTag) => {
    if (!photo) return;
    const set = new Set(photo.shows);
    if (set.has(tag)) set.delete(tag);
    else set.add(tag);
    patchPhoto({ shows: [...set] });
  };

  const toggleUsable = (tag: UsableFor) => {
    if (!photo) return;
    const set = new Set(photo.usable_for);
    if (set.has(tag)) set.delete(tag);
    else set.add(tag);
    patchPhoto({ usable_for: [...set] });
  };

  const addRoom = () => {
    if (!graph) return;
    const n = graph.rooms.length + 1;
    const room: Room = {
      id: `room_${String(n).padStart(2, "0")}`,
      name: `Room ${n}`,
      kind: "room",
      approx_l_m: null,
      approx_w_m: null,
      ceiling_h_m: 3,
      floor_z_m: 0,
      origin_x_m: null,
      origin_y_m: null,
      notes: "",
    };
    const next = { ...graph, rooms: [...graph.rooms, room] };
    setGraph(next);
    void persistGraph(next);
  };

  const updateRoom = (id: string, patch: Partial<Room>) => {
    if (!graph) return;
    const next = {
      ...graph,
      rooms: graph.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    };
    setGraph(next);
    void persistGraph(next);
  };

  const go = (delta: number) => {
    if (!photos.length) return;
    setIndex((i) => (i + delta + photos.length) % photos.length);
    setScalePts([]);
    setScaleMode(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT"
      ) {
        return;
      }
      if (e.key === "ArrowRight" || e.key === "j") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft" || e.key === "k") {
        e.preventDefault();
        go(-1);
      }       else if (e.key === "1") setPanelTab("label");
      else if (e.key === "2") setPanelTab("neighbors");
      else if (e.key === "3") setPanelTab("scale");
      else if (e.key === "4") setPanelTab("rooms");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!scaleMode || !photo || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const next = [...scalePts, { x, y }];
    if (next.length >= 2) {
      const len = Number(scaleLen);
      if (len > 0) {
        patchPhoto({
          scale_hints: [
            ...(photo.scale_hints || []),
            {
              px_a: next[0],
              px_b: next[1],
              length_m: len,
              label: "manual",
            },
          ],
        });
      }
      setScalePts([]);
      setScaleMode(false);
    } else {
      setScalePts(next);
    }
  };

  const addAdjacency = () => {
    if (!graph || graph.rooms.length < 2) return;
    const from = graph.rooms[0].id;
    const to = graph.rooms[1].id;
    const next: HouseGraph = {
      ...graph,
      adjacencies: [
        ...graph.adjacencies,
        {
          from,
          to,
          shared_wall: null,
          opening: "door",
          opening_width_m: 0.9,
        },
      ],
    };
    setGraph(next);
    void persistGraph(next);
  };

  if (!catalog || !graph || !photo) {
    return (
      <div className="app">
        <div className="topbar">
          <span className="brand">p2D Labeler</span>
          <span className="meta">Loading…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">p2D Labeler</span>
        <span className="meta">
          {photos.length
            ? `${index + 1}/${photos.length}`
            : "0"}
          {roomFilter !== "all" ? ` · ${roomFilter}` : ""}
          {sourceFilter !== "all" ? ` · ${sourceFilter}` : ""} · labeled{" "}
          {labeledCount}/{photos.length}
        </span>
        <label className="filter">
          <span>Source</span>
          <select
            value={sourceFilter}
            onChange={(e) => {
              setSourceFilter(e.target.value as SourceFilter);
              setIndex(0);
              setScalePts([]);
              setScaleMode(false);
            }}
          >
            <option value="all">All</option>
            <option value="capture">AR capture (CAP-)</option>
            <option value="manual">Manual photos</option>
          </select>
        </label>
        <label className="filter">
          <span>Room</span>
          <select
            value={roomFilter}
            onChange={(e) => {
              setRoomFilter(e.target.value);
              setIndex(0);
              setScalePts([]);
              setScaleMode(false);
            }}
          >
            <option value="all">All rooms</option>
            {roomIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <div className="spacer" />
        <span className={`status ${saveState === "saved" ? "saved" : ""}`}>
          {saveState === "saving"
            ? "Saving…"
            : saveState === "saved"
              ? "Saved"
              : saveState === "error"
                ? "Save error"
                : "Local only"}
        </span>
        <div className="nav-row">
          <button type="button" onClick={() => reloadData()} title="Reload from disk">
            Reload
          </button>
          <button type="button" onClick={() => go(-1)}>
            Prev
          </button>
          <button type="button" onClick={() => go(1)}>
            Next
          </button>
        </div>
      </header>

      <div className="workspace">
        <section className="media-col">
          <div className="viewer">
            <img
              ref={imgRef}
              src={`/api/photos/${encodeURIComponent(photo.filename)}`}
              alt={photo.filename}
              onClick={onImageClick}
            />
            {scalePts.length > 0 && (
              <svg
                className="scale-overlay"
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
              >
                {scalePts.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={0.008} />
                ))}
                {scalePts.length === 2 && (
                  <line
                    x1={scalePts[0].x}
                    y1={scalePts[0].y}
                    x2={scalePts[1].x}
                    y2={scalePts[1].y}
                  />
                )}
              </svg>
            )}
            {scaleMode && (
              <div className="viewer-banner">
                Measure mode — click two points on the photo
              </div>
            )}
          </div>

          <div className="filmstrip" ref={filmRef}>
            {photos.map((p, i) => (
              <button
                key={p.id}
                type="button"
                data-idx={i}
                className={`thumb ${i === index ? "active" : ""} ${isLabeled(p) ? "labeled" : ""} ${isCapturePhoto(p) ? "capture" : ""}`}
                onClick={() => {
                  setIndex(i);
                  setScalePts([]);
                  setScaleMode(false);
                }}
                title={p.photo_code || p.filename}
              >
                <img
                  src={`/api/photos/${encodeURIComponent(p.filename)}`}
                  alt=""
                  loading="lazy"
                />
                <span className="badge">{p.photo_code || i + 1}</span>
              </button>
            ))}
          </div>
        </section>

        <aside className="panel">
          {isCapturePhoto(photo) && (
            <div className="capture-banner" role="status">
              AR capture — facing and neighbors auto-filled. Set{" "}
              <strong>room</strong> and <strong>shows</strong> to finish QA.
            </div>
          )}
          <div className="panel-tabs">
            {(
              [
                ["label", "1 Label"],
                ["neighbors", "2 Neighbors"],
                ["scale", "3 Scale"],
                ["rooms", "4 Rooms"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`panel-tab ${panelTab === id ? "active" : ""}`}
                onClick={() => setPanelTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="panel-body">
            {panelTab === "label" && (
              <>
                <div className="row2">
                  <div className="field">
                    <label>Code</label>
                    <input
                      value={photo.photo_code}
                      onChange={(e) =>
                        patchPhoto({ photo_code: e.target.value })
                      }
                    />
                  </div>
                  <div className="field">
                    <label>Facing</label>
                    <select
                      value={photo.facing ?? ""}
                      onChange={(e) =>
                        patchPhoto({
                          facing: (e.target.value || null) as Facing | null,
                        })
                      }
                    >
                      {FACING_OPTIONS.map((f) => (
                        <option key={f || "none"} value={f}>
                          {f || "—"}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="row2">
                  <div className="field">
                    <label>Location</label>
                    <select
                      value={photo.location_type ?? ""}
                      onChange={(e) =>
                        patchPhoto({
                          location_type: (e.target.value ||
                            null) as LocationType | null,
                        })
                      }
                    >
                      <option value="">—</option>
                      <option value="exterior">exterior</option>
                      <option value="interior">interior</option>
                      <option value="threshold">threshold</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Room</label>
                    <select
                      value={photo.room_id ?? ""}
                      onChange={(e) =>
                        patchPhoto({ room_id: e.target.value || null })
                      }
                    >
                      <option value="">—</option>
                      {graph.rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="field">
                  <label>Quality</label>
                  <select
                    value={photo.quality ?? ""}
                    onChange={(e) =>
                      patchPhoto({
                        quality: (e.target.value ||
                          null) as PhotoRecord["quality"],
                      })
                    }
                  >
                    <option value="">—</option>
                    <option value="good">good</option>
                    <option value="ok">ok</option>
                    <option value="poor">poor</option>
                  </select>
                </div>

                <div className="field">
                  <label>Shows</label>
                  <div className="chips">
                    {SHOWS_OPTIONS.map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`chip ${photo.shows.includes(t) ? "on" : ""}`}
                        onClick={() => toggleShow(t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="field">
                  <label>Usable for</label>
                  <div className="chips">
                    {USABLE_OPTIONS.map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`chip ${photo.usable_for.includes(t) ? "on" : ""}`}
                        onClick={() => toggleUsable(t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="field">
                  <label>Notes</label>
                  <textarea
                    value={photo.notes}
                    onChange={(e) => patchPhoto({ notes: e.target.value })}
                  />
                </div>

                <p className="hint">
                  Set left/right/top/bottom/front/back on the{" "}
                  <button
                    type="button"
                    className="btn linkish"
                    onClick={() => setPanelTab("neighbors")}
                  >
                    Neighbors
                  </button>{" "}
                  tab for stitching.
                </p>

                <p className="hint">
                  {photo.filename}
                  {photo.taken_at ? ` · ${photo.taken_at}` : ""}
                </p>
                <p className="hint">←/→ or j/k browse · 1–4 switch tabs</p>
              </>
            )}

            {panelTab === "neighbors" && (
              <NeighborsPanel
                photo={{
                  ...photo,
                  adjacents: normalizeAdjacents(photo),
                }}
                allPhotos={photos}
                onChange={(adjacents: AdjacentsMap) =>
                  patchPhoto({ adjacents })
                }
                onJumpToPhoto={(photoId) => {
                  const inFilter = photos.findIndex((p) => p.id === photoId);
                  if (inFilter >= 0) {
                    setIndex(inFilter);
                  } else {
                    const allIdx = allPhotos.findIndex((p) => p.id === photoId);
                    if (allIdx >= 0) {
                      setRoomFilter("all");
                      setIndex(allIdx);
                    }
                  }
                  setScalePts([]);
                  setScaleMode(false);
                  setPanelTab("neighbors");
                }}
              />
            )}

            {panelTab === "scale" && (
              <>
                <div className="scale-box">
                  <p className="hint">
                    Enter a real-world length, click Measure, then click two
                    points on the photo (door width, pillar face, etc.).
                  </p>
                  <div className="field">
                    <label>Length (metres)</label>
                    <input
                      value={scaleLen}
                      onChange={(e) => setScaleLen(e.target.value)}
                      placeholder="e.g. 0.9"
                    />
                  </div>
                  <button
                    type="button"
                    className={`btn ${scaleMode ? "primary" : ""}`}
                    onClick={() => {
                      setScaleMode((v) => !v);
                      setScalePts([]);
                    }}
                  >
                    {scaleMode ? "Cancel measure" : "Measure on photo"}
                  </button>
                </div>

                <h2>Hints on this photo</h2>
                {(photo.scale_hints?.length ?? 0) === 0 ? (
                  <p className="hint">None yet.</p>
                ) : (
                  <ul className="hint-list">
                    {photo.scale_hints.map((h, i) => (
                      <li key={i}>
                        {h.length_m} m
                        {h.label ? ` (${h.label})` : ""}
                        <button
                          type="button"
                          className="btn linkish"
                          onClick={() =>
                            patchPhoto({
                              scale_hints: photo.scale_hints.filter(
                                (_, j) => j !== i
                              ),
                            })
                          }
                        >
                          remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {panelTab === "rooms" && (
              <>
                <div className="nav-row">
                  <button type="button" className="btn" onClick={addRoom}>
                    + Room
                  </button>
                  <button type="button" className="btn" onClick={addAdjacency}>
                    + Edge
                  </button>
                </div>

                <div className="room-list">
                  {graph.rooms.map((r) => (
                    <div key={r.id} className="room-card">
                      <div className="row2">
                        <div className="field">
                          <label>Name</label>
                          <input
                            value={r.name}
                            onChange={(e) =>
                              updateRoom(r.id, { name: e.target.value })
                            }
                          />
                        </div>
                        <div className="field">
                          <label>Kind</label>
                          <select
                            value={r.kind}
                            onChange={(e) =>
                              updateRoom(r.id, {
                                kind: e.target.value as Room["kind"],
                              })
                            }
                          >
                            <option value="room">room</option>
                            <option value="corridor">corridor</option>
                            <option value="porch">porch</option>
                            <option value="bathroom">bathroom</option>
                            <option value="kitchen">kitchen</option>
                            <option value="open">open</option>
                            <option value="exterior">exterior</option>
                            <option value="utility">utility</option>
                          </select>
                        </div>
                      </div>
                      <div className="row3">
                        <div className="field">
                          <label>L (m)</label>
                          <input
                            type="number"
                            step="0.1"
                            value={r.approx_l_m ?? ""}
                            onChange={(e) =>
                              updateRoom(r.id, {
                                approx_l_m: e.target.value
                                  ? Number(e.target.value)
                                  : null,
                              })
                            }
                          />
                        </div>
                        <div className="field">
                          <label>W (m)</label>
                          <input
                            type="number"
                            step="0.1"
                            value={r.approx_w_m ?? ""}
                            onChange={(e) =>
                              updateRoom(r.id, {
                                approx_w_m: e.target.value
                                  ? Number(e.target.value)
                                  : null,
                              })
                            }
                          />
                        </div>
                        <div className="field">
                          <label>H (m)</label>
                          <input
                            type="number"
                            step="0.1"
                            value={r.ceiling_h_m ?? ""}
                            onChange={(e) =>
                              updateRoom(r.id, {
                                ceiling_h_m: e.target.value
                                  ? Number(e.target.value)
                                  : null,
                              })
                            }
                          />
                        </div>
                      </div>
                      <p className="hint mono">{r.id}</p>
                    </div>
                  ))}
                </div>

                <h2>Adjacencies</h2>
                <div className="edges">
                  {graph.adjacencies.map((a, i) => (
                    <div key={i}>
                      {a.from} —{a.opening || "wall"}→ {a.to}
                    </div>
                  ))}
                  {!graph.adjacencies.length && (
                    <p className="hint">No edges yet.</p>
                  )}
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
