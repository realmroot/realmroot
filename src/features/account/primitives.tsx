import { type ReactNode, useState } from 'react'
import { DestructiveConfirmation as DestructiveConfirmationSurface } from '@/components/destructive-confirmation'
import { tt } from '@/lib/i18n'
import type { DestructiveConfirmation, ListItem } from './types'

export function PanelTitle({
  action,
  title,
  description,
  icon,
}: {
  action?: ReactNode
  title: string
  description: string
  icon: ReactNode
}) {
  return (
    <div className="panelTitle">
      <div className="panelTitleMain">
        <div className="panelTitleIcon" aria-hidden="true">
          {icon}
        </div>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {action}
    </div>
  )
}

export function StatusPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="statusPill">
      <span>{value}</span>
      <strong>{label}</strong>
    </div>
  )
}

export function SettingsAction({
  action,
  icon,
  meta,
  status,
  title,
  value,
}: {
  action?: ReactNode
  icon: ReactNode
  meta: string
  status?: string
  title: string
  value?: string
}) {
  return (
    <article className="accountRow settingsAction">
      <div className="accountRowLabel">
        <span className="sr-only" aria-hidden="true">
          {icon}
        </span>
        <strong>{title}</strong>
        <span>{meta}</span>
      </div>
      <div className="accountRowValue">
        {value ? <span className="block font-medium text-foreground">{value}</span> : null}
        {status ? <span>{status}</span> : null}
      </div>
      <div className="accountRowAction">{action}</div>
    </article>
  )
}

export function SubsectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="subsectionTitle">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  )
}

export function ItemList({
  empty,
  emptyDescription = tt('Nothing needs attention here.'),
  items,
}: {
  empty: string
  emptyDescription?: string
  items: ListItem[]
}) {
  return (
    <div className="accountRows itemList">
      {items.length === 0 ? (
        <article className="accountRow itemRow itemRowEmpty">
          <div className="accountRowLabel">
            <strong>{empty}</strong>
            <span>{emptyDescription}</span>
          </div>
        </article>
      ) : (
        items.map((item) => (
          <article className="accountRow itemRow" key={item.id}>
            <div className="accountRowLabel">
              <strong>{item.title}</strong>
              <span>{item.meta}</span>
              {item.children}
            </div>
            <div className="accountRowValue">{item.status}</div>
            <div className="accountRowAction">{item.action}</div>
          </article>
        ))
      )}
    </div>
  )
}

export function DestructiveConfirmationDialog({
  confirmation,
  onClose,
}: {
  confirmation: DestructiveConfirmation | null
  onClose: () => void
}) {
  if (!confirmation) return null
  return (
    <DestructiveConfirmationSurface
      confirmLabel={confirmation.actionLabel}
      description={confirmation.description}
      onClose={onClose}
      onConfirm={() => {
        const confirmed = confirmation
        onClose()
        void confirmed.onConfirm()
      }}
      open
      title={confirmation.title}
    />
  )
}

export function useDestructiveConfirmation() {
  return useState<DestructiveConfirmation | null>(null)
}

export function UnavailableSection({ message }: { message: string }) {
  return (
    <section className="settingsPanel">
      <article className="itemRow itemRowEmpty">
        <div>
          <h3>{message}</h3>
          <p>{tt('Nothing needs attention here.')}</p>
        </div>
      </article>
    </section>
  )
}
