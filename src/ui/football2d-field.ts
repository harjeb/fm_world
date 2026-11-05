/**
 * Adapted from cyntler/football2d (e61ad7f), field grass / center-line layers.
 * Copyright (c) 2021 Damian Cyntler. MIT; see THIRD_PARTY_NOTICES.md.
 * Changes: Vite imports removed, seven-a-side proportions and our palette.
 */
type FieldDimensions = { x: number; y: number; width: number; height: number }

function drawFieldGrass(ctx: CanvasRenderingContext2D, { x, y, width, height }: FieldDimensions): void {
  ctx.fillStyle = '#142a1c'
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.fillStyle = '#1b4229'
  ctx.fillRect(x, y, width - x, height - y)
  const strips = 14
  const stripWidth = (width - x) / strips
  ctx.fillStyle = '#1f4a30'
  for (let index = 0; index < strips; index += 2) ctx.fillRect(x + index * stripWidth, y, stripWidth, height - y)
}

function drawFieldCenterLines(ctx: CanvasRenderingContext2D, { x, y, width, height }: FieldDimensions): void {
  const centerX = (x + width) / 2
  const centerY = (y + height) / 2
  ctx.beginPath()
  ctx.moveTo(centerX, y)
  ctx.lineTo(centerX, height)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(centerX, centerY, 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(centerX, centerY, (width - x) * 0.07, 0, Math.PI * 2)
  ctx.stroke()
}

/** football2d's layered field renderer, without its placeholder random ball simulation. */
export function drawFootball2dBase(ctx: CanvasRenderingContext2D, dimensions: FieldDimensions): void {
  drawFieldGrass(ctx, dimensions)
  ctx.strokeStyle = 'rgba(255,255,255,.62)'
  ctx.fillStyle = ctx.strokeStyle
  ctx.lineWidth = 2.5
  drawFieldCenterLines(ctx, dimensions)
}
