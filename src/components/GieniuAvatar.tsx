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
        boxShadow:    '0 0 8px rgba(238,157,0,0.20)',
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
