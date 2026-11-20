/**
 * The header's background picture: three children holding hands beside a house, with trees and soft
 * hills, drawn in very pale greens so it stays quiet behind the header's text and buttons. Decorative only.
 */

const GROUND = 100;

const COLOURS = {
  hillBack: "#f0f6f2",
  hillFront: "#e6f0e9",
  tree: "#d6e8db",
  trunk: "#cadfd0",
  child: "#c2dbc9",
  wall: "#eaf3ed",
  roof: "#cfe3d5",
  opening: "#ffffff",
  path: "#f4f9f5",
};

type Child = { x: number; s: number; kind: "boy" | "girl" };

const CHILDREN: Child[] = [
  { x: 150, s: 0.86, kind: "boy" },
  { x: 188, s: 0.95, kind: "girl" },
  { x: 230, s: 1.08, kind: "girl" },
];

function ChildFigure({ x, s, kind }: Child) {
  const y = (v: number) => GROUND - v * s;
  return (
    <g fill={COLOURS.child}>
      <circle cx={x} cy={y(62)} r={8 * s} />
      {kind === "girl" ? (
        <path d={`M${x - 5 * s} ${y(52)} L${x + 5 * s} ${y(52)} L${x + 11 * s} ${y(24)} L${x - 11 * s} ${y(24)} Z`} />
      ) : (
        <rect x={x - 6 * s} y={y(52)} width={12 * s} height={26 * s} rx={3 * s} />
      )}
      <rect x={x - 5 * s} y={y(26)} width={4 * s} height={26 * s} rx={2 * s} />
      <rect x={x + 1 * s} y={y(26)} width={4 * s} height={26 * s} rx={2 * s} />
    </g>
  );
}

/** The arms: each pair of neighbours meets at a hand between them; the outer arms hang down. */
function Arms() {
  const shoulder = (c: Child, side: -1 | 1) => [c.x + side * 5 * c.s, GROUND - 49 * c.s] as const;
  const lines: string[] = [];
  CHILDREN.forEach((c, i) => {
    const next = CHILDREN[i + 1];
    if (!next) return;
    const [ax, ay] = shoulder(c, 1);
    const [bx, by] = shoulder(next, -1);
    const hand = [(ax + bx) / 2, GROUND - 34 * ((c.s + next.s) / 2)];
    lines.push(`M${ax} ${ay} L${hand[0]} ${hand[1]} L${bx} ${by}`);
  });
  const first = CHILDREN[0];
  const last = CHILDREN[CHILDREN.length - 1];
  const [fx, fy] = shoulder(first, -1);
  const [lx, ly] = shoulder(last, 1);
  lines.push(`M${fx} ${fy} L${first.x - 11 * first.s} ${GROUND - 31 * first.s}`);
  lines.push(`M${lx} ${ly} L${last.x + 11 * last.s} ${GROUND - 31 * last.s}`);
  return (
    <path
      d={lines.join(" ")}
      fill="none"
      stroke={COLOURS.child}
      strokeWidth={3.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function Tree({ x, s }: { x: number; s: number }) {
  return (
    <g>
      <rect x={x - 2.5 * s} y={GROUND - 34 * s} width={5 * s} height={34 * s} fill={COLOURS.trunk} />
      <g fill={COLOURS.tree}>
        <circle cx={x} cy={GROUND - 50 * s} r={17 * s} />
        <circle cx={x - 13 * s} cy={GROUND - 40 * s} r={12 * s} />
        <circle cx={x + 13 * s} cy={GROUND - 40 * s} r={12 * s} />
      </g>
    </g>
  );
}

function House() {
  return (
    <g>
      <path d="M412 104 L428 96 L444 96 L460 104 Z" fill={COLOURS.path} />
      <rect x="388" y="56" width="96" height="40" fill={COLOURS.wall} />
      <path
        d="M376 60 L436 20 L496 60"
        fill={COLOURS.roof}
        stroke={COLOURS.opening}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <rect x="462" y="28" width="9" height="16" fill={COLOURS.roof} />
      <g fill={COLOURS.opening}>
        <rect x="429" y="36" width="14" height="12" rx="1" />
        <rect x="398" y="64" width="18" height="15" rx="1" />
        <rect x="456" y="64" width="18" height="15" rx="1" />
        <rect x="427" y="70" width="18" height="26" rx="1" />
      </g>
    </g>
  );
}

export function HeaderScene({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 640 104" preserveAspectRatio="xMidYMax meet" className={className}>
      <defs>
        <linearGradient id="header-scene-fade-gradient" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.14" stopColor="#fff" stopOpacity="1" />
          <stop offset="0.86" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="header-scene-fade">
          <rect width="640" height="104" fill="url(#header-scene-fade-gradient)" />
        </mask>
      </defs>
      <g mask="url(#header-scene-fade)">
        <path d="M0 104 C120 74 250 82 360 76 C470 70 560 74 640 66 V104 Z" fill={COLOURS.hillBack} />
        <Tree x={70} s={0.9} />
        <Tree x={556} s={1.05} />
        <Tree x={600} s={0.7} />
        <path d="M0 104 C130 92 260 96 360 99 C460 94 560 88 640 94 V104 Z" fill={COLOURS.hillFront} />
        <House />
        <Arms />
        {CHILDREN.map((child) => (
          <ChildFigure key={child.x} {...child} />
        ))}
      </g>
    </svg>
  );
}
