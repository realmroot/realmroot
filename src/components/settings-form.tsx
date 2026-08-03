import { Children, cloneElement, type FormEvent, isValidElement, type ReactElement, type ReactNode, useId } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from '@/components/ui/field'
import { tt } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export function SettingsForm({
  children,
  className,
  dirty,
  error,
  id,
  onDiscard,
  onSubmit,
  pending,
  status = 'Changes on this tab save together.',
}: {
  children: ReactNode
  className?: string
  dirty: boolean
  error?: string | null
  id?: string
  onDiscard?: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  pending?: boolean
  status?: string
}) {
  return (
    <form className={cn('min-w-0', className)} id={id} onSubmit={onSubmit}>
      {children}
      <footer className="mt-5 flex items-center justify-between gap-5 pt-4">
        <span aria-live="polite" className={cn('text-xs text-muted-foreground', error && 'text-destructive')}>
          {error ?? tt(dirty ? status : 'All changes saved.')}
        </span>
        <div className="flex items-center gap-2">
          {onDiscard ? (
            <Button disabled={pending || !dirty} onClick={onDiscard} type="button" variant="outline">
              {tt('Discard')}
            </Button>
          ) : null}
          <Button disabled={pending || !dirty} type="submit">
            {pending ? tt('Saving…') : tt('Save changes')}
          </Button>
        </div>
      </footer>
    </form>
  )
}

export function hasSettingsChanges(current: unknown, saved: unknown) {
  return JSON.stringify(current) !== JSON.stringify(saved)
}

export function SettingsFormSection({
  children,
  className,
  description,
  title,
}: {
  children: ReactNode
  className?: string
  description?: string
  title?: string
}) {
  return (
    <section className={cn('[&+&]:mt-7', className)}>
      {title || description ? (
        <header className="mb-3">
          {title ? <h2 className="m-0 text-[15px] font-medium tracking-[-0.015em]">{tt(title)}</h2> : null}
          {description ? (
            <p className="mt-1.5 max-w-[680px] text-xs leading-relaxed text-muted-foreground">{tt(description)}</p>
          ) : null}
        </header>
      ) : null}
      <FieldGroup className="gap-0 border-t border-border">{children}</FieldGroup>
    </section>
  )
}

export function SettingsFormField({
  children,
  description,
  label,
}: {
  children: ReactNode
  description?: string
  label: string
}) {
  const generatedId = useId()
  const child = Children.only(children)
  const control = isValidElement<{ id?: string }>(child)
    ? cloneElement(child as ReactElement<{ id?: string }>, { id: child.props.id ?? generatedId })
    : child
  const controlId = isValidElement<{ id?: string }>(control) ? control.props.id : generatedId

  return (
    <Field className="settingsFormField min-h-[70px] gap-4 border-b border-border py-3.5 md:grid md:grid-cols-[minmax(220px,0.85fr)_minmax(280px,1.4fr)] md:items-center md:gap-8">
      <FieldContent className="gap-1">
        <FieldLabel htmlFor={controlId}>{tt(label)}</FieldLabel>
        {description ? <FieldDescription>{tt(description)}</FieldDescription> : null}
      </FieldContent>
      <div className="flex min-w-0 w-full items-center justify-end justify-self-end md:max-w-[520px]">{control}</div>
    </Field>
  )
}

export function SettingsSwitchField({
  control,
  description,
  label,
}: {
  control: ReactNode
  description?: string
  label: string
}) {
  return (
    <Field className="settingsFormField min-h-[70px] gap-4 border-b border-border py-3.5 md:grid md:grid-cols-[minmax(220px,0.85fr)_minmax(280px,1.4fr)] md:items-center md:gap-8">
      <FieldContent className="gap-1">
        <FieldTitle>{tt(label)}</FieldTitle>
        {description ? <FieldDescription>{tt(description)}</FieldDescription> : null}
      </FieldContent>
      <div className="flex min-w-0 items-center justify-end justify-self-end px-3">{control}</div>
    </Field>
  )
}

export function SettingsValueField({
  description,
  label,
  value,
}: {
  description?: string
  label: string
  value: ReactNode
}) {
  return (
    <Field className="settingsFormField min-h-[70px] gap-4 border-b border-border py-3.5 md:grid md:grid-cols-[minmax(220px,0.85fr)_minmax(280px,1.4fr)] md:items-center md:gap-8">
      <FieldContent className="gap-1">
        <FieldTitle>{tt(label)}</FieldTitle>
        {description ? <FieldDescription>{tt(description)}</FieldDescription> : null}
      </FieldContent>
      <div className="min-w-0 justify-self-end text-sm md:max-w-[520px]">{value}</div>
    </Field>
  )
}
