import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { FlaskConicalIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

import PageTitle from '@/components/layout/page-title'

import {
  ExperimentVisibility,
  apiExperimentCreate,
  apiExperimentList,
} from '@/services/api/experiment'

import { showErrorToast } from '@/utils/toast'

export const Route = createFileRoute('/portal/experiments/')({
  component: RouteComponent,
  loader: () => ({ crumb: '实验中心' }),
})

function RouteComponent() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<ExperimentVisibility>('private')

  const { data, isLoading } = useQuery({
    queryKey: ['experiments'],
    queryFn: () => apiExperimentList().then((res) => res.data),
  })

  const { mutate: createExperiment, isPending } = useMutation({
    mutationFn: () =>
      apiExperimentCreate({ name, description, visibility }).then((res) => res.data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['experiments'] })
      setName('')
      setDescription('')
      setOpen(false)
      toast.success('实验已创建')
    },
    onError: showErrorToast,
  })

  const experiments = data?.items ?? []

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title="实验中心" description="管理训练实验、Run、指标、产物和复现入口">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <PlusIcon className="size-4" />
              新建实验
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新建实验</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <span className="text-sm font-medium">名称</span>
                <Input value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <span className="text-sm font-medium">描述</span>
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <span className="text-sm font-medium">可见性</span>
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
              <Button disabled={isPending || name.trim() === ''} onClick={() => createExperiment()}>
                创建
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageTitle>

      {isLoading ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-sm">正在加载实验</CardContent>
        </Card>
      ) : experiments.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-sm">
            暂无实验。创建训练作业时也可以直接新建并绑定实验。
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {experiments.map((experiment) => (
            <Link
              key={experiment.ID}
              to="/portal/experiments/$id"
              params={{ id: String(experiment.ID) }}
            >
              <Card className="hover:border-primary/60 h-full transition-colors">
                <CardHeader className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <FlaskConicalIcon className="text-primary size-4" />
                      {experiment.name}
                    </CardTitle>
                    <Badge variant="secondary">
                      {experiment.visibility === 'account' ? '账户可见' : '私有'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-muted-foreground line-clamp-2 min-h-10 text-sm">
                    {experiment.description || '未填写描述'}
                  </p>
                  <div className="text-muted-foreground text-xs">
                    更新于 {new Date(experiment.UpdatedAt).toLocaleString()}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
