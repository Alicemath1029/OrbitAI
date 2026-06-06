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
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import { LucideIcon } from 'lucide-react'
import { varAlpha } from 'minimal-shared/utils'
import { ReactNode } from 'react'

import LoadingCircleIcon from '../icon/loading-circle-icon'

interface PieCardProps {
  icon: LucideIcon
  cardTitle: string
  cardDescription: string
  isLoading?: boolean
  className?: string
  children?: ReactNode
}

const PieCard = ({
  children,
  icon: Icon,
  cardTitle,
  cardDescription,
  isLoading,
  className,
}: PieCardProps) => {
  const theme = useTheme()

  return (
    <Card
      className={className}
      sx={{
        p: 2.5,
        pb: 0,
        minHeight: 324,
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 2.5,
        border: `1px solid ${varAlpha('145 158 171', 0.12)}`,
        bgcolor: 'background.paper',
        boxShadow: `0 0 2px 0 ${varAlpha('145 158 171', 0.16)}, 0 12px 24px -12px ${varAlpha(
          '20 26 33',
          0.18
        )}`,
        transition: theme.transitions.create(['border-color', 'box-shadow', 'transform'], {
          duration: theme.transitions.duration.shorter,
        }),
        '&::before': {
          position: 'absolute',
          inset: 0,
          content: '""',
          background: `linear-gradient(135deg, ${varAlpha('0 167 111', 0.08)} 0%, transparent 56%)`,
          pointerEvents: 'none',
        },
        '&:hover': {
          transform: 'translateY(-3px)',
          borderColor: varAlpha('0 167 111', 0.2),
          boxShadow: `0 0 2px 0 ${varAlpha('0 167 111', 0.16)}, 0 18px 32px -18px ${varAlpha(
            '20 26 33',
            0.3
          )}`,
        },
      }}
    >
      {isLoading && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 3,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: varAlpha('255 255 255', 0.72),
            backdropFilter: 'blur(6px)',
          }}
        >
          <LoadingCircleIcon />
        </Box>
      )}

      <Stack
        direction="row"
        spacing={1.5}
        sx={{
          position: 'relative',
          zIndex: 1,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Tooltip title={cardDescription} arrow>
          <Box
            tabIndex={0}
            sx={{
              width: 'fit-content',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 1,
              px: 1.25,
              py: 0.75,
              borderRadius: 999,
              color: 'text.secondary',
              bgcolor: varAlpha('145 158 171', 0.08),
              boxShadow: `inset 0 0 0 1px ${varAlpha('145 158 171', 0.12)}`,
              outline: 'none',
              cursor: 'help',
              transition: theme.transitions.create(['background-color', 'box-shadow', 'color'], {
                duration: theme.transitions.duration.shorter,
              }),
              '&:hover, &:focus-visible': {
                color: 'primary.dark',
                bgcolor: varAlpha('0 167 111', 0.1),
                boxShadow: `inset 0 0 0 1px ${varAlpha('0 167 111', 0.18)}`,
              },
            }}
          >
            <Icon size={17} strokeWidth={2.1} />
            <Typography variant="subtitle2" sx={{ lineHeight: 1.2 }}>
              {cardTitle}
            </Typography>
          </Box>
        </Tooltip>
      </Stack>

      <Box
        sx={{ position: 'relative', zIndex: 1, height: 248, mx: -1, mt: 1.5, overflow: 'hidden' }}
      >
        {children}
      </Box>
    </Card>
  )
}

export default PieCard
