import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { useSWRConfig } from 'swr'

import { useAuthContext } from '@/context/auth-provider'
import type { Service } from '@/types/billing'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

const PRESET_COLORS = [
  '#3b82f6', '#ef4444', '#eab308', '#8b5cf6',
  '#22c55e', '#6366f1', '#f97316', '#06b6d4',
  '#ec4899', '#84cc16',
]

const serviceSchema = z.object({
  name: z.string().trim().min(1, 'Назва обов\'язкова').max(100),
  unit_name: z.string().trim().min(1, 'Одиниця обов\'язкова').max(20),
  default_rate: z
    .string()
    .trim()
    .min(1, 'Тариф обов\'язковий')
    .regex(/^\d+([.,]\d{1,4})?$/, 'Невірний формат (приклад: 45.50)'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Колір повинен бути hex (#RRGGBB)'),
})

type ServiceFormValues = z.infer<typeof serviceSchema>

interface ServiceFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  service?: Service | null
}

export function ServiceFormDialog({ open, onOpenChange, service }: ServiceFormDialogProps) {
  const { apiService } = useAuthContext()
  const { mutate } = useSWRConfig()
  const isEdit = Boolean(service)

  const form = useForm<ServiceFormValues>({
    resolver: zodResolver(serviceSchema),
    defaultValues: {
      name: '', unit_name: '', default_rate: '0', color: '#3b82f6',
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        name: service?.name ?? '',
        unit_name: service?.unit_name ?? '',
        // У режимі редагування показуємо поточний тариф (з історії), не seed default_rate
        default_rate: service?.current_rate ?? '0',
        color: service?.color || '#3b82f6',
      })
    }
  }, [open, service, form])

  const onSubmit = async (values: ServiceFormValues) => {
    try {
      if (isEdit && service) {
        // Тариф у режимі редагування не змінюємо (це робиться через історію тарифів),
        // тому default_rate не відправляємо — шлемо лише name/unit/color
        await apiService.updateService(service.id, {
          name: values.name,
          unit_name: values.unit_name,
          color: values.color,
        })
        toast.success(`Послугу "${values.name}" оновлено`)
      } else {
        const payload = { ...values, default_rate: values.default_rate.replace(',', '.') }
        await apiService.createService(payload)
        toast.success(`Послугу "${values.name}" додано`)
      }
      await mutate('/services')
      onOpenChange(false)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Помилка збереження'
      toast.error(msg)
    }
  }

  const currentColor = form.watch('color')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Редагування послуги' : 'Нова послуга'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Зміни буде збережено після підтвердження.' : 'Заповніть дані про комунальну послугу.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Назва *</FormLabel>
                  <FormControl>
                    <Input placeholder="Водопостачання" autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="unit_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Одиниця *</FormLabel>
                    <FormControl>
                      <Input placeholder="м³" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="default_rate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{isEdit ? 'Поточний тариф' : 'Початковий тариф *'}</FormLabel>
                    <FormControl>
                      <Input placeholder="45.50" disabled={isEdit} {...field} />
                    </FormControl>
                    {isEdit && (
                      <FormDescription className="text-xs">
                        Змінити → кнопка «Історія тарифів»
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="color"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Колір</FormLabel>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={currentColor}
                      onChange={(e) => field.onChange(e.target.value)}
                      className="w-10 h-10 rounded border border-input cursor-pointer"
                    />
                    <FormControl>
                      <Input className="font-mono text-sm flex-1" placeholder="#3b82f6" {...field} />
                    </FormControl>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {PRESET_COLORS.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => field.onChange(c)}
                        className="w-6 h-6 rounded-md border-2 border-transparent hover:border-foreground/30 transition-colors"
                        style={{ backgroundColor: c, borderColor: c === currentColor ? 'currentColor' : undefined }}
                        title={c}
                      />
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={form.formState.isSubmitting}>
                Скасувати
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Spinner className="mr-2 h-4 w-4" />}
                {isEdit ? 'Зберегти' : 'Додати'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
