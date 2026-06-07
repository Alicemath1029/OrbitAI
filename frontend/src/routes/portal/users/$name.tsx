import { createFileRoute } from '@tanstack/react-router'

import { detailLinkOptions, detailValidateSearch } from '@/components/layout/detail-page'
import PersonalDashboard from '@/components/user/personal-dashboard'

export const Route = createFileRoute('/portal/users/$name')({
  validateSearch: detailValidateSearch,
  component: RouteComponent,
  loader: ({ params }) => {
    const { name } = params
    return {
      crumb: name,
    }
  },
})

function RouteComponent() {
  const userName = Route.useParams().name
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <PersonalDashboard
      name={userName}
      currentTab={tab}
      setCurrentTab={(tab) => navigate(detailLinkOptions(tab))}
    />
  )
}
