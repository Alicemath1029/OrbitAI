import Avatar from '@mui/material/Avatar'
import Badge from '@mui/material/Badge'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Divider from '@mui/material/Divider'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { alpha, styled } from '@mui/material/styles'
import useMediaQuery from '@mui/material/useMediaQuery'
import Identicon from '@polkadot/react-identicon'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { format, formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  BookOpenIcon,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Globe,
  LogOut,
  MenuIcon,
  MessageSquareMoreIcon,
  Moon,
  Sparkles,
  Sun,
  XIcon,
} from 'lucide-react'
import type { PropsWithChildren, ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import OrbitIcon from '@/components/icon/orbit-icon'
import OrbitTextIcon from '@/components/icon/orbit-text'
import type { NavGroupProps } from '@/components/sidebar/types'
import { UserAvatar } from '@/components/user/user-avatar'

import { Role, apiQueueSwitch } from '@/services/api/auth'
import { QueueBasic, apiQueueList } from '@/services/api/queue'

import useIsAdmin from '@/hooks/use-admin'
import { useAuth } from '@/hooks/use-auth'

import { getUserPseudonym } from '@/utils/pseudonym'
import { stringToSS58 } from '@/utils/ss58'
import { atomUserContext, atomUserInfo, globalHideUsername, globalLastView } from '@/utils/store'
import { configUrlWebsiteBaseAtom } from '@/utils/store/config'
import { useTheme } from '@/utils/theme'
import { showErrorToast } from '@/utils/toast'

import { MinimalNavSection } from './nav-section'

const NAV_WIDTH = 304
const NAV_MINI_WIDTH = 92
const HEADER_HEIGHT = 72

type MinimalDashboardShellProps = PropsWithChildren<{
  groups: NavGroupProps[]
  headerStart?: ReactNode
  headerEnd?: ReactNode
  fixedLayout?: boolean
}>

export function MinimalDashboardShell({
  children,
  fixedLayout,
  groups,
  headerEnd,
  headerStart,
}: MinimalDashboardShellProps) {
  const isDesktop = useMediaQuery('(min-width: 1200px)')
  const [mini, setMini] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const navWidth = mini ? NAV_MINI_WIDTH : NAV_WIDTH

  const navContent = (
    <NavContent
      groups={groups}
      mini={mini}
      onToggleMini={() => setMini((value) => !value)}
      onCloseMobile={() => setMobileOpen(false)}
    />
  )

  return (
    <ShellRoot>
      {isDesktop ? (
        <DesktopNav sx={{ width: navWidth }}>{navContent}</DesktopNav>
      ) : (
        <Drawer
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          slotProps={{
            paper: {
              sx: {
                width: NAV_WIDTH,
                border: 0,
                backgroundImage: 'none',
              },
            },
          }}
        >
          <NavContent groups={groups} onCloseMobile={() => setMobileOpen(false)} />
        </Drawer>
      )}

      <MainRoot sx={{ pl: { xs: 0, xl: `${navWidth}px` } }}>
        <ShellHeader
          sx={{
            left: { xs: 0, xl: `${navWidth}px` },
            width: { xs: '100%', xl: `calc(100% - ${navWidth}px)` },
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
            {!isDesktop && (
              <IconButton onClick={() => setMobileOpen(true)} size="small">
                <MenuIcon size={20} />
              </IconButton>
            )}
            {headerStart}
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>{headerEnd}</Box>
        </ShellHeader>

        <ContentRoot fixedLayout={fixedLayout}>{children}</ContentRoot>
      </MainRoot>
    </ShellRoot>
  )
}

function NavContent({
  groups,
  mini,
  onCloseMobile,
  onToggleMini,
}: {
  groups: NavGroupProps[]
  mini?: boolean
  onCloseMobile?: () => void
  onToggleMini?: () => void
}) {
  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
      }}
    >
      <NavHeader mini={mini} onCloseMobile={onCloseMobile} onToggleMini={onToggleMini} />
      {mini && <QueueSwitcher mini={mini} />}
      <MinimalNavSection groups={groups} mini={mini} onNavigate={onCloseMobile} />
      <Box sx={{ flexGrow: 1 }} />
      <NavFooter mini={mini} />
    </Box>
  )
}

