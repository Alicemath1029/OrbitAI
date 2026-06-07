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
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { createFileRoute, redirect } from '@tanstack/react-router'
import {
  Activity,
  ArchiveRestoreIcon,
  BarChart3,
  BoxIcon,
  CpuIcon,
  Database,
  FlaskConicalIcon,
  GaugeIcon,
  GitBranch,
  HardDriveIcon,
  HelpCircle,
  Network,
  ShieldCheck,
  Zap,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useState } from 'react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

import OrbitIcon from '@/components/icon/orbit-icon'
import OrbitText from '@/components/icon/orbit-text'
import NotFound from '@/components/placeholder/not-found'

import { AuthMode } from '@/services/api/auth'
import { queryAuthMode } from '@/services/query/auth'

import { ForgotPasswordForm } from './-components/forgot-password-form'
import { LoginForm } from './-components/login-form'
import { SignupForm } from './-components/signup-form'

export const Route = createFileRoute('/auth/')({
  validateSearch: (search) => ({
    redirect: (search.redirect as string) || undefined,
    token: (search.token as string) || undefined,
  }),
  beforeLoad: ({ context, search }) => {
    // Redirect if already authenticated
    if (context.auth.isAuthenticated && !!search.redirect) {
      throw redirect({ to: search.redirect })
    }
  },
  loader: async ({ context: { queryClient } }) => {
    return queryClient
      .ensureQueryData(queryAuthMode)
      .then((res) => {
        // ensureQueryData returns the raw result from queryFn (IResponse<IAuthModeResponse>)
        // We need to manually access .data here
        return {
          enableLdap: res.data?.enableLdap ?? false,
          ldapAlias: res.data?.ldapAlias,
          ldapHelp: res.data?.ldapHelp,
          enableNormalLogin: res.data?.enableNormalLogin ?? false,
          enableNormalRegister: res.data?.enableNormalRegister ?? false,
        }
      })
      .catch(() => {
        return {
          enableLdap: false,
          ldapAlias: undefined,
          ldapHelp: undefined,
          enableNormalLogin: true,
          enableNormalRegister: false,
        }
      })
  },
  component: LoginPage,
  notFoundComponent: () => <NotFound />,
})

