import {
  Children,
  cloneElement,
  type InputHTMLAttributes,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from 'react'
import { FieldDescription, FieldLabel, Field as ShadcnField } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'

type ProductFieldProps = {
  children: ReactNode
  help?: string
  label: string
}

export function Field({ children, help, label }: ProductFieldProps) {
  const generatedId = useId()
  const child = Children.only(children)
  const control = isValidElement<{ id?: string }>(child)
    ? cloneElement(child as ReactElement<{ id?: string }>, { id: child.props.id ?? generatedId })
    : child
  const controlId = isValidElement<{ id?: string }>(control) ? control.props.id : generatedId

  return (
    <ShadcnField className="field">
      <FieldLabel htmlFor={controlId}>{label}</FieldLabel>
      {control}
      {help ? <FieldDescription>{help}</FieldDescription> : null}
    </ShadcnField>
  )
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <Input {...props} />
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <Textarea {...props} />
}

export function SelectInput(props: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'>) {
  return <NativeSelect {...props} />
}