function NavHeader({
  mini,
  onCloseMobile,
  onToggleMini,
}: {
  mini?: boolean
  onCloseMobile?: () => void
  onToggleMini?: () => void
}) {
  return (
    <Box
      sx={{
        px: mini ? 1.25 : 3,
        pt: mini ? 3 : 3.1,
        pb: mini ? 2 : 2.1,
        gap: 1.25,
        minHeight: mini ? 92 : 100,
        display: 'flex',
        position: 'relative',
        alignItems: 'center',
        justifyContent: mini ? 'center' : 'flex-start',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          minWidth: 0,
          width: mini ? 'auto' : 1,
          pr: mini ? 0 : 3.75,
          transform: mini ? 'none' : 'translateX(-8px)',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.15,
            minWidth: 0,
            flex: '1 1 auto',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.85, flexShrink: 0 }}>
            <Box component={OrbitIcon} sx={{ width: 42, height: 42, color: 'primary.main' }} />
            {!mini && (
              <Box
                component={OrbitTextIcon}
                sx={{ width: 92, height: 30, color: 'text.primary', display: { xs: 'block' } }}
              />
            )}
          </Box>

          {!mini && <QueueSwitcher compact />}
        </Box>
      </Box>

      {!mini && onToggleMini && (
        <Tooltip title="折叠侧边栏">
          <IconButton
            size="small"
            onClick={onToggleMini}
            sx={{
              top: '50%',
              right: 13,
              width: 30,
              height: 30,
              position: 'absolute',
              color: 'text.secondary',
              borderRadius: 1.5,
              transform: 'translateY(-50%)',
              bgcolor: 'background.paper',
              boxShadow: (theme) => `inset 0 0 0 1px ${alpha(theme.palette.grey[500], 0.12)}`,
              '&:hover': {
                color: 'text.primary',
                bgcolor: 'action.hover',
              },
            }}
          >
            <ChevronsLeft size={17} />
          </IconButton>
        </Tooltip>
      )}

      {!mini && onCloseMobile && (
        <IconButton
          size="small"
          onClick={onCloseMobile}
          sx={{
            top: '50%',
            right: 13,
            position: 'absolute',
            transform: 'translateY(-50%)',
            display: { xl: 'none' },
          }}
        >
          <XIcon size={18} />
        </IconButton>
      )}

      {mini && onToggleMini && (
        <Tooltip title="展开侧边栏">
          <IconButton size="small" onClick={onToggleMini} sx={{ position: 'absolute', right: 6 }}>
            <ChevronsRight size={18} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  )
}

function QueueSwitcher({ compact, mini }: { compact?: boolean; mini?: boolean }) {
  const [account, setAccount] = useAtom(atomUserContext)
  const queryClient = useQueryClient()
  const location = useLocation()
  const isAdminView = useMemo(() => {
    const pathParts = location.pathname.split('/').filter(Boolean)
    return pathParts[0] === 'admin'
  }, [location.pathname])
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)

  const { data: queues } = useQuery({
    queryKey: ['queues'],
    queryFn: apiQueueList,
    select: (res) => res.data,
  })

  const currentQueue = useMemo(
    () => queues?.find((queue) => queue.name === account?.queue),
    [account?.queue, queues]
  )

  const [currentExpiredAt, currentExpiredDiff] = useMemo(() => {
    if (!currentQueue?.expiredAt) {
      return [null, 0] as const
    }
    const expiredAt = new Date(currentQueue.expiredAt)
    return [expiredAt, expiredAt.getTime() - Date.now()] as const
  }, [currentQueue])

  const { mutate: switchQueue } = useMutation({
    mutationFn: (project: QueueBasic) => apiQueueSwitch(project.name),
    onSuccess: ({ context }, { nickname: name }) => {
      setAccount(context)
      toast.success(`已切换至账户 ${name}`)
      void queryClient.invalidateQueries()
    },
    onError: showErrorToast,
  })

  const disabled = isAdminView || !queues?.length

  return (
    <Box
      sx={{
        flex: compact ? '0 1 auto' : undefined,
        minWidth: 0,
        px: compact ? 0 : mini ? 1 : 2,
        pb: compact ? 0 : 1,
      }}
    >
      <Tooltip title={mini || compact ? (currentQueue?.nickname ?? '账户') : ''} placement="right">
        <AccountButton
          compact={compact}
          disabled={disabled}
          mini={mini}
          onClick={(event) => setAnchorEl(event.currentTarget)}
        >
          {compact ? (
            <Box
              sx={{
                width: 6,
                height: 6,
                flexShrink: 0,
                borderRadius: '50%',
                bgcolor: 'primary.main',
                boxShadow: (theme) => `0 0 0 3px ${alpha(theme.palette.primary.main, 0.12)}`,
              }}
            />
          ) : (
            <QueueAvatar queueName={currentQueue?.name} size={38} />
          )}

          {!mini && (
            <>
              <Box
                sx={{
                  minWidth: 0,
                  maxWidth: compact ? 58 : 148,
                  flex: '0 1 auto',
                  textAlign: compact ? 'left' : 'center',
                }}
              >
                <Typography
                  variant={compact ? 'caption' : 'subtitle2'}
                  noWrap
                  sx={
                    compact
                      ? { fontSize: 11, fontWeight: 700, lineHeight: 1.1, color: 'text.secondary' }
                      : undefined
                  }
                >
                  {currentQueue?.nickname ?? '账户'}
                </Typography>
                {!compact && currentExpiredAt && (
                  <Typography variant="caption" color="text.disabled" noWrap>
                    {currentExpiredDiff < 0
                      ? '已过期'
                      : `${formatDistanceToNow(currentExpiredAt, {
                          locale: zhCN,
                          addSuffix: true,
                        })}有效`}
                  </Typography>
                )}
              </Box>
              <ChevronsUpDown size={compact ? 12 : 17} />
            </>
          )}
        </AccountButton>
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={
          compact
            ? { horizontal: 'center', vertical: 'bottom' }
            : { horizontal: 'right', vertical: 'center' }
        }
        transformOrigin={
          compact
            ? { horizontal: 'center', vertical: 'top' }
            : { horizontal: 'left', vertical: 'center' }
        }
        slotProps={{
          paper: {
            sx: {
              width: compact ? 220 : 240,
              mt: compact ? 1 : 0,
              ml: compact ? 0 : 1,
              borderRadius: 2,
            },
          },
        }}
      >
        <MenuItem disabled>
          <Typography variant="caption" color="text.disabled">
            账户
          </Typography>
        </MenuItem>
        {queues?.map((queue) => (
          <MenuItem
            key={queue.name}
            selected={currentQueue?.name === queue.name}
            onClick={() => {
              setAnchorEl(null)
              if (currentQueue?.name !== queue.name) {
                switchQueue(queue)
              }
            }}
          >
            <ListItemIcon>
              <QueueAvatar queueName={queue.name} size={28} />
            </ListItemIcon>
            <Typography variant="body2" noWrap>
              {queue.nickname}
            </Typography>
          </MenuItem>
        ))}
        {currentExpiredAt && (
          <>
            <Divider />
            <MenuItem disabled>
              <Typography variant="caption" color="text.disabled">
                {format(currentExpiredAt, 'PPP', { locale: zhCN })} 过期
              </Typography>
            </MenuItem>
          </>
        )}
      </Menu>
    </Box>
  )
}

function QueueAvatar({ queueName, size }: { queueName?: string; size: number }) {
  return (
    <Avatar
      variant="rounded"
      sx={{
        width: size,
        height: size,
        bgcolor: 'primary.lighter',
        color: 'primary.dark',
        borderRadius: 2,
      }}
    >
      {queueName && (
        <Identicon
          value={stringToSS58(queueName)}
          size={Math.max(22, size - 6)}
          theme="substrate"
          className="cursor-pointer!"
        />
      )}
    </Avatar>
  )
}

function NavFooter({ mini }: { mini?: boolean }) {
  const website = useAtomValue(configUrlWebsiteBaseAtom)
  const user = useAtomValue(atomUserInfo)
  const context = useAtomValue(atomUserContext)
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  const setLastView = useSetAtom(globalLastView)
  const isAdminView = useIsAdmin()
  const hideUsername = useAtomValue(globalHideUsername)
  const { t, i18n } = useTranslation()
  const { logout } = useAuth()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)

  const displayName = hideUsername
    ? getUserPseudonym(user?.name || '')
    : user?.nickname || user?.name || ''

  const handleClose = () => setAnchorEl(null)

  const handleSwitchView = () => {
    handleClose()
    if (isAdminView) {
      setLastView('portal')
      navigate({ to: '/portal' })
      toast.success(t('navUser.switchToUserView'))
    } else {
      setLastView('admin')
      navigate({ to: '/admin' })
      toast.success(t('navUser.switchToAdminView'))
    }
  }

  const changeLanguage = (lng: 'zh' | 'en' | 'ja' | 'ko') => {
    void i18n.changeLanguage(lng)
    handleClose()
  }

  return (
    <Box sx={{ p: mini ? 1 : 2 }}>
      <Divider sx={{ mb: 1.5 }} />
      <Tooltip title={mini ? displayName : ''} placement="right">
        <AccountButton mini={mini} onClick={(event) => setAnchorEl(event.currentTarget)}>
          <Badge
            variant="dot"
            color="success"
            overlap="circular"
            anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
          >
            <UserAvatar user={user} className="size-9 rounded-xl" />
          </Badge>

          {!mini && (
            <>
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Typography variant="subtitle2" noWrap>
                  {displayName}
                </Typography>
                <Typography variant="caption" color="text.disabled" noWrap>
                  {user?.email}
                </Typography>
              </Box>
              <ChevronsUpDown size={16} />
            </>
          )}
        </AccountButton>
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
        anchorOrigin={{ horizontal: 'right', vertical: 'top' }}
        transformOrigin={{ horizontal: 'left', vertical: 'bottom' }}
        slotProps={{ paper: { sx: { width: 260, ml: 1, borderRadius: 2 } } }}
      >
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="subtitle2" noWrap>
            {displayName}
          </Typography>
          <Typography variant="body2" color="text.secondary" noWrap>
            {user?.email}
          </Typography>
        </Box>
        <Divider />

        {context?.rolePlatform === Role.Admin && (
          <MenuItem onClick={handleSwitchView}>
            <ListItemIcon>
              <Sparkles size={18} />
            </ListItemIcon>
            {t('navUser.switchTo') + (isAdminView ? t('navUser.normalUser') : t('navUser.admin'))}
          </MenuItem>
        )}

        <MenuItem
          onClick={() => {
            handleClose()
            window.open(website)
          }}
        >
          <ListItemIcon>
            <BookOpenIcon size={18} />
          </ListItemIcon>
          {t('navUser.platformDocs')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            handleClose()
            window.open('https://github.com/raids-lab/orbit/issues')
          }}
        >
          <ListItemIcon>
            <MessageSquareMoreIcon size={18} />
          </ListItemIcon>
          {t('navUser.feedback')}
        </MenuItem>
        <MenuItem onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          <ListItemIcon>{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</ListItemIcon>
          {theme === 'light' ? t('navUser.darkMode') : t('navUser.lightMode')}
        </MenuItem>
        <Divider />
        <MenuItem disabled>
          <ListItemIcon>
            <Globe size={18} />
          </ListItemIcon>
          {t('navUser.language')}
        </MenuItem>
        {(
          [
            ['zh', t('navUser.chinese')],
            ['en', t('navUser.english')],
            ['ja', t('navUser.japanese')],
            ['ko', t('navUser.korean')],
          ] as const
        ).map(([lng, label]) => (
          <MenuItem
            key={lng}
            selected={i18n.language === lng}
            onClick={() => changeLanguage(lng)}
            sx={{ pl: 6 }}
          >
            {label}
          </MenuItem>
        ))}
        <Divider />
        <MenuItem
          onClick={() => {
            handleClose()
            logout()
            navigate({ to: '/auth', search: { redirect: '/', token: '' } })
          }}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon sx={{ color: 'inherit' }}>
            <LogOut size={18} />
          </ListItemIcon>
          {t('navUser.logout')}
        </MenuItem>
      </Menu>
    </Box>
  )
}

