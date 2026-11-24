import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { useSWRConfig } from 'swr'

import { useAuthContext } from '@/context/auth-provider'
import type { Tenant } from '@/types/billing'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

const tenantSchema = z.object({
  name: z.string().trim().min(1, 'Назва обов\'язкова').max(200),
  tax_id: z.string().trim().max(20).optional().or(z.literal('')),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  email: z.string().trim().email('Невірний email').optional().or(z.literal('')),
  contact_person: z.string().trim().max(100).optional().or(z.literal('')),
})

type TenantFormValues = z.infer<typeof tenantSchema>

interface TenantFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenant?: Tenant | null  // null/undefined = create mode
}

export function TenantFormDialog({ open, onOpenChange, tenant }: TenantFormDialogProps) {
  const { apiService } = useAuthContext()
  const { mutate } = useSWRConfig()
  const isEdit = Boolean(tenant)

  const form = useForm<TenantFormValues>({
    resolver: zodResolver(tenantSchema),
    defaultValues: {
      name: '', tax_id: '', phone: '', email: '', contact_person: '',
    },
  })

  // Reset form when dialog opens with new data
  useEffect(() => {
    if (open) {
      form.reset({
        name: tenant?.name ?? '',
        tax_id: tenant?.tax_id ?? '',
        phone: tenant?.phone ?? '',
        email: tenant?.email ?? '',
        contact_person: tenant?.contact_person ?? '',
      })
    }
  }, [open, tenant, form])

  const onSubmit = async (values: TenantFormValues) => {
    try {
      if (isEdit && tenant) {
        await apiService.updateTenant(tenant.id, values)
        toast.success(`Орендаря "${values.name}" оновлено`)
      } else {
        await apiService.createTenant(values)
        toast.success(`Орендаря "${values.name}" додано`)
      }
      await mutate('/tenants')
      onOpenChange(false)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Помилка збереження'
      toast.error(msg)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Редагування орендаря' : 'Новий орендар'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Зміни буде збережено після підтвердження.' : 'Заповніть основні дані орендаря.'}
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
                    <Input placeholder='ТОВ "Прикладна назва"' autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="tax_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ЄДРПОУ / ІПН</FormLabel>
                  <FormControl>
                    <Input placeholder="12345678" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="contact_person"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Контактна особа</FormLabel>
                  <FormControl>
                    <Input placeholder="Іваненко І.І." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Телефон</FormLabel>
                    <FormControl>
                      <Input placeholder="+380..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="contact@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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
