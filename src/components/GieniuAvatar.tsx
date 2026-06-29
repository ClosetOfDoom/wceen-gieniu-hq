export function GieniuAvatar({ size = 68 }: { size?: number }) {
  return (
    <div
      aria-label="Stanley — duck advisor"
      role="img"
      style={{
        width:        size,
        height:       size,
        borderRadius: '50%',
        overflow:     'hidden',
        border:       '1.5px solid var(--border-gold)',
        flexShrink:   0,
        // Oak ring + gold glow seats the navy duck into the forest palette
        boxShadow:    '0 0 0 3px var(--border-wood), 0 0 10px rgba(238,157,0,0.24)',
      }}
    >
      <img
        src="/stanley-duck.png"
        alt="Stanley"
        width={size}
        height={size}
        style={{
          width:          '100%',
          height:         '100%',
          objectFit:      'cover',
          objectPosition: 'center',
          display:        'block',
        }}
        draggable={false}
      />
    </div>
  )
}