const ShellRoot = styled('div')(({ theme }) => ({
  minHeight: '100vh',
  color: theme.vars?.palette.text.primary ?? theme.palette.text.primary,
  backgroundColor: '#F4F6F8',
}))

const DesktopNav = styled(Box)(({ theme }) => ({
  top: 0,
  left: 0,
  height: '100vh',
  display: 'none',
  position: 'fixed',
  flexDirection: 'column',
  zIndex: theme.zIndex.appBar + 1,
  borderRight: `1px solid ${alpha(theme.palette.grey[500], 0.16)}`,
  backgroundColor: theme.vars?.palette.background.paper ?? theme.palette.background.paper,
  transition: theme.transitions.create('width', {
    duration: theme.transitions.duration.standard,
  }),
  [theme.breakpoints.up('xl')]: {
    display: 'flex',
  },
}))

const MainRoot = styled(Box)(({ theme }) => ({
  minHeight: '100vh',
  transition: theme.transitions.create('padding-left', {
    duration: theme.transitions.duration.standard,
  }),
}))

const ShellHeader = styled(Box)(({ theme }) => ({
  top: 0,
  right: 0,
  height: HEADER_HEIGHT,
  zIndex: theme.zIndex.appBar,
  display: 'flex',
  position: 'fixed',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: theme.spacing(0, 3),
  borderBottom: `1px solid ${alpha(theme.palette.grey[500], 0.12)}`,
  backgroundColor: alpha(theme.palette.background.default, 0.82),
  backdropFilter: 'blur(16px)',
  transition: theme.transitions.create(['left', 'width'], {
    duration: theme.transitions.duration.standard,
  }),
  [theme.breakpoints.down('md')]: {
    height: 64,
    padding: theme.spacing(0, 2),
  },
}))

