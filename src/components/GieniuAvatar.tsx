export function GieniuAvatar({ size = 68 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 80 80"
      width={size}
      height={size}
      aria-label="Stanley — owl advisor"
      role="img"
    >
      {/* Medallion ring */}
      <circle cx="40" cy="40" r="38" fill="#10192e" stroke="#7a6030" strokeWidth="1.5" />
      <circle cx="40" cy="40" r="33" fill="none" stroke="#c9a96e" strokeWidth="0.5" strokeDasharray="3 4" />

      {/* Body */}
      <ellipse cx="40" cy="52" rx="16" ry="19" fill="#162035" stroke="#c9a96e" strokeWidth="1" />

      {/* Wings */}
      <ellipse cx="26" cy="54" rx="7" ry="13" fill="#10192e" stroke="#c9a96e" strokeWidth="0.8" transform="rotate(-8 26 54)" />
      <ellipse cx="54" cy="54" rx="7" ry="13" fill="#10192e" stroke="#c9a96e" strokeWidth="0.8" transform="rotate(8 54 54)" />

      {/* Belly texture */}
      <ellipse cx="40" cy="56" rx="7" ry="10" fill="#1c2b45" opacity="0.9" />
      <line x1="40" y1="48" x2="40" y2="64" stroke="#c9a96e" strokeWidth="0.4" opacity="0.3" />
      <line x1="36" y1="52" x2="44" y2="52" stroke="#c9a96e" strokeWidth="0.4" opacity="0.3" />
      <line x1="36" y1="57" x2="44" y2="57" stroke="#c9a96e" strokeWidth="0.4" opacity="0.3" />

      {/* Head */}
      <circle cx="40" cy="30" r="13" fill="#162035" stroke="#c9a96e" strokeWidth="1" />

      {/* Ear tufts */}
      <polygon points="32,19 28,11 36,17" fill="#c9a96e" opacity="0.9" />
      <polygon points="48,19 52,11 44,17" fill="#c9a96e" opacity="0.9" />

      {/* Eyes */}
      <circle cx="35" cy="30" r="5.5" fill="#0b1020" stroke="#c9a96e" strokeWidth="1" />
      <circle cx="45" cy="30" r="5.5" fill="#0b1020" stroke="#c9a96e" strokeWidth="1" />
      <circle cx="35.5" cy="29.5" r="2.5" fill="#2dd4bf" opacity="0.85" />
      <circle cx="45.5" cy="29.5" r="2.5" fill="#2dd4bf" opacity="0.85" />
      <circle cx="35" cy="29" r="1" fill="#080e1c" />
      <circle cx="45" cy="29" r="1" fill="#080e1c" />
      {/* Eye glint */}
      <circle cx="36.5" cy="28" r="0.8" fill="white" opacity="0.7" />
      <circle cx="46.5" cy="28" r="0.8" fill="white" opacity="0.7" />

      {/* Monocle on right eye */}
      <circle cx="45" cy="30" r="7.5" fill="none" stroke="#c9a96e" strokeWidth="0.7" opacity="0.5" />
      <line x1="52" y1="34" x2="56" y2="38" stroke="#c9a96e" strokeWidth="0.7" opacity="0.5" />

      {/* Beak */}
      <polygon points="40,34 37,38 43,38" fill="#fbbf24" />

      {/* Feet */}
      <g stroke="#fbbf24" strokeWidth="1.5" strokeLinecap="round">
        <line x1="35" y1="69" x2="31" y2="74" />
        <line x1="35" y1="69" x2="35" y2="75" />
        <line x1="35" y1="69" x2="39" y2="73" />
        <line x1="45" y1="69" x2="41" y2="73" />
        <line x1="45" y1="69" x2="45" y2="75" />
        <line x1="45" y1="69" x2="49" y2="74" />
      </g>

      {/* Small scroll/book under wing */}
      <rect x="27" y="56" width="9" height="6" rx="1" fill="#c9a96e" opacity="0.25" />
      <line x1="29" y1="58" x2="34" y2="58" stroke="#c9a96e" strokeWidth="0.5" opacity="0.5" />
      <line x1="29" y1="60" x2="34" y2="60" stroke="#c9a96e" strokeWidth="0.5" opacity="0.5" />
    </svg>
  )
}
