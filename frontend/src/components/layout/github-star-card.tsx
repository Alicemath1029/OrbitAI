/**
 * Copyright 2025 RAIDS Lab
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { useQuery } from '@tanstack/react-query'
import { GithubIcon, StarIcon, XIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

const GITHUB_REPO = 'raids-lab/orbit'
const GITHUB_URL = `https://github.com/${GITHUB_REPO}`
const DISMISSED_KEY = 'github-star-card-dismissed'

export function GitHubStarCard() {
  const [isDismissed, setIsDismissed] = useState(false)

  useEffect(() => {
    const dismissed = localStorage.getItem(DISMISSED_KEY)
    setIsDismissed(dismissed === 'true')
  }, [])

  const { data: starCount } = useQuery({
    queryKey: ['github-stars', GITHUB_REPO],
    queryFn: async () => {
      try {
        const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}`)
        if (!response.ok) return null
        const data = await response.json()
        return data.stargazers_count as number
      } catch {
        return null
      }
    },
    staleTime: 1000 * 60 * 60, // 1 hour
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
  })

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, 'true')
    setIsDismissed(true)
  }

  if (isDismissed) return null

  return (
    <div className="group border-sidebar-border/70 bg-sidebar-accent/35 text-sidebar-foreground hover:border-sidebar-primary/25 hover:bg-sidebar-accent/55 relative rounded-lg border p-3 shadow-[0_10px_24px_-20px_hsl(211_31%_9%/0.28)] transition-[background-color,border-color,box-shadow]">
      <button
        onClick={handleDismiss}
        className="focus:ring-ring hover:bg-background/70 absolute top-2 right-2 rounded-lg p-1 opacity-0 transition-[background-color,opacity] group-hover:opacity-70 hover:opacity-100 focus:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-none"
        aria-label="关闭"
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>

      <div className="flex flex-col gap-2.5">
        <div className="flex items-start gap-2 pr-5">
          <div className="bg-sidebar-primary/12 ring-sidebar-primary/10 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1">
            <GithubIcon className="text-sidebar-primary h-4 w-4" />
          </div>
          <div className="flex-1 overflow-hidden">
            <h3 className="text-xs leading-tight font-semibold">Star Orbit</h3>
            <p className="text-sidebar-foreground/52 mt-0.5 text-[11px] leading-snug">
              支持我们的开源项目
            </p>
          </div>
        </div>

        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="focus:ring-ring border-sidebar-border/80 bg-background/70 text-sidebar-accent-foreground hover:bg-background flex w-full items-center justify-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-bold shadow-xs transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none"
        >
          <StarIcon className="h-3.5 w-3.5" />
          <span>Star on GitHub</span>
          {starCount !== null && starCount !== undefined && (
            <span className="bg-primary/10 text-primary ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold">
              {starCount}
            </span>
          )}
        </a>
      </div>
    </div>
  )
}