const ContentRoot = styled(Box, {
  shouldForwardProp: (prop: string) => prop !== 'fixedLayout',
})<{ fixedLayout?: boolean }>(({ fixedLayout, theme }) => ({
  minHeight: '100vh',
  paddingTop: HEADER_HEIGHT,
  ...(fixedLayout
    ? {
        height: '100vh',
        overflow: 'hidden',
      }
    : {
        overflow: 'auto',
      }),
  [theme.breakpoints.down('md')]: {
    paddingTop: 64,
  },
}))

const AccountButton = styled(ButtonBase, {
  shouldForwardProp: (prop: string) => !['compact', 'mini'].includes(prop),
})<{ compact?: boolean; mini?: boolean }>(({ compact, mini, theme }) => ({
  width: compact ? 'auto' : '100%',
  minWidth: 0,
  maxWidth: compact ? 104 : 'none',
  gap: compact ? theme.spacing(0.65) : theme.spacing(1.5),
  display: 'flex',
  alignItems: 'center',
  justifyContent: compact ? 'flex-start' : 'center',
  minHeight: compact ? 28 : mini ? 52 : 64,
  padding: compact
    ? theme.spacing(0.25, 0.65)
    : mini
      ? theme.spacing(0.75)
      : theme.spacing(1.1, 1.75),
  borderRadius: compact ? 999 : Number(theme.shape.borderRadius) * 1.5,
  color: theme.vars?.palette.text.primary ?? theme.palette.text.primary,
  textAlign: 'left',
  backgroundColor: compact ? alpha(theme.palette.grey[500], 0.06) : 'transparent',
  boxShadow: compact ? `inset 0 0 0 1px ${alpha(theme.palette.grey[500], 0.11)}` : 'none',
  transition: theme.transitions.create(['background-color', 'box-shadow', 'color'], {
    duration: theme.transitions.duration.shorter,
  }),
  '&:hover': {
    color: compact ? theme.palette.primary.dark : theme.palette.text.primary,
    backgroundColor: compact
      ? alpha(theme.palette.primary.main, 0.075)
      : (theme.vars?.palette.action.hover ?? theme.palette.action.hover),
    boxShadow: compact ? `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.2)}` : 'none',
  },
  '&.Mui-disabled': {
    opacity: 0.58,
  },
  ...(!mini &&
    !compact && {
      '& > *': {
        transform: 'translateX(-10px)',
      },
    }),
}))
