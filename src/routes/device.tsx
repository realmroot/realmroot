import { createFileRoute, Outlet } from '@tanstack/react-router'

// `/device` is a layout for its children (`/device` index and `/device/approve`).
// It must render an <Outlet/> so the matched child renders; without it, every
// `/device/*` URL would fall back to this parent and show nothing.
export const Route = createFileRoute('/device')({
  component: Outlet,
})
