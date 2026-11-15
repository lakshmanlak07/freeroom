/**
 * FreeRoom's fox: an original chibi SVG drawn from simple shapes (not traced from any reference).
 * Faces right; the companion flips it with scaleX(-1). Parts are separate groups so CSS can
 * animate them per state (see `.fox[data-state=…]` in index.css): tail swish, blink, legs, hop.
 */
const ORANGE = '#F07C1F';
const ORANGE_DARK = '#C9600F';
const CREAM = '#FFF1DC';
const INK = '#2B1A0E';

export function FoxSprite({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className="fox-sprite overflow-visible">
      <g className="fox-bob">
        {/* tail: big fluffy curl with a white tip */}
        <g className="fox-tail">
          <path d="M24 45 C12 47 3 39 5 27 C6 21 12 20 14 25 C15 33 19 38 27 40 Z" fill={ORANGE} />
          <path d="M5 27 C6 21 12 20 14 25 C11 27 8 28 5 27 Z" fill="#FFFAF3" />
        </g>
        {/* legs (back pair, then front pair) */}
        <g className="fox-legs fox-legs-back" fill={ORANGE_DARK}>
          <rect x="23" y="49" width="5" height="9" rx="2.5" />
          <rect x="29" y="50" width="5" height="8" rx="2.5" />
        </g>
        <g className="fox-legs fox-legs-front" fill={ORANGE_DARK}>
          <rect x="35" y="50" width="5" height="8" rx="2.5" />
          <rect x="41" y="49" width="5" height="9" rx="2.5" />
        </g>
        {/* body + cream chest */}
        <ellipse cx="34" cy="45" rx="13" ry="9.5" fill={ORANGE} />
        <ellipse cx="39" cy="46" rx="6" ry="7" fill={CREAM} />
        {/* head */}
        <g className="fox-head">
          {/* big ears with dark inner */}
          <path d="M27 22 L24 4 L36 15 Z" fill={ORANGE} />
          <path d="M28 18 L26.5 9 L33 15 Z" fill={INK} opacity="0.75" />
          <path d="M43 15 L54 5 L51 23 Z" fill={ORANGE} />
          <path d="M45 15 L51.5 9.5 L50 18 Z" fill={INK} opacity="0.75" />
          <circle cx="39" cy="27" r="14" fill={ORANGE} />
          {/* cream cheeks and muzzle */}
          <path
            d="M27 31 C29 39 35 42 39.5 42 C44 42 50 39 52 31 C48 34 44 34 39.5 36 C35 34 31 34 27 31 Z"
            fill={CREAM}
          />
          {/* eyes with highlights (scaled for the blink) */}
          <g className="fox-eyes">
            <ellipse cx="33.5" cy="27" rx="2.6" ry="3.2" fill={INK} />
            <ellipse cx="45.5" cy="27" rx="2.6" ry="3.2" fill={INK} />
            <circle cx="34.4" cy="25.8" r="1" fill="#fff" />
            <circle cx="46.4" cy="25.8" r="1" fill="#fff" />
          </g>
          {/* blush */}
          <ellipse cx="29.5" cy="32" rx="2.4" ry="1.4" fill="#FF8FA3" opacity="0.7" />
          <ellipse cx="49.5" cy="32" rx="2.4" ry="1.4" fill="#FF8FA3" opacity="0.7" />
          {/* nose + mouth */}
          <ellipse cx="39.5" cy="33" rx="1.8" ry="1.3" fill={INK} />
          <path
            d="M37.5 35.5 Q39.5 37.5 41.5 35.5"
            stroke={INK}
            strokeWidth="1"
            fill="none"
            strokeLinecap="round"
          />
        </g>
      </g>
    </svg>
  );
}
