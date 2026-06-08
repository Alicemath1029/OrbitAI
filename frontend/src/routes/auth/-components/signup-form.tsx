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
import { zodResolver } from '@hookform/resolvers/zod'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { HTTPError } from 'ky'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { Form } from '@/components/ui/form'

import { apiSignup } from '@/services/api/auth'

const formSchema = z
  .object({
    username: z
      .string()
      .min(1, {
        message: 'Username can not be empty.',
      })
      .max(20, {
        message: 'Username must be at most 20 characters.',
      }),
    password: z
      .string()
      .min(1, {
        message: 'Password can not be empty.',
      })
      .max(20, {
        message: 'Password must be at most 20 characters.',
      }),
    passwordConfirm: z.string(),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: "Passwords don't match",
    path: ['passwordConfirm'],
  })

export function SignupForm() {
  const navigate = useNavigate()
  const { mutate: loginUser, isPending } = useMutation({
    mutationFn: (values: z.infer<typeof formSchema>) =>
      apiSignup({
        userName: values.username,
        password: values.password,
      }),
    onSuccess: () => {
      toast.success('注册成功')
      navigate({ to: '/auth', search: { redirect: '/', token: '' } })
    },
    onError: (error) => {
      if (error instanceof HTTPError) {
        // Handled by global apiRequest interceptor
      }
    },
  })

  // 1. Define your form.
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: '',
      password: '',
      passwordConfirm: '',
    },
  })

  // 2. Define a submit handler.
  const onSubmit = (values: z.infer<typeof formSchema>) => {
    // Do something with the form values.
    // ✅ This will be type-safe and validated.
    if (isPending) {
      return
    }
    loginUser(values)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="orbit-auth-template-form">
        <Controller
          control={form.control}
          name="username"
          render={({ field, fieldState }) => (
            <TextField
              {...field}
              fullWidth
              label="账号"
              autoComplete="off"
              placeholder="设置平台账号"
              error={!!fieldState.error}
              helperText={fieldState.error?.message}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          )}
        />
        <Controller
          control={form.control}
          name="password"
          render={({ field, fieldState }) => (
            <TextField
              {...field}
              fullWidth
              label="密码"
              type="password"
              autoComplete="off"
              placeholder="设置登录密码"
              error={!!fieldState.error}
              helperText={fieldState.error?.message}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          )}
        />
        <Controller
          control={form.control}
          name="passwordConfirm"
          render={({ field, fieldState }) => (
            <TextField
              {...field}
              fullWidth
              label="确认密码"
              type="password"
              autoComplete="off"
              placeholder="再次输入密码"
              error={!!fieldState.error}
              helperText={fieldState.error?.message}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          )}
        />
        <Button
          fullWidth
          size="large"
          type="submit"
          color="inherit"
          variant="contained"
          disabled={isPending}
        >
          {isPending ? '注册中...' : '注册'}
        </Button>
      </form>
    </Form>
  )
}
