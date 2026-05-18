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

type FieldProps = {
  label: string
  children: ReactNode
  help?: string
}

export function Field({ label, children, help }: FieldProps) {
  const generatedId = useId()
  const child = Children.only(children)
  const control = isValidElement<{ id?: string }>(child)
    ? cloneElement(child as ReactElement<{ id?: string }>, { id: child.props.id ?? generatedId })
    : child
  const controlId = isValidElement<{ id?: string }>(control) ? control.props.id : generatedId

  return (
    <div className="field">
      <label htmlFor={controlId}>{label}</label>
      {control}
      {help ? <small>{help}</small> : null}
    </div>
  )
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="textInput" {...props} />
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="textInput textArea" {...props} />
}

export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="textInput" {...props} />
}
