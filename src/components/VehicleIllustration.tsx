import type { Category } from '../types';

// Side-view silhouettes (facing right) used as placeholder images until real photos exist.
// viewBox is 400x200; wheels sit at x=110 and x=300, ground at y≈174.
const SHAPES: Record<Category, { body: string; glass: string }> = {
  Sedan: {
    body: 'M40 150 L40 125 Q45 108 72 106 L132 102 L166 72 Q176 64 196 64 L264 64 Q284 64 300 78 L326 102 L355 107 Q372 110 372 128 L372 150 Z',
    glass: 'M142 102 L172 76 Q180 70 196 70 L262 70 Q279 70 291 82 L310 102 Z',
  },
  Coupe: {
    body: 'M40 150 L40 128 Q45 113 76 110 L152 106 L186 78 Q196 71 216 71 L255 71 Q276 73 292 90 L312 106 L356 112 Q373 116 373 132 L373 150 Z',
    glass: 'M162 106 L190 83 Q198 77 216 77 L254 77 Q270 79 282 92 L297 106 Z',
  },
  SUV: {
    body: 'M38 150 L38 113 Q40 99 62 97 L96 95 L121 58 Q127 50 141 50 L300 50 Q315 50 322 62 L341 95 L360 99 Q373 103 373 120 L373 150 Z',
    glass: 'M104 93 L126 62 Q131 56 142 56 L298 56 Q309 56 315 66 L331 93 Z',
  },
  Truck: {
    body: 'M28 150 L28 98 L188 98 L188 56 Q188 48 198 48 L276 48 Q290 48 296 60 L316 94 L356 98 Q373 102 373 118 L373 150 Z',
    glass: 'M198 92 L198 56 L272 56 Q283 56 288 65 L304 92 Z',
  },
  Electric: {
    body: 'M40 150 L40 127 Q42 108 76 104 L136 100 Q170 64 212 62 L260 62 Q296 64 322 100 L356 107 Q373 111 373 129 L373 150 Z',
    glass: 'M146 100 Q174 70 212 68 L258 68 Q288 70 308 100 Z',
  },
  Van: {
    body: 'M34 150 L34 66 Q34 44 60 44 L280 44 Q300 44 312 60 L346 96 Q373 102 373 122 L373 150 Z',
    glass: 'M56 54 L278 54 Q294 54 304 66 L330 94 L56 94 Z',
  },
};

export type Backdrop = 'studio' | 'showroom' | 'outdoor' | 'dusk';

const BACKDROPS: Record<Backdrop, [string, string, string]> = {
  // [sky top, sky bottom, floor]
  studio: ['#eef1f5', '#d9dee6', '#c9cfd8'],
  showroom: ['#2a2f3a', '#454c5a', '#1c2029'],
  outdoor: ['#9cc8f0', '#dcecf8', '#8a9a7a'],
  dusk: ['#3b2a55', '#e08a5f', '#3a3340'],
};

interface Props {
  category: Category;
  colorHex: string;
  backdrop?: Backdrop;
  mirrored?: boolean;
  className?: string;
  title?: string;
}

export function VehicleIllustration({
  category,
  colorHex,
  backdrop = 'studio',
  mirrored = false,
  className,
  title,
}: Props) {
  const shape = SHAPES[category];
  const [skyTop, skyBottom, floor] = BACKDROPS[backdrop];
  const id = `${category}-${backdrop}`;
  return (
    <svg
      viewBox="0 0 400 200"
      className={className}
      role="img"
      aria-label={title}
      preserveAspectRatio="xMidYMid slice"
    >
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={`sky-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={skyTop} />
          <stop offset="1" stopColor={skyBottom} />
        </linearGradient>
        <linearGradient id={`shine-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.25" />
        </linearGradient>
      </defs>
      <rect width="400" height="200" fill={`url(#sky-${id})`} />
      <rect y="168" width="400" height="32" fill={floor} />
      <g transform={mirrored ? 'translate(400 0) scale(-1 1)' : undefined}>
        <ellipse cx="205" cy="174" rx="175" ry="8" fill="#000" opacity="0.25" />
        <path d={shape.body} fill={colorHex} stroke="#000" strokeOpacity="0.35" strokeWidth="1.5" />
        <path d={shape.body} fill={`url(#shine-${id})`} />
        <path d={shape.glass} fill="#1b2433" opacity="0.85" />
        <rect x="350" y="114" width="16" height="6" rx="3" fill="#fff6c8" opacity="0.9" />
        {[110, 300].map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy="150" r="25" fill="#16181d" />
            <circle cx={cx} cy="150" r="13" fill="#9aa1ab" />
            <circle cx={cx} cy="150" r="4" fill="#3b4049" />
          </g>
        ))}
      </g>
    </svg>
  );
}
