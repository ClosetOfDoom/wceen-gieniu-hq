#!/usr/bin/env node
// Generate PWA PNG icons from public/stanley-duck.png (the monocled duck).
// Large icons: crop the dark gold medallion, mask to a circle (kills the white
// source corners), composite onto opaque navy #0B1E29. 32px favicon: crop to the
// duck's head+monocle so it stays recognizable at tiny size.
//
//   node scripts/gen-icons.mjs
import sharp from 'sharp'

const SRC  = 'public/stanley-duck.png'
const NAVY = { r: 0x0b, g: 0x1e, b: 0x29, alpha: 1 }

// Source is 1536x1024. Medallion circle ≈ centre (772, 490), radius ≈ 450.
const MEDALLION = { left: 322, top: 40, size: 900 }
// Duck head + monocle square (upper-centre of the art).
const HEAD      = { left: 620, top: 110, size: 440 }

async function circleIcon(size, outPath) {
  const crop = await sharp(SRC)
    .extract({ left: MEDALLION.left, top: MEDALLION.top, width: MEDALLION.size, height: MEDALLION.size })
    .resize(size, size)
    .png()
    .toBuffer()

  // Circle mask, inset slightly so no white source corner survives.
  const r = Math.round(size / 2) - Math.max(1, Math.round(size * 0.015))
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="#fff"/></svg>`
  )
  const masked = await sharp(crop)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer()

  await sharp({ create: { width: size, height: size, channels: 4, background: NAVY } })
    .composite([{ input: masked }])
    .flatten({ background: NAVY })
    .png()
    .toFile(outPath)
  console.log('  wrote', outPath, `${size}x${size}`)
}

async function headIcon(size, outPath) {
  const duck = await sharp(SRC)
    .extract({ left: HEAD.left, top: HEAD.top, width: HEAD.size, height: HEAD.size })
    .resize(size, size)
    .png()
    .toBuffer()
  await sharp({ create: { width: size, height: size, channels: 4, background: NAVY } })
    .composite([{ input: duck }])
    .flatten({ background: NAVY })
    .png()
    .toFile(outPath)
  console.log('  wrote', outPath, `${size}x${size}`)
}

console.log('Generating duck PWA icons from', SRC)
await headIcon(32, 'public/icons/icon-32.png')
await circleIcon(180, 'public/icons/apple-touch-icon.png')
await circleIcon(192, 'public/icons/icon-192.png')
await circleIcon(512, 'public/icons/icon-512.png')
console.log('Done.')
