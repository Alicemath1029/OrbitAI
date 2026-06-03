import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FlaskConicalIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { FieldPath, FieldValues, UseFormReturn } from 'react-hook-form'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import {
  ExperimentVisibility,
  apiExperimentCreate,
  apiExperimentList,
} from '@/services/api/experiment'

import { cn } from '@/lib/utils'

import AccordionCard from './accordion-card'

interface ExperimentFormCardProps<T extends FieldValues> {
  form: UseFormReturn<T>
  basePath?: string
  open: boolean
  setOpen: (open: boolean) => void
}

const path = <T extends FieldValues>(basePath: string, key: string) =>
  `${basePath}.${key}` as FieldPath<T>

export function ExperimentFormCard<T extends FieldValues>({
  form,
  basePath = 'experiment',
  open,
  setOpen,
}: ExperimentFormCardProps<T>) {
  const enabled = form.watch(path<T>(basePath, 'enabled'))
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [visibility, setVisibility] = useState<ExperimentVisibility>('private')

  const { data, isLoading } = useQuery({
    queryKey: ['experiments'],
    queryFn: () => apiExperimentList().then((res) => res.data),
  })
  const experiments = data?.items ?? []

  const { mutate: createExperiment, isPending } = useMutation({
    mutationFn: () =>
      apiExperimentCreate({
        name: newName,
        description: newDescription,
        visibility,
      }).then((res) => res.data),
    onSuccess: async (experiment) => {
      await queryClient.invalidateQueries({ queryKey: ['experiments'] })
      form.setValue(path<T>(basePath, 'enabled'), true as never, { shouldDirty: true })
      form.setValue(path<T>(basePath, 'experimentId'), experiment.ID as never, {
        shouldDirty: true,
      })
      setNewName('')
      setNewDescription('')
      setDialogOpen(false)
      toast.success('实验已创建')
    },
  })

  return (
    <AccordionCard cardTitle="实验信息" icon={FlaskConicalIcon} open={open} setOpen={setOpen}>
      <div className="mt-3 space-y-4">
        <FormField
          control={form.control}
          name={path<T>(basePath, 'enabled')}
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between space-y-0">
              <div>
                <FormLabel className="font-normal">加入实验中心</FormLabel>
                <FormDescription>创建 Run 并注入 SDK 上报环境变量</FormDescription>
              </div>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />
        <div className={cn('space-y-4', !enabled && 'hidden')}>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <FormField
              control={form.control}
              name={path<T>(basePath, 'experimentId')}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>实验</FormLabel>
                  <Select
                    value={field.value ? String(field.value) : ''}
                    onValueChange={(value) => field.onChange(Number(value))}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={isLoading ? '加载中' : '选择实验'} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {experiments.map((experiment) => (
                        <SelectItem key={experiment.ID} value={String(experiment.ID)}>
                          {experiment.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button type="button" variant="outline" className="mt-8">
                  <PlusIcon className="size-4" />
                  新建
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>新建实验</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <FormLabel>名称</FormLabel>
                    <Input value={newName} onChange={(event) => setNewName(event.target.value)} />
                  </div>
                  <div className="grid gap-2">
                    <FormLabel>描述</FormLabel>
                    <Textarea
                      value={newDescription}
                      onChange={(event) => setNewDescription(event.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <FormLabel>可见性</FormLabel>
                    <Select
                      value={visibility}
                      onValueChange={(value) => setVisibility(value as ExperimentVisibility)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="private">仅自己</SelectItem>
                        <SelectItem value="account">当前账户</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    disabled={isPending || newName.trim() === ''}
                    onClick={() => createExperiment()}
                  >
                    创建
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <FormField
            control={form.control}
            name={path<T>(basePath, 'runName')}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Run 名称</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="lr-1e-4-bs-32" />
                </FormControl>
                <FormDescription>留空时使用作业名</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name={path<T>(basePath, 'hyperparamsText')}
            render={({ field }) => (
              <FormItem>
                <FormLabel>超参数 JSON</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    className="h-24 font-mono"
                    placeholder={'{"lr": 0.0001, "batch_size": 32}'}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField
              control={form.control}
              name={path<T>(basePath, 'codeRepo')}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>代码仓库</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={path<T>(basePath, 'codeBranch')}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>分支</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={path<T>(basePath, 'codeCommit')}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Commit</FormLabel>
                  <FormControl>
                    <Input {...field} className="font-mono" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name={path<T>(basePath, 'dataText')}
            render={({ field }) => (
              <FormItem>
                <FormLabel>数据快照 JSON</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    className="h-20 font-mono"
                    placeholder={
                      '{"name": "dataset-v1", "path": "/workspace/data", "digest": "sha256:..."}'
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name={path<T>(basePath, 'tagsText')}
            render={({ field }) => (
              <FormItem>
                <FormLabel>标签 JSON</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    className="h-20 font-mono"
                    placeholder={'{"stage": "baseline", "task": "sft"}'}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>
    </AccordionCard>
  )
}
