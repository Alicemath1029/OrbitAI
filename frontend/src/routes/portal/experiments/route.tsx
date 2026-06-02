import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/portal/experiments')({
  component: RouteComponent,
  loader: () => ({ crumb: '实验中心' }),
})

function RouteComponent() {
  return <Outlet />
}