function LoginPage() {
  const searchParams = Route.useSearch()
  const { auth } = Route.useRouteContext()
  const [showSignup, setShowSignup] = useState(false)
  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const [showRegisterDialog, setShowRegisterDialog] = useState(false)
  const [registerDialogType, setRegisterDialogType] = useState<'ldap' | 'normal_disabled'>('ldap')
  const { enableLdap, ldapAlias, ldapHelp, enableNormalLogin, enableNormalRegister } =
    Route.useLoaderData()

  // Ensure selectedMode is one of enabled modes, preferring LDAP as default if enabled
  const [selectedMode, setSelectedMode] = useState<AuthMode>(() => {
    if (enableLdap) return AuthMode.LDAP
    return AuthMode.NORMAL
  })

  const showSwitcher = enableLdap && enableNormalLogin
  const authPanelKey = showSignup
    ? 'signup'
    : showForgotPassword
      ? 'forgot-password'
      : `login-${selectedMode}`

  const handleModeChange = (newMode: string) => {
    const mode = newMode as AuthMode
    setSelectedMode(mode)
    setShowSignup(false)
    setShowForgotPassword(false)
  }

  const handleRegisterClick = () => {
    if (selectedMode === AuthMode.LDAP) {
      setRegisterDialogType('ldap')
      setShowRegisterDialog(true)
      return
    }

    if (enableNormalRegister) {
      setShowSignup(true)
      setShowForgotPassword(false)
      return
    }

    setRegisterDialogType('normal_disabled')
    setShowRegisterDialog(true)
  }

  const handleForgotPasswordClick = () => {
    if (selectedMode === AuthMode.LDAP) {
      toast.info('请联系平台管理员协助重置密码')
      return
    }

    setShowForgotPassword(true)
    setShowSignup(false)
  }

  const handleBackToLogin = () => {
    setShowSignup(false)
    setShowForgotPassword(false)
  }

  return (
    <Box className="orbit-auth-hero-page">
      <HeroBackdrop />

      <Box component="header" className="orbit-auth-hero-header">
        <Box className="orbit-auth-hero-logo">
          <OrbitIcon className="h-9 w-9 text-[#00A76F]" />
          <OrbitText className="h-5 w-[90px] text-[#1C252E]" />
        </Box>

        <Typography variant="subtitle2" sx={{ color: 'text.secondary' }}>
          Orbit workspace
        </Typography>
      </Box>

      <Box component="main" className="orbit-auth-hero-main">
        <Box component="section" className="orbit-auth-statement-section">
          <HeroDynamics />

          <Box className="orbit-auth-statement-layout">
            <motion.div
              className="orbit-auth-statement-copy"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.58, ease: [0.22, 1, 0.36, 1] }}
            >
              <Box className="orbit-auth-copy-kicker">
                <Activity className="size-3.5" />
                Orbit workspace
              </Box>

              <Typography
                component="h1"
                className="orbit-auth-hero-title"
                aria-label="Orbit is all you need"
              >
                <motion.span
                  className="is-brand"
                  aria-hidden="true"
                  initial={{ opacity: 0, y: 26, filter: 'blur(8px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{
                    delay: 0.12,
                    duration: 0.62,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                >
                  Orbit
                </motion.span>
                <motion.span
                  className="is-slogan-row"
                  aria-hidden="true"
                  initial={{ opacity: 0, y: 18, filter: 'blur(8px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{
                    delay: 0.22,
                    duration: 0.58,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                >
                  <span className="orbit-auth-title-rule" />
                  <span className="is-slogan">is all you need</span>
                </motion.span>
              </Typography>

              <Box className="orbit-auth-title-signal" aria-hidden="true">
                <Box />
                <Box />
                <Box />
              </Box>
            </motion.div>

            <Box className="orbit-auth-hero-login" aria-label="登录表单">
              <AnimatePresence mode="wait" initial={false}>
                {showSignup && selectedMode === AuthMode.NORMAL ? (
                  <motion.div
                    key={authPanelKey}
                    className="orbit-auth-hero-panel"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <AuthCardHeader
                      icon={<ShieldCheck className="size-4" />}
                      title="创建账号"
                      description="创建普通登录账号。"
                    />
                    <SignupForm />
                    <FormSwitch
                      text="已有账号？"
                      actionText="立即登录"
                      onClick={handleBackToLogin}
                    />
                  </motion.div>
                ) : showForgotPassword && selectedMode === AuthMode.NORMAL ? (
                  <motion.div
                    key={authPanelKey}
                    className="orbit-auth-hero-panel"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <AuthCardHeader
                      icon={<Zap className="size-4" />}
                      title="找回密码"
                      description="重置普通账号密码。"
                    />
                    <ForgotPasswordForm />
                    <FormSwitch
                      text="想起密码了？"
                      actionText="返回登录"
                      onClick={handleBackToLogin}
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    key={authPanelKey}
                    className="orbit-auth-hero-panel"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <AuthCardHeader
                      icon={
                        selectedMode === AuthMode.LDAP ? (
                          <Network className="size-4" />
                        ) : (
                          <Database className="size-4" />
                        )
                      }
                      title="进入工作台"
                      description={
                        selectedMode === AuthMode.LDAP
                          ? `${ldapAlias || 'LDAP'} 统一身份认证`
                          : '使用平台账号继续访问'
                      }
                      helpText={
                        selectedMode === AuthMode.LDAP
                          ? ldapHelp || '通过管理员配置的 LDAP 服务器进行身份认证'
                          : undefined
                      }
                    />

                    {showSwitcher && (
                      <Tabs
                        value={selectedMode}
                        onChange={(_, value) => handleModeChange(value)}
                        variant="fullWidth"
                        className="orbit-auth-template-tabs"
                      >
                        <Tab value={AuthMode.LDAP} label={`${ldapAlias || 'LDAP'} 登录`} />
                        <Tab value={AuthMode.NORMAL} label="普通登录" />
                      </Tabs>
                    )}

                    <LoginForm
                      searchParams={searchParams}
                      login={auth.login}
                      authMode={selectedMode}
                      ldapAlias={ldapAlias}
                      onForgotPasswordClick={handleForgotPasswordClick}
                    />
                    <FormSwitch
                      text="还没有账号？"
                      actionText="立即注册"
                      onClick={handleRegisterClick}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </Box>
          </Box>

          <Box className="orbit-auth-scroll-cue" aria-hidden="true" />
        </Box>

        <Box component="section" className="orbit-auth-showcase-section">
          <Box className="orbit-auth-showcase-head">
            <Typography className="orbit-auth-access-kicker">What Orbit connects</Typography>
            <Typography component="h2" className="orbit-auth-showcase-title">
              计算、实验、数据与可观测能力在这里汇合
            </Typography>
          </Box>

          <PlatformShowcase />
        </Box>
      </Box>

      <AlertDialog open={showRegisterDialog} onOpenChange={setShowRegisterDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {registerDialogType === 'ldap'
                ? `${ldapAlias || 'LDAP'} 账号登录说明`
                : '注册功能已禁用'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {registerDialogType === 'ldap'
                ? `平台已接入 ${ldapAlias || 'LDAP'} 统一身份认证。如果您拥有 ${ldapAlias || 'LDAP'} 账号，可以直接在登录页面使用该账号及密码登录，系统将自动为您创建平台账户，无需进行额外的注册操作。`
                : '当前平台已禁用普通用户自主注册功能。请联系系统管理员协助为您创建账号，或者申请打开注册功能。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setShowRegisterDialog(false)}>
              知道了
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Box>
  )
}

function HeroBackdrop() {
  return (
    <Box className="orbit-auth-hero-backdrop" aria-hidden="true">
      <Box className="orbit-auth-hero-bg-image" />
      <Box className="orbit-auth-hero-dots" />
      <svg className="orbit-auth-hero-svg" viewBox="0 0 1440 1080" fill="none">
        <defs>
          <radialGradient
            id="orbit-auth-mask-gradient"
            cx="0"
            cy="0"
            r="1"
            gradientTransform="matrix(720 0 0 380 720 530)"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="white" />
            <stop offset="1" stopColor="white" stopOpacity="0.05" />
          </radialGradient>
          <mask id="orbit-auth-mask">
            <ellipse cx="720" cy="530" rx="720" ry="380" fill="url(#orbit-auth-mask-gradient)" />
          </mask>
        </defs>
        <g mask="url(#orbit-auth-mask)">
          {Array.from({ length: 9 }).map((_, index) => (
            <circle
              key={`circle-${index}`}
              cx="720"
              cy="530"
              r={90 + index * 82}
              className="orbit-auth-hero-circle"
            />
          ))}
          {Array.from({ length: 17 }).map((_, index) => (
            <line
              key={`v-${index}`}
              x1={80 + index * 80}
              y1="0"
              x2={80 + index * 80}
              y2="1080"
              className="orbit-auth-hero-line"
            />
          ))}
          {Array.from({ length: 12 }).map((_, index) => (
            <line
              key={`h-${index}`}
              x1="0"
              y1={80 + index * 80}
              x2="1440"
              y2={80 + index * 80}
              className="orbit-auth-hero-line"
            />
          ))}
        </g>
      </svg>
    </Box>
  )
}

function HeroDynamics() {
  return (
    <Box className="orbit-auth-dynamics" aria-hidden="true">
      <Box className="orbit-auth-flow-field">
        {Array.from({ length: 5 }).map((_, index) => (
          <Box key={`flow-${index}`} className="orbit-auth-flow-line" />
        ))}
      </Box>

      <Box className="orbit-auth-orbit-field">
        <Box className="orbit-auth-orbit-ring is-outer" />
        <Box className="orbit-auth-orbit-ring is-middle" />
        <Box className="orbit-auth-orbit-ring is-inner" />
        <Box className="orbit-auth-orbit-core">
          <Database className="size-5" />
        </Box>
      </Box>
    </Box>
  )
}

function PlatformShowcase() {
  const rows = [
    [
      { icon: <CpuIcon className="size-4" />, title: 'Compute Queue', meta: 'PyTorch DDP' },
      { icon: <FlaskConicalIcon className="size-4" />, title: 'Run Timeline', meta: 'tracking' },
      { icon: <BarChart3 className="size-4" />, title: 'Metrics', meta: 'loss / accuracy' },
      { icon: <HardDriveIcon className="size-4" />, title: 'Datasets', meta: 'shared mounts' },
    ],
    [
      {
        icon: <ArchiveRestoreIcon className="size-4" />,
        title: 'Restore Points',
        meta: 'latest restore',
      },
      { icon: <BoxIcon className="size-4" />, title: 'Artifacts', meta: 'model / report' },
      { icon: <GitBranch className="size-4" />, title: 'Snapshots', meta: 'code / image' },
      { icon: <GaugeIcon className="size-4" />, title: 'Grafana', meta: 'GPU monitor' },
    ],
    [
      { icon: <Database className="size-4" />, title: 'PostgreSQL', meta: 'metadata' },
      { icon: <Network className="size-4" />, title: 'Volcano', meta: 'queue scheduling' },
      { icon: <Activity className="size-4" />, title: 'Prometheus', meta: 'observability' },
      { icon: <ShieldCheck className="size-4" />, title: 'Accounts', meta: 'quota / auth' },
    ],
  ]

  return (
    <Box className="orbit-auth-showcase" aria-hidden="true">
      {rows.map((row, rowIndex) => (
        <Box
          key={`row-${rowIndex}`}
          className={`orbit-auth-card-row ${rowIndex % 2 === 1 ? 'is-reverse' : ''}`}
        >
          <Box className="orbit-auth-card-track">
            {[...row, ...row, ...row].map((item, index) => (
              <Box key={`${item.title}-${index}`} className="orbit-auth-floating-card">
                <Box className="orbit-auth-floating-icon">{item.icon}</Box>
                <Box className="orbit-auth-floating-copy">
                  <Typography className="orbit-auth-floating-title">{item.title}</Typography>
                  <Typography className="orbit-auth-floating-meta">{item.meta}</Typography>
                </Box>
                <Box className="orbit-auth-floating-bars">
                  <Box />
                  <Box />
                  <Box />
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

function AuthCardHeader({
  description,
  helpText,
  icon,
  title,
}: {
  description: string
  helpText?: string
  icon: ReactNode
  title: string
}) {
  return (
    <Box className="orbit-auth-template-head">
      <Box className="orbit-auth-template-kicker">
        {icon}
        Workspace sign in
      </Box>

      <Box className="orbit-auth-template-title-row">
        <Typography variant="h5">{title}</Typography>

        {helpText && (
          <Tooltip title={helpText} placement="top">
            <IconButton size="small" color="default">
              <HelpCircle className="size-4" />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {description}
      </Typography>
    </Box>
  )
}

function FormSwitch({
  actionText,
  onClick,
  text,
}: {
  actionText: string
  onClick: () => void
  text: string
}) {
  return (
    <Typography variant="body2" sx={{ mt: 2.5, color: 'text.secondary', textAlign: 'center' }}>
      {text}{' '}
      <Link component="button" type="button" variant="subtitle2" onClick={onClick}>
        {actionText}
      </Link>
    </Typography>
  )
}
