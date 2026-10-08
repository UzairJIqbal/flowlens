// Drawings of the map for the landing page. Drawn rather than captured: a real
// repository's names would read as a claim about somebody's code, so nothing
// here carries text, only the shapes the canvas uses. Every colour is one of
// the canvas's own tokens, so both themes come for free.

const ROW_H = 22;

/** The canvas's edges are curves leaving one side and entering the other. */
function curve(x1: number, y1: number, x2: number, y2: number): string {
  const bend = Math.max(24, (x2 - x1) / 2);
  return `M${x1} ${y1} C${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

type Tone = "plain" | "uses" | "used-by";

const EDGE: Record<Tone, string> = {
  plain: "stroke-(--edge)",
  uses: "stroke-(--edge-uses)",
  "used-by": "stroke-(--edge-used-by)",
};

function Edge({ d, tone = "plain", faint = false }: { d: string; tone?: Tone; faint?: boolean }) {
  return (
    <path
      d={d}
      fill="none"
      strokeWidth={tone === "plain" ? 1 : 1.5}
      className={`${EDGE[tone]} ${faint ? "opacity-40" : ""}`}
    />
  );
}

/** Where a name would be: a bar, so the drawing never names anything. */
function Name({ x, y, w, strong = false }: { x: number; y: number; w: number; strong?: boolean }) {
  return <rect x={x} y={y - 2} width={w} height={4} rx={2} className={strong ? "fill-foreground" : "fill-muted opacity-50"} />;
}

/** The rail's swatch: a filled square for a kind with a colour, an outline for one without. */
function Swatch({ x, y, hue }: { x: number; y: number; hue: number | null }) {
  return hue === null ? (
    <rect x={x + 0.5} y={y - 3.5} width={7} height={7} rx={2} fill="none" className="stroke-muted" />
  ) : (
    <rect x={x} y={y - 4} width={8} height={8} rx={2} style={{ fill: `var(--kind-${hue})` }} />
  );
}

/** A folded folder: a box with a name and a file count. */
function Folder({ x, y, w, name, dim = false }: { x: number; y: number; w: number; name: number; dim?: boolean }) {
  return (
    <g className={dim ? "opacity-45" : undefined}>
      <rect x={x + 0.5} y={y + 0.5} width={w - 1} height={27} rx={3} className="fill-surface stroke-border" />
      <Name x={x + 10} y={y + 14} w={name} />
      <Name x={x + w - 18} y={y + 14} w={8} />
    </g>
  );
}

const LEFT = [48, 112, 176, 240, 304];
const RIGHT = [40, 104, 168, 232, 296];
const PANEL = { x: 216, y: 56, w: 176 };
const ROWS: { name: number; hue: number | null }[] = [
  { name: 72, hue: 1 },
  { name: 54, hue: 1 },
  { name: 88, hue: 4 },
  { name: 64, hue: 6 },
  { name: 80, hue: 6 },
  { name: 46, hue: 7 },
  { name: 60, hue: null },
];
const SELECTED = 3;
const rowY = (i: number) => PANEL.y + 28 + ROW_H * i + ROW_H / 2;

/** The hero: a folded map with one folder open and one of its files selected. */
export function MapFigure() {
  const left = (i: number) => LEFT[i] + 14;
  const right = (i: number) => RIGHT[i] + 14;
  const panelRight = PANEL.x + PANEL.w;

  return (
    <svg viewBox="0 0 560 360" className="h-auto w-full" role="img" aria-label="A dependency map: folders as boxes, one opened into its files, one file selected with the lines into and out of it highlighted">
      {/* Lines first, so boxes sit on top of them as they do on the canvas. */}
      <Edge d={curve(164, left(0), PANEL.x, rowY(0))} faint />
      <Edge d={curve(164, left(2), PANEL.x, rowY(1))} faint />
      <Edge d={curve(164, left(2), PANEL.x, rowY(6))} faint />
      <Edge d={curve(164, left(4), PANEL.x, rowY(5))} faint />
      <Edge d={curve(164, left(4), PANEL.x, 304)} faint />
      <Edge d={curve(panelRight, rowY(0), 444, right(0))} faint />
      <Edge d={curve(panelRight, rowY(2), 444, right(2))} faint />
      <Edge d={curve(panelRight, rowY(5), 444, right(4))} faint />
      <Edge d={curve(panelRight, rowY(6), 444, right(2))} faint />
      <Edge d={curve(panelRight, 304, 444, right(4))} faint />

      <Edge d={curve(164, left(1), PANEL.x, rowY(SELECTED))} tone="used-by" />
      <Edge d={curve(164, left(3), PANEL.x, rowY(SELECTED))} tone="used-by" />
      <Edge d={curve(panelRight, rowY(SELECTED), 444, right(1))} tone="uses" />
      <Edge d={curve(panelRight, rowY(SELECTED), 444, right(3))} tone="uses" />

      {LEFT.map((y, i) => (
        <Folder key={y} x={16} y={y} w={148} name={[64, 48, 80, 56, 40][i]} dim={i !== 1 && i !== 3} />
      ))}
      {RIGHT.map((y, i) => (
        <Folder key={y} x={444} y={y} w={100} name={[44, 56, 36, 50, 42][i]} dim={i !== 1 && i !== 3} />
      ))}
      <Folder x={PANEL.x} y={290} w={PANEL.w} name={68} dim />

      {/* The open folder: a header carrying its name, then a row per file. */}
      <g>
        <rect
          x={PANEL.x + 0.5}
          y={PANEL.y + 0.5}
          width={PANEL.w - 1}
          height={28 + ROW_H * ROWS.length - 1}
          rx={3}
          className="fill-background stroke-foreground"
        />
        <path
          d={`M${PANEL.x + 1} ${PANEL.y + 28} V${PANEL.y + 4} Q${PANEL.x + 1} ${PANEL.y + 1} ${PANEL.x + 4} ${PANEL.y + 1} H${panelRight - 4} Q${panelRight - 1} ${PANEL.y + 1} ${panelRight - 1} ${PANEL.y + 4} V${PANEL.y + 28} Z`}
          className="fill-surface"
        />
        <line x1={PANEL.x + 1} x2={panelRight - 1} y1={PANEL.y + 28.5} y2={PANEL.y + 28.5} className="stroke-border" />
        <Name x={PANEL.x + 10} y={PANEL.y + 14} w={52} strong />
        <Name x={PANEL.x + 70} y={PANEL.y + 14} w={24} />
        {ROWS.map((row, i) => {
          const y = rowY(i);
          const selected = i === SELECTED;
          return (
            <g key={i}>
              {selected && (
                <rect x={PANEL.x + 1} y={y - ROW_H / 2} width={PANEL.w - 2} height={ROW_H} className="fill-surface" />
              )}
              <Swatch x={PANEL.x + 10} y={y} hue={row.hue} />
              <Name x={PANEL.x + 24} y={y} w={row.name} strong={selected} />
              <Name x={panelRight - 18} y={y} w={8} />
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/** A file node: a box with a name. The selected one has the foreground border, like the canvas. */
function File({ x, y, w, name, selected = false }: { x: number; y: number; w: number; name: number; selected?: boolean }) {
  return (
    <g>
      <rect
        x={x + 0.5}
        y={y + 0.5}
        width={w - 1}
        height={selected ? 29 : 21}
        rx={3}
        className={selected ? "fill-surface stroke-foreground" : "fill-background stroke-border"}
      />
      <Name x={x + 10} y={y + (selected ? 15 : 11)} w={name} strong={selected} />
    </g>
  );
}

/**
 * Two levels out in both directions. Direct neighbours are joined by the
 * coloured lines; the second level is what the blast radius adds.
 */
export function ReachFigure() {
  const dependents = [
    { y: 80, name: 36 },
    { y: 139, name: 28 },
    { y: 198, name: 40 },
  ];
  const furtherIn = [
    { y: 50, name: 32, to: 0 },
    { y: 110, name: 40, to: 0 },
    { y: 170, name: 24, to: 1 },
    { y: 230, name: 36, to: 2 },
  ];
  const dependencies = [
    { y: 100, name: 32 },
    { y: 178, name: 40 },
  ];
  const furtherOut = [
    { y: 60, name: 30, from: 0 },
    { y: 130, name: 38, from: 0 },
    { y: 200, name: 26, from: 1 },
  ];
  const mid = (y: number) => y + 11;

  return (
    <svg viewBox="0 0 480 280" className="h-auto w-full" role="img" aria-label="One selected file with what imports it on one side and what it imports on the other, two levels deep">
      {furtherIn.map((f) => (
        <Edge key={f.y} d={curve(72, mid(f.y), 100, mid(dependents[f.to].y))} />
      ))}
      {dependents.map((f) => (
        <Edge key={f.y} d={curve(164, mid(f.y), 200, 140)} tone="used-by" />
      ))}
      {dependencies.map((f) => (
        <Edge key={f.y} d={curve(280, 140, 316, mid(f.y))} tone="uses" />
      ))}
      {furtherOut.map((f) => (
        <Edge key={f.y} d={curve(380, mid(dependencies[f.from].y), 408, mid(f.y))} />
      ))}

      {furtherIn.map((f) => <File key={f.y} x={8} y={f.y} w={64} name={f.name} />)}
      {dependents.map((f) => <File key={f.y} x={100} y={f.y} w={64} name={f.name} />)}
      <File x={200} y={125} w={80} name={44} selected />
      {dependencies.map((f) => <File key={f.y} x={316} y={f.y} w={64} name={f.name} />)}
      {furtherOut.map((f) => <File key={f.y} x={408} y={f.y} w={64} name={f.name} />)}
    </svg>
  );
}

/** Three opened folders whose files carry the swatch for what kind of file they are. */
export function KindsFigure() {
  const folders: { x: number; y: number; name: number; rows: { name: number; hue: number | null }[] }[] = [
    { x: 8, y: 16, name: 44, rows: [{ name: 56, hue: 1 }, { name: 40, hue: 1 }, { name: 64, hue: 4 }, { name: 48, hue: 5 }] },
    { x: 168, y: 64, name: 52, rows: [{ name: 48, hue: 2 }, { name: 60, hue: 2 }, { name: 36, hue: 3 }] },
    { x: 328, y: 24, name: 36, rows: [{ name: 52, hue: 6 }, { name: 44, hue: 6 }, { name: 60, hue: 7 }, { name: 40, hue: null }, { name: 56, hue: null }] },
    { x: 88, y: 190, name: 48, rows: [{ name: 44, hue: 6 }, { name: 58, hue: 6 }] },
    { x: 280, y: 190, name: 40, rows: [{ name: 50, hue: null }, { name: 38, hue: 7 }] },
  ];
  const w = 144;

  return (
    <svg viewBox="0 0 480 280" className="h-auto w-full" role="img" aria-label="Folders opened into files, each file marked with a colour for the kind of file it is">
      {folders.map((f) => {
        const h = 28 + ROW_H * f.rows.length;
        return (
          <g key={`${f.x}-${f.y}`}>
            <rect x={f.x + 0.5} y={f.y + 0.5} width={w - 1} height={h - 1} rx={3} className="fill-background stroke-border" />
            <path
              d={`M${f.x + 1} ${f.y + 28} V${f.y + 4} Q${f.x + 1} ${f.y + 1} ${f.x + 4} ${f.y + 1} H${f.x + w - 4} Q${f.x + w - 1} ${f.y + 1} ${f.x + w - 1} ${f.y + 4} V${f.y + 28} Z`}
              className="fill-surface"
            />
            <line x1={f.x + 1} x2={f.x + w - 1} y1={f.y + 28.5} y2={f.y + 28.5} className="stroke-border" />
            <Name x={f.x + 10} y={f.y + 14} w={f.name} strong />
            {f.rows.map((row, i) => {
              const y = f.y + 28 + ROW_H * i + ROW_H / 2;
              return (
                <g key={i}>
                  <Swatch x={f.x + 10} y={y} hue={row.hue} />
                  <Name x={f.x + 24} y={y} w={row.name} />
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * A resolved import is a line. An import that didn't resolve stops where the
 * parser stopped: a stub and a mark, never a line to the nearest likely file.
 */
export function UnresolvedFigure() {
  return (
    <svg viewBox="0 0 480 200" className="h-auto w-full" role="img" aria-label="One file with a line to the file its import resolved to, and an unresolved import that stops short instead of being drawn to a guess">
      <Edge d={curve(160, 100, 320, 50)} />
      <path d="M160 100 C190 100, 206 128, 232 136" fill="none" strokeWidth={1} strokeDasharray="3 3" className="stroke-muted" />
      <path d="M238 130 l10 10 M248 130 l-10 10" strokeWidth={1.5} strokeLinecap="round" className="stroke-muted" />

      <File x={40} y={85} w={120} name={56} selected />
      <File x={320} y={39} w={120} name={48} />
      <rect x={320.5} y={140.5} width={119} height={21} rx={3} fill="none" strokeDasharray="3 3" className="stroke-border" />
    </svg>
  );
}
