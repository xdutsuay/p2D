import type {
  AdjacentDir,
  AdjacentLink,
  AdjacentsMap,
  PhotoRecord,
} from "@p2d/schema";
import { normalizeAdjacents } from "@p2d/schema";

const DIR_META: Array<{
  dir: AdjacentDir;
  title: string;
  hint: string;
  grid: string;
}> = [
  {
    dir: "top",
    title: "Top",
    hint: "Above / ceiling / sky",
    grid: "top",
  },
  {
    dir: "left",
    title: "Left",
    hint: "Left of frame",
    grid: "left",
  },
  {
    dir: "right",
    title: "Right",
    hint: "Right of frame",
    grid: "right",
  },
  {
    dir: "bottom",
    title: "Bottom",
    hint: "Below / floor",
    grid: "bottom",
  },
  {
    dir: "front",
    title: "Front",
    hint: "Into the scene (ahead)",
    grid: "front",
  },
  {
    dir: "back",
    title: "Back",
    hint: "Behind camera",
    grid: "back",
  },
];

interface Props {
  photo: PhotoRecord;
  allPhotos: PhotoRecord[];
  onChange: (adjacents: AdjacentsMap) => void;
  onJumpToPhoto: (photoId: string) => void;
}

export default function NeighborsPanel({
  photo,
  allPhotos,
  onChange,
  onJumpToPhoto,
}: Props) {
  const adjacents = normalizeAdjacents(photo);
  const others = allPhotos.filter((p) => p.id !== photo.id);

  const setDir = (dir: AdjacentDir, patch: Partial<AdjacentLink> | null) => {
    const next: AdjacentsMap = { ...adjacents };
    if (patch === null) {
      delete next[dir];
    } else {
      const cur = next[dir] || { photo_id: null, note: null };
      const merged: AdjacentLink = {
        photo_id:
          patch.photo_id !== undefined ? patch.photo_id : cur.photo_id,
        note: patch.note !== undefined ? patch.note : cur.note,
      };
      if (!merged.photo_id && !merged.note) {
        delete next[dir];
      } else {
        next[dir] = merged;
      }
    }
    onChange(next);
  };

  const clearDir = (dir: AdjacentDir) => setDir(dir, null);

  return (
    <div className="neighbors">
      <p className="hint">
        Link optional neighbors for stitching / 3D. Leave empty if that side
        has no useful photo or place.
      </p>

      <div className="adj-compass" aria-label="Neighbor directions">
        <div className="adj-center">
          <span className="adj-center-label">This photo</span>
          <span className="adj-center-code">{photo.photo_code}</span>
        </div>

        {DIR_META.map(({ dir, title, hint, grid }) => {
          const link = adjacents[dir];
          const linked = link?.photo_id
            ? others.find((p) => p.id === link.photo_id)
            : null;
          return (
            <div key={dir} className={`adj-slot adj-${grid}`}>
              <div className="adj-slot-head">
                <strong>{title}</strong>
                <span className="hint">{hint}</span>
              </div>

              <div className="field">
                <label>Neighbor photo</label>
                <select
                  value={link?.photo_id ?? ""}
                  onChange={(e) =>
                    setDir(dir, {
                      photo_id: e.target.value || null,
                    })
                  }
                >
                  <option value="">— none —</option>
                  {others.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.photo_code || p.id}
                      {p.room_id ? ` · ${p.room_id}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {linked && (
                <button
                  type="button"
                  className="btn linkish"
                  onClick={() => onJumpToPhoto(linked.id)}
                >
                  Open {linked.photo_code}
                </button>
              )}

              <div className="field">
                <label>Place / note (optional)</label>
                <input
                  value={link?.note ?? ""}
                  placeholder="room id, wall, street…"
                  onChange={(e) =>
                    setDir(dir, {
                      note: e.target.value || null,
                    })
                  }
                />
              </div>

              {(link?.photo_id || link?.note) && (
                <button
                  type="button"
                  className="btn linkish"
                  onClick={() => clearDir(dir)}
                >
                  Clear {title.toLowerCase()}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <h2>Quick summary</h2>
      <ul className="hint-list">
        {DIR_META.map(({ dir, title }) => {
          const link = adjacents[dir];
          if (!link?.photo_id && !link?.note) return null;
          const code = link.photo_id
            ? allPhotos.find((p) => p.id === link.photo_id)?.photo_code
            : null;
          return (
            <li key={dir}>
              <strong>{title}:</strong>{" "}
              {code ? `${code}` : ""}
              {code && link.note ? " · " : ""}
              {link.note || (!code ? "—" : "")}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
