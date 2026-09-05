import { type SiteNavigation, siteNavigationSchema } from '@shared/api/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SettingsSection } from '@/features/management/previews'
import { accountQueryKeys } from '@/lib/account-query'
import { getSiteNavigation, replaceSiteNavigation } from '@/lib/api/management'
import { tt } from '@/lib/i18n'

type ServiceLink = SiteNavigation['externalLinks'][number]
const queryKey = ['console', 'site-navigation'] as const

export function SiteNavigationSettings() {
  const query = useQuery({ queryKey, queryFn: getSiteNavigation })
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<ServiceLink | null>(null)
  const [validationError, setValidationError] = useState('')
  const mutation = useMutation({
    mutationFn: replaceSiteNavigation,
    onSuccess: async (data) => {
      queryClient.setQueryData(queryKey, data)
      setDraft(null)
      await queryClient.invalidateQueries({ queryKey: accountQueryKeys.configz })
    },
  })
  const links = query.data?.externalLinks ?? []
  function save(externalLinks: ServiceLink[]) {
    const parsed = siteNavigationSchema.safeParse({ externalLinks })
    if (!parsed.success) {
      setValidationError(parsed.error.issues.map((issue) => tt(issue.message)).join(' '))
      return
    }
    if (!query.data) return
    setValidationError('')
    mutation.mutate({ input: parsed.data, etag: query.data.etag })
  }
  function edit(link: ServiceLink) {
    mutation.reset()
    setValidationError('')
    setDraft({ ...link })
  }
  function move(index: number, offset: number) {
    const next = [...links]
    const [link] = next.splice(index, 1)
    next.splice(index + offset, 0, link)
    save(next)
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!draft) return
    save(
      links.some((link) => link.id === draft.id)
        ? links.map((link) => (link.id === draft.id ? draft : link))
        : [...links, draft],
    )
  }
  const error = validationError || mutation.error?.message || query.error?.message
  return (
    <SettingsSection
      title={tt('External services')}
      description={tt('Configure optional links shown in Account Center. Links open the destination directly.')}
    >
      {query.isPending ? <p role="status">{tt('Loading')}</p> : null}
      {error && !draft ? (
        <div role="alert" className="text-sm text-destructive">
          {tt(error)}{' '}
          <Button variant="link" onClick={() => void query.refetch()}>
            {tt('Reload')}
          </Button>
        </div>
      ) : null}
      {query.data ? (
        <>
          {links.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tt('No external services configured.')}</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {links.map((link, index) => (
                <li className="flex flex-wrap items-center gap-2 p-3" key={link.id}>
                  <div className="min-w-0 flex-1">
                    <strong className="text-sm">{link.label}</strong>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 break-all text-xs text-muted-foreground"
                    >
                      {link.url}
                      <ExternalLink aria-hidden="true" className="size-3 shrink-0" />
                    </a>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`${tt('Move up')}: ${link.label}`}
                      disabled={mutation.isPending || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`${tt('Move down')}: ${link.label}`}
                      disabled={mutation.isPending || index === links.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`${tt('Edit')}: ${link.label}`}
                      disabled={mutation.isPending}
                      onClick={() => edit(link)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`${tt('Delete')}: ${link.label}`}
                      disabled={mutation.isPending}
                      onClick={() => save(links.filter((item) => item.id !== link.id))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Button
            className="mt-3"
            type="button"
            variant="secondary"
            disabled={mutation.isPending || links.length >= 20}
            onClick={() => edit({ id: crypto.randomUUID(), label: '', url: '', icon: 'link' })}
          >
            <Plus />
            {tt('Add service')}
          </Button>
        </>
      ) : null}
      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setDraft(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tt('External service')}</DialogTitle>
            <DialogDescription>{tt('Choose a name, HTTPS destination and icon.')}</DialogDescription>
          </DialogHeader>
          {draft ? (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="service-name">{tt('Name')}</Label>
                <Input
                  id="service-name"
                  value={draft.label}
                  maxLength={80}
                  required
                  onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="service-url">{tt('URL')}</Label>
                <Input
                  id="service-url"
                  type="url"
                  value={draft.url}
                  maxLength={2048}
                  required
                  placeholder="https://"
                  onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="service-icon">{tt('Icon')}</Label>
                <select
                  id="service-icon"
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={draft.icon}
                  onChange={(event) => setDraft({ ...draft, icon: event.target.value as ServiceLink['icon'] })}
                >
                  <option value="link">{tt('Link')}</option>
                  <option value="wallet">{tt('Wallet')}</option>
                  <option value="app">{tt('Application')}</option>
                  <option value="book">{tt('Documentation')}</option>
                  <option value="folder">{tt('Folder')}</option>
                </select>
              </div>
              {error ? (
                <div role="alert" className="text-sm text-destructive">
                  {tt(error)}
                </div>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={() => setDraft(null)}>
                  {tt('Cancel')}
                </Button>
                <Button type="submit" disabled={mutation.isPending}>
                  {tt(mutation.isPending ? 'Saving' : 'Save')}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </SettingsSection>
  )
}
