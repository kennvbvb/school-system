'use client';

import { useId } from 'react';

/**
 * ช่องกรอกที่ใช้ร่วมกันในหน้าจอผู้ดูแลและงบประมาณ
 *
 * มีอยู่เพื่อให้กติกาการเข้าถึงของฟอร์มอยู่ที่เดียว: ทุกช่องมี `<label>` ผูกกับ
 * input จริงด้วย id, ข้อความ error ผูกด้วย `aria-describedby` และช่องที่ผิดถูกทำ
 * เครื่องหมายด้วย `aria-invalid` ไม่ใช่ด้วยสีอย่างเดียว (ข้อ 12.4)
 *
 * ถ้าปล่อยให้แต่ละฟอร์มเขียน markup เอง จะมีบางช่องที่ลืมทำครบโดยไม่มีอะไรฟ้อง
 */

const CONTROL_CLASS =
  'w-full rounded-md border border-slate-300 px-3 py-2 ' +
  'focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400 ' +
  'aria-[invalid=true]:border-rose-500';

interface BaseProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  hint?: string | undefined;
  required?: boolean;
  className?: string;
}

/** ข้อความช่วยและข้อความผิดพลาดใช้โครงเดียวกันทุกช่อง */
function FieldShell({
  label,
  error,
  hint,
  required,
  className,
  controlId,
  describedBy,
  children,
}: {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  required?: boolean;
  className?: string;
  controlId: string;
  describedBy: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className ?? 'block'}>
      <label htmlFor={controlId} className="mb-1 block text-sm font-medium">
        {label}
        {required ? <span className="text-rose-700"> *</span> : null}
      </label>
      {children}
      {hint ? (
        <span id={`${describedBy}-hint`} className="mt-1 block text-sm text-slate-600">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={`${describedBy}-error`} className="mt-1 block text-sm text-rose-700">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function describedByOf(base: string, hint?: string, error?: string): string | undefined {
  const ids = [hint ? `${base}-hint` : null, error ? `${base}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

export function TextField({
  type = 'text',
  ...props
}: BaseProps & { type?: 'text' | 'date' | 'number' }) {
  const id = useId();
  const describedBy = describedByOf(id, props.hint, props.error);

  return (
    <FieldShell {...props} controlId={id} describedBy={id}>
      <input
        id={id}
        type={type}
        value={props.value}
        required={props.required}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => props.onChange(event.target.value)}
        className={CONTROL_CLASS}
      />
    </FieldShell>
  );
}

export function TextAreaField(props: BaseProps & { rows?: number }) {
  const id = useId();
  const describedBy = describedByOf(id, props.hint, props.error);

  return (
    <FieldShell {...props} controlId={id} describedBy={id}>
      <textarea
        id={id}
        rows={props.rows ?? 3}
        value={props.value}
        required={props.required}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => props.onChange(event.target.value)}
        className={CONTROL_CLASS}
      />
    </FieldShell>
  );
}

export interface SelectOption {
  id: string;
  label: string;
}

export function SelectField({
  options,
  placeholder = '— เลือก —',
  ...props
}: BaseProps & { options: readonly SelectOption[]; placeholder?: string }) {
  const id = useId();
  const describedBy = describedByOf(id, props.hint, props.error);

  return (
    <FieldShell {...props} controlId={id} describedBy={id}>
      <select
        id={id}
        value={props.value}
        required={props.required}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => props.onChange(event.target.value)}
        className={CONTROL_CLASS}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

/** ข้อความผิดพลาดระดับฟอร์ม — ประกาศด้วย role="alert" ให้ screen reader อ่านทันที */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <p
      role="alert"
      className="rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-rose-900"
    >
      {message}
    </p>
  );
}

export function SubmitButton({
  isSubmitting,
  children,
  variant = 'primary',
}: {
  isSubmitting: boolean;
  children: React.ReactNode;
  variant?: 'primary' | 'danger';
}) {
  const base = 'rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60';
  const color =
    variant === 'danger' ? 'bg-rose-700 hover:bg-rose-600' : 'bg-slate-900 hover:bg-slate-700';

  return (
    <button type="submit" disabled={isSubmitting} className={`${base} ${color}`}>
      {isSubmitting ? 'กำลังบันทึก…' : children}
    </button>
  );
}
