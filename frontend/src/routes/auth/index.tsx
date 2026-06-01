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
import { createFileRoute, redirect } from '@tanstack/react-router'
import { HelpCircle, TerminalSquare } from 'lucide-react'
import { useState } from 'react'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

import DocsButton from '@/components/button/docs-button'
import OrbitIcon from '@/components/icon/orbit-icon'
import OrbitText from '@/components/icon/orbit-text'
import NotFound from '@/components/placeholder/not-found'

import { AuthMode } from '@/services/api/auth'
import { queryAuthMode } from '@/services/query/auth'

import { useTheme } from '@/utils/theme'

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
  const { theme, setTheme } = useTheme()
  const { enableLdap, ldapAlias, ldapHelp, enableNormalLogin, enableNormalRegister } =
    Route.useLoaderData()

  // Ensure selectedMode is one of enabled modes, preferring LDAP as default if enabled
  const [selectedMode, setSelectedMode] = useState<AuthMode>(() => {
    if (enableLdap) return AuthMode.LDAP
    return AuthMode.NORMAL
  })

  // Calculate if we should show mode switcher
  const showSwitcher = enableLdap && enableNormalLogin
  const loginCardClass =
    'tech-login-card border-border/75 mx-auto w-full max-w-[380px] space-y-6 rounded-md border p-6 shadow-[0_24px_80px_-48px_var(--primary-glow)] backdrop-blur-xl sm:p-7'

  // Handle mode switching
  const handleModeChange = (newMode: string) => {
    const mode = newMode as AuthMode
    setSelectedMode(mode)
    setShowSignup(false)
    setShowForgotPassword(false)
  }

  // Handle registration button click
  const handleRegisterClick = () => {
    if (selectedMode === AuthMode.LDAP) {
      setRegisterDialogType('ldap')
      setShowRegisterDialog(true)
    } else {
      if (enableNormalRegister) {
        setShowSignup(true)
        setShowForgotPassword(false)
      } else {
        setRegisterDialogType('normal_disabled')
        setShowRegisterDialog(true)
      }
    }
  }

  // Handle forgot password button click
  const handleForgotPasswordClick = () => {
    if (selectedMode === AuthMode.LDAP) {
      toast.info('请联系平台管理员协助重置密码')
    } else {
      setShowForgotPassword(true)
      setShowSignup(false)
    }
  }

  // 返回登录表单
  const handleBackToLogin = () => {
    setShowSignup(false)
    setShowForgotPassword(false)
  }

  return (
    <div className="bg-background min-h-[100dvh] w-full lg:grid lg:grid-cols-[1.08fr_0.92fr]">
      {/* 左侧部分 */}
      <div className="bg-sidebar text-sidebar-foreground hidden lg:block">
        <div className="tech-login-visual relative h-full w-full overflow-hidden">
          <div className="from-sidebar-primary/70 via-sidebar-primary/18 absolute top-0 right-0 h-px w-3/4 bg-gradient-to-l to-transparent" />
          <div className="orbit-halo orbit-halo-slow border-sidebar-primary/20 absolute top-1/2 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full border shadow-[0_0_100px_-64px_var(--sidebar-primary)]" />
          <div className="orbit-halo orbit-halo-fast border-sidebar-primary/12 absolute top-1/2 left-1/2 h-[18rem] w-[18rem] -translate-x-1/2 -translate-y-1/2 rounded-full border" />
          <div className="orbit-core-pulse bg-sidebar-primary/70 absolute top-1/2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_38px_10px_var(--sidebar-primary)]" />
          <div className="orbit-signal orbit-signal-a" aria-hidden="true" />
          <div className="orbit-signal orbit-signal-b" aria-hidden="true" />
          <div className="orbit-signal orbit-signal-c" aria-hidden="true" />
          <div className="orbit-data-rain" aria-hidden="true">
            {Array.from({ length: 8 }).map((_, index) => (
              <span
                key={index}
                style={{
                  animationDelay: `${index * -0.32}s`,
                  height: `${36 + (index % 4) * 12}%`,
                }}
              />
            ))}
          </div>
          {/* 顶部Logo */}
          <div
            className="absolute top-10 left-10 z-20 flex items-center text-lg font-medium"
            title="Switch signup and login"
          >
            <button
              className="border-sidebar-primary/16 hover:border-sidebar-primary/35 flex h-12 w-full flex-row items-center justify-center rounded-md border bg-white/[0.025] px-3 text-white/92 transition-colors hover:bg-white/[0.045]"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              <OrbitIcon className="text-sidebar-primary mr-1.5 h-7 w-7" />
              <OrbitText className="h-4" />
            </button>
          </div>
          {/* 底部版权信息 */}
          <div className="absolute bottom-10 left-10 z-20">
            <blockquote className="space-y-2">
              <footer className="font-mono text-[11px] tracking-[0.16em] text-white/38 uppercase">
                Copyright @ RAIDS Lab
              </footer>
            </blockquote>
          </div>
          {/* 中间文字内容 */}
          <div className="relative flex h-full items-center">
            <div className="z-10 max-w-3xl px-6 py-8 text-left text-white lg:px-16 lg:py-12">
              <div className="border-sidebar-primary/22 text-sidebar-primary mb-6 inline-flex items-center gap-2 rounded-md border bg-white/[0.025] px-3 py-1.5 font-mono text-[11px] tracking-[0.18em] uppercase shadow-[inset_0_1px_0_hsla(0,0%,100%,0.06)]">
                <TerminalSquare className="size-3.5" />
                Orchestration Fabric
              </div>
              <h1 className="mb-7 text-5xl leading-[1.04] font-semibold tracking-tight text-white xl:text-6xl">
                <span className="text-sidebar-primary">Orbit</span>
                <br />
                异构云资源
                <br />
                混合调度系统
              </h1>
              <DocsButton
                variant="ghost"
                className="border-sidebar-primary/35 bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90 hover:text-sidebar-primary-foreground shadow-[0_0_0_1px_var(--primary-glow-soft),0_18px_38px_-24px_var(--sidebar-primary)]"
                title="平台文档"
                url=""
              />
              <div className="mt-10 grid max-w-xl grid-cols-3 gap-3">
                {['GPU', 'QUEUE', 'OPS'].map((label, index) => (
                  <div
                    key={label}
                    className="border-sidebar-primary/14 bg-white/[0.025] px-3 py-2 shadow-[inset_0_1px_0_hsla(0,0%,100%,0.05)] [clip-path:polygon(0_8px,8px_0,100%_0,100%_100%,0_100%)]"
                  >
                    <div className="font-mono text-[10px] tracking-[0.18em] text-white/42 uppercase">
                      {label}
                    </div>
                    <div
                      className="orbit-meter bg-sidebar-primary/75 mt-1 h-1 shadow-[0_0_18px_-6px_var(--sidebar-primary)]"
                      style={{ width: `${72 - index * 11}%` }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* 右侧表单部分 */}
      <div className="app-shell-surface flex items-center justify-center px-4 py-12">
        {showSignup && selectedMode === AuthMode.NORMAL ? (
          <div className={loginCardClass}>
            <div className="space-y-2 text-center">
              <h1 className="text-3xl font-semibold tracking-tight">用户注册</h1>
              <p className="text-muted-foreground text-sm">注册您在 Orbit 平台的账号</p>
            </div>
            <SignupForm />
            <div className="text-muted-foreground text-center text-sm">
              已有账号？
              <button
                onClick={handleBackToLogin}
                className="text-primary underline-offset-4 hover:underline"
              >
                立即登录
              </button>
            </div>
          </div>
        ) : showForgotPassword && selectedMode === AuthMode.NORMAL ? (
          <div className={loginCardClass}>
            <div className="space-y-2 text-center">
              <h1 className="text-3xl font-semibold tracking-tight">重置密码</h1>
              <p className="text-muted-foreground text-sm">我们将向您的邮箱发送密码重置链接</p>
            </div>
            <ForgotPasswordForm />
            <div className="text-muted-foreground text-center text-sm">
              想起密码了？
              <button
                onClick={handleBackToLogin}
                className="text-primary underline-offset-4 hover:underline"
              >
                返回登录
              </button>
            </div>
          </div>
        ) : (
          <div className={loginCardClass}>
            <div className="space-y-2 text-center">
              <h1 className="text-3xl font-semibold tracking-tight">用户登录</h1>
              <p className="text-muted-foreground flex items-center justify-center gap-1.5 text-sm">
                {selectedMode === AuthMode.LDAP ? (
                  <>
                    已接入 {ldapAlias || 'LDAP'} 统一身份认证
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="text-muted-foreground/60 h-3.5 w-3.5 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="top" align="center" className="max-w-64">
                          <p>{ldapHelp || '通过管理员配置的 LDAP 服务器进行身份认证'}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </>
                ) : (
                  '请输入您的账号和密码'
                )}
              </p>
            </div>

            {showSwitcher && (
              <Tabs value={selectedMode} onValueChange={handleModeChange} className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value={AuthMode.LDAP} className="flex items-center gap-1.5">
                    {ldapAlias || 'LDAP'} 登录
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex shrink-0 cursor-help">
                          <HelpCircle className="text-muted-foreground/60 h-3.5 w-3.5" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" align="center" className="max-w-64">
                        <p>{ldapHelp || '通过管理员配置的 LDAP 服务器进行身份认证'}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TabsTrigger>
                  <TabsTrigger value={AuthMode.NORMAL}>普通登录</TabsTrigger>
                </TabsList>
              </Tabs>
            )}

            <LoginForm
              searchParams={searchParams}
              login={auth.login}
              authMode={selectedMode}
              ldapAlias={ldapAlias}
              onForgotPasswordClick={handleForgotPasswordClick}
            />
            <div className="text-muted-foreground text-center text-sm">
              还没有账号？
              <button
                onClick={handleRegisterClick}
                className="text-primary underline-offset-4 hover:underline"
              >
                立即注册
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Registration guide dialog */}
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
    </div>
  )
}
