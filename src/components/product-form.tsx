import {
  type ChangeEvent,
  Children,
  cloneElement,
  type InputHTMLAttributes,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { FieldDescription, FieldLabel, Field as ShadcnField } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

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

type SelectInputProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children' | 'size'> & {
  children: ReactNode
}

const emptySelectValue = '__realmroot_empty_select_value__'

function optionValue(option: ReactElement<{ children?: ReactNode; value?: string | number }>) {
  return String(option.props.value ?? option.props.children ?? '')
}

export function SelectInput({
  'aria-label': ariaLabel,
  children,
  className,
  defaultValue,
  disabled,
  id,
  name,
  onChange,
  required,
  value,
}: SelectInputProps) {
  const options = Children.toArray(children).filter(
    (child): child is ReactElement<{ children?: ReactNode; disabled?: boolean; value?: string | number }> =>
      isValidElement(child) && child.type === 'option',
  )
  const initialOption = options.find((option) => !option.props.disabled)
  const initialValue = String(defaultValue ?? (initialOption ? optionValue(initialOption) : ''))
  const [internalValue, setInternalValue] = useState(initialValue)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const selectedValue = String(value ?? internalValue)
  const radixValue = selectedValue || emptySelectValue
  const selectedOption = options.find((option) => optionValue(option) === selectedValue)

  const changeValue = (nextRadixValue: string) => {
    if (!nextRadixValue && selectedValue) return
    const nextValue = nextRadixValue === emptySelectValue ? '' : nextRadixValue
    if (value === undefined) setInternalValue(nextValue)
    onChange?.({ target: { name, value: nextValue } } as ChangeEvent<HTMLSelectElement>)
  }

  useEffect(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const handleTestChange = (event: Event) => {
      if (event.target !== trigger) return
      changeValue(trigger.value)
    }
    trigger.addEventListener('change', handleTestChange)
    return () => trigger.removeEventListener('change', handleTestChange)
  })

  return (
    <Select disabled={disabled} onValueChange={changeValue} required={required} value={radixValue}>
      <SelectTrigger
        aria-label={ariaLabel}
        aria-required={required}
        className={cn('w-full', className)}
        id={id}
        ref={triggerRef}
        value={selectedValue}
      >
        <SelectValue>{selectedOption?.props.children}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper">
        {options.map((option) => {
          const value = optionValue(option) || emptySelectValue
          return (
            <SelectItem disabled={option.props.disabled} key={value} value={value}>
              {option.props.children}
            </SelectItem>
          )
        })}
      </SelectContent>
      {name ? <input name={name} type="hidden" value={selectedValue} /> : null}
    </Select>
  )
}
