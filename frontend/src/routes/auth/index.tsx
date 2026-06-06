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
import { Cpu, Gauge, HelpCircle, Server, Sparkles } from 'lucide-react'
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
    'mx-auto w-full max-w-[420px] space-y-6 rounded-2xl border border-border/75 bg-card p-6 shadow-[0_0_2px_0_hsl(211_31%_9%/0.08),0_24px_48px_-24px_hsl(211_31%_9%/0.18)] sm:p-8'

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
    <div className="bg-background min-h-[100dvh] w-full lg:grid lg:grid-cols-[1.05fr_0.95fr]">
      {/* 左侧部分 */}
      <div className="bg-muted/40 text-foreground hidden lg:block">
        <div className="tech-login-visual relative h-full w-full overflow-hidden">
          {/* 顶部Logo */}
          <div
            className="absolute top-10 left-10 z-20 flex items-center text-lg font-medium"
            title="Switch signup and login"
          >
            <button
              className="flex h-12 w-full flex-row items-center justify-center rounded-xl border border-white/22 bg-white/16 px-3 text-white shadow-[0_12px_24px_-18px_hsl(211_31%_9%/0.45)] backdrop-blur-md transition-colors hover:bg-white/22"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              <OrbitIcon className="mr-1.5 h-7 w-7 text-white" />
              <OrbitText className="h-4" />
            </button>
          </div>
          {/* 底部版权信息 */}
          <div className="absolute bottom-10 left-10 z-20">
            <blockquote className="space-y-2">
              <footer className="text-xs font-semibold text-white/64">Copyright @ RAIDS Lab</footer>
            </blockquote>
          </div>
          {/* 中间文字内容 */}
          <div className="relative flex h-full items-center">
            <div className="z-10 w-full max-w-3xl px-6 py-8 text-left text-white lg:px-16 lg:py-12">
              <div className="mb-6 inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/14 px-3 py-1.5 text-xs font-bold text-white shadow-[inset_0_1px_0_hsl(0_0%_100%/0.16)] backdrop-blur-md">
                <Sparkles className="size-3.5" />
                Resource orchestration
              </div>
              <h1 className="mb-5 text-5xl leading-[1.04] font-bold tracking-tight text-white xl:text-6xl">
                异构云资源
                <br />
                混合调度系统
              </h1>
              <p className="max-w-xl text-base leading-7 text-white/72">
                管理 GPU 作业、队列配额、镜像与共享数据，用统一控制台承载科研计算工作流。
              </p>
              <div className="mt-10 w-full max-w-xl rounded-2xl border border-white/18 bg-white/14 p-4 shadow-[0_24px_48px_-24px_hsl(211_31%_9%/0.45)] backdrop-blur-md">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-white">Cluster overview</div>
                    <div className="text-xs text-white/60">Live resource snapshot</div>
                  </div>
                  <div className="text-primary rounded-full bg-white px-3 py-1 text-xs font-bold">
                    Healthy
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'GPU', value: '72%', icon: Cpu },
                    { label: 'Jobs', value: '128', icon: Gauge },
                    { label: 'Nodes', value: '24', icon: Server },
                  ].map((item) => (
                    <div key={item.label} className="text-foreground rounded-xl bg-white p-3">
                      <item.icon className="text-primary mb-3 size-5" />
                      <div className="text-xl font-bold">{item.value}</div>
                      <div className="text-muted-foreground text-xs">{item.label}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 space-y-2 rounded-xl bg-white/92 p-3">
                  {['Queue utilization', 'Storage throughput', 'Image pulls'].map(
                    (label, index) => (
                      <div key={label} className="space-y-1.5">
                        <div className="text-muted-foreground flex justify-between text-xs">
                          <span>{label}</span>
                          <span>{64 + index * 9}%</span>
                        </div>
                        <div className="bg-muted h-1.5 rounded-full">
                          <div
                            className="bg-primary h-full rounded-full"
                            style={{ width: `${64 + index * 9}%` }}
                          />
                        </div>
                      </div>
                    )
                  )}
                </div>
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
