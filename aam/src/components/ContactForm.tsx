/**
 * Formulario de contacto (isla de React) enviado a Netlify Forms.
 * - Validación en el navegador con mensajes accesibles.
 * - Protección antispam con campo trampa (honeypot) "bot-field".
 * - Sin JavaScript, el formulario se envía igualmente (POST normal a Netlify).
 */
import { useId, useRef, useState, type SubmitEvent } from 'react';

type Field = 'name' | 'email' | 'message';
type Errors = Partial<Record<Field, string>>;
type Status = 'idle' | 'sending' | 'success' | 'error';

interface Props {
  formName: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validate(data: FormData): Errors {
  const errors: Errors = {};
  const name = String(data.get('name') || '').trim();
  const email = String(data.get('email') || '').trim();
  const message = String(data.get('message') || '').trim();
  if (name.length < 2) errors.name = 'Escribe tu nombre (mínimo 2 caracteres).';
  if (!email) errors.email = 'Escribe tu email.';
  else if (!EMAIL_RE.test(email)) errors.email = 'El email no parece válido. Revisa que esté bien escrito.';
  if (message.length < 10) errors.message = 'Cuéntame un poco más (mínimo 10 caracteres).';
  return errors;
}

export default function ContactForm({ formName }: Props) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [status, setStatus] = useState<Status>('idle');

  const revalidate = (field: Field) => {
    if (!formRef.current) return;
    const next = validate(new FormData(formRef.current));
    setErrors((prev) => ({ ...prev, [field]: next[field] }));
  };

  const onBlur = (field: Field) => {
    setTouched((t) => ({ ...t, [field]: true }));
    revalidate(field);
  };

  const onChange = (field: Field) => {
    if (touched[field]) revalidate(field);
    if (status === 'error' || status === 'success') setStatus('idle');
  };

  const onSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const found = validate(data);
    setErrors(found);
    setTouched({ name: true, email: true, message: true });
    const firstInvalid = (Object.keys(found) as Field[])[0];
    if (firstInvalid) {
      form.querySelector<HTMLElement>(`[name="${firstInvalid}"]`)?.focus();
      return;
    }
    // Si un bot ha rellenado el campo trampa, se simula éxito sin enviar nada.
    if (String(data.get('bot-field') || '')) {
      setStatus('success');
      return;
    }
    setStatus('sending');
    try {
      const body = new URLSearchParams();
      data.forEach((value, key) => body.append(key, String(value)));
      const res = await fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!res.ok) throw new Error(String(res.status));
      form.reset();
      setTouched({});
      setStatus('success');
    } catch {
      setStatus('error');
    }
  };

  const fieldProps = (field: Field) => ({
    id: `${id}-${field}`,
    name: field,
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? `${id}-${field}-error` : undefined,
    onBlur: () => onBlur(field),
    onChange: () => onChange(field),
  });

  const errorFor = (field: Field) =>
    errors[field] ? (
      <p id={`${id}-${field}-error`} className="form__error" role="alert">
        {errors[field]}
      </p>
    ) : null;

  return (
    <form
      ref={formRef}
      name={formName}
      method="POST"
      className="form"
      noValidate
      onSubmit={onSubmit}
      aria-describedby={`${id}-status`}
    >
      <input type="hidden" name="form-name" value={formName} />
      <p className="form__honeypot" aria-hidden="true">
        <label>
          No rellenes este campo si eres humano: <input name="bot-field" tabIndex={-1} autoComplete="off" />
        </label>
      </p>

      <div className="form__field">
        <label htmlFor={`${id}-name`} className="form__label">
          Nombre
        </label>
        <input type="text" autoComplete="name" required minLength={2} className="form__input" {...fieldProps('name')} />
        {errorFor('name')}
      </div>

      <div className="form__field">
        <label htmlFor={`${id}-email`} className="form__label">
          Email
        </label>
        <input type="email" autoComplete="email" inputMode="email" required className="form__input" {...fieldProps('email')} />
        {errorFor('email')}
      </div>

      <div className="form__field">
        <label htmlFor={`${id}-message`} className="form__label">
          Mensaje
        </label>
        <textarea rows={5} required minLength={10} className="form__input form__textarea" {...fieldProps('message')} />
        {errorFor('message')}
      </div>

      <div className="form__actions">
        <button type="submit" className="btn btn-accent form__submit" disabled={status === 'sending'} data-cursor="Enviar">
          {status === 'sending' ? 'Enviando…' : 'Enviar mensaje'}
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 8h10M9 4l4 4-4 4" />
          </svg>
        </button>

        <div id={`${id}-status`} className="form__status" aria-live="polite">
          {status === 'success' && (
            <p className="form__message form__message--success">
              <span aria-hidden="true">✦</span> ¡Gracias! Tu mensaje se ha enviado. Te responderé lo antes posible.
            </p>
          )}
          {status === 'error' && (
            <p className="form__message form__message--error">
              <span aria-hidden="true">!</span> No se ha podido enviar el mensaje. Inténtalo de nuevo en unos minutos o
              escríbeme por email.
            </p>
          )}
        </div>
      </div>
    </form>
  );
}
