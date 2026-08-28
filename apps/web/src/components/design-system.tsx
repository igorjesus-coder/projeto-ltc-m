import {
  createContext,
  forwardRef,
  useContext,
  type AnchorHTMLAttributes,
  type AriaAttributes,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

export const P022_DESIGN_SYSTEM_CONTRACT = 'ltcm.p022.layout-design-system.v1' as const;

function joinClassNames(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(' ') || undefined;
}

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, type = 'button', variant = 'secondary', ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      className={joinClassNames('button', `button-${variant}`, className)}
      type={type}
    />
  );
});

export interface ActionLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly variant?: 'primary' | 'subtle';
}

export const ActionLink = forwardRef<HTMLAnchorElement, ActionLinkProps>(function ActionLink(
  { className, variant = 'subtle', ...props },
  ref,
) {
  return (
    <a
      {...props}
      ref={ref}
      className={joinClassNames('action-link', `action-link-${variant}`, className)}
    />
  );
});

export const Link = ActionLink;

interface FieldContextValue {
  readonly id: string;
  readonly required: boolean;
  readonly helpId?: string;
  readonly errorId?: string;
  readonly error?: string;
}

const FieldContext = createContext<FieldContextValue | null>(null);

function useFieldControlProps<
  T extends {
    readonly id?: string | undefined;
    readonly required?: boolean | undefined;
    readonly 'aria-describedby'?: string | undefined;
    readonly 'aria-invalid'?: AriaAttributes['aria-invalid'];
  },
>(props: T) {
  const field = useContext(FieldContext);
  const id = props.id ?? field?.id;
  const describedBy = [field?.helpId, field?.errorId, props['aria-describedby']]
    .filter((value): value is string => Boolean(value))
    .join(' ');
  const invalid = props['aria-invalid'] ?? Boolean(field?.error);

  return {
    ...props,
    ...(id ? { id } : {}),
    ...(field && props.required === undefined ? { required: field.required } : {}),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(invalid ? { 'aria-invalid': true } : {}),
  };
}

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  readonly required?: boolean;
}

export function Label({ children, className, required = false, ...props }: LabelProps) {
  return (
    <label {...props} className={joinClassNames('field-label', className)}>
      {children}
      {required ? <span aria-hidden="true"> *</span> : null}
    </label>
  );
}

export interface FieldHelpProps {
  readonly id: string;
  readonly children: ReactNode;
}

export function FieldHelp({ id, children }: FieldHelpProps) {
  return (
    <p className="field-help" id={id}>
      {children}
    </p>
  );
}

export interface FieldErrorProps {
  readonly id: string;
  readonly children: ReactNode;
}

export function FieldError({ id, children }: FieldErrorProps) {
  return (
    <p className="field-error" id={id} role="alert">
      {children}
    </p>
  );
}

export interface FieldProps {
  readonly id: string;
  readonly label: ReactNode;
  readonly children: ReactNode;
  readonly help?: ReactNode;
  readonly error?: ReactNode;
  readonly required?: boolean;
  readonly className?: string;
}

export function Field({
  id,
  label,
  children,
  help,
  error,
  required = false,
  className,
}: FieldProps) {
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const contextValue: FieldContextValue = {
    id,
    required,
    ...(helpId ? { helpId } : {}),
    ...(errorId ? { errorId } : {}),
    ...(typeof error === 'string' ? { error } : error ? { error: 'true' } : {}),
  };

  return (
    <div className={joinClassNames('field', className)}>
      <FieldContext.Provider value={contextValue}>
        <Label htmlFor={id} required={required}>
          {label}
        </Label>
        {children}
        {helpId ? <FieldHelp id={helpId}>{help}</FieldHelp> : null}
        {errorId ? <FieldError id={errorId}>{error}</FieldError> : null}
      </FieldContext.Provider>
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid = false, ...props },
  ref,
) {
  const fieldProps = useFieldControlProps({
    ...props,
    ...(invalid ? { 'aria-invalid': true as const } : {}),
  });
  return <input {...fieldProps} ref={ref} className={joinClassNames('form-control', className)} />;
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid = false, ...props },
  ref,
) {
  const fieldProps = useFieldControlProps({
    ...props,
    ...(invalid ? { 'aria-invalid': true as const } : {}),
  });
  return <select {...fieldProps} ref={ref} className={joinClassNames('form-control', className)} />;
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid = false, ...props },
  ref,
) {
  const fieldProps = useFieldControlProps({
    ...props,
    ...(invalid ? { 'aria-invalid': true as const } : {}),
  });
  return (
    <textarea {...fieldProps} ref={ref} className={joinClassNames('form-control', className)} />
  );
});

export interface BreadcrumbItem {
  readonly label: string;
  readonly href?: string;
  readonly current?: boolean;
}

export interface BreadcrumbsProps {
  readonly items: readonly BreadcrumbItem[];
  readonly className?: string;
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  return (
    <nav className={joinClassNames('breadcrumbs', className)} aria-label="Trilha de navegação">
      <ol>
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            {item.current ? (
              <span aria-current="page">{item.label}</span>
            ) : item.href ? (
              <a href={item.href}>{item.label}</a>
            ) : (
              <span>{item.label}</span>
            )}
            {index < items.length - 1 ? (
              <span className="breadcrumb-separator" aria-hidden="true">
                /
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export interface PageHeaderProps {
  readonly title: string;
  readonly titleId?: string;
  readonly eyebrow?: string;
  readonly description?: ReactNode;
  readonly breadcrumbs?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
}

export function PageHeader({
  title,
  titleId,
  eyebrow,
  description,
  breadcrumbs,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header className={joinClassNames('page-header', className)}>
      {breadcrumbs}
      <div className="page-header-content">
        <div>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h1 id={titleId}>{title}</h1>
          {description ? <p className="page-description">{description}</p> : null}
        </div>
        {actions ? <div className="page-header-actions">{actions}</div> : null}
      </div>
    </header>
  );
}

export interface EmptyStateProps {
  readonly title: string;
  readonly description: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <section
      className={joinClassNames('empty-state', className)}
      aria-labelledby="empty-state-title"
    >
      <p className="empty-state-mark" aria-hidden="true">
        —
      </p>
      <h2 id="empty-state-title">{title}</h2>
      <p>{description}</p>
      {action ? <div className="empty-state-action">{action}</div> : null}
    </section>
  );
}
