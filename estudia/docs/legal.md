# Cumplimiento legal y protección de datos

> ⚠️ **Borrador técnico, no es asesoramiento jurídico.** Este documento describe cómo se ha diseñado la web para cumplir el RGPD y la LOPDGDD e incluye **borradores** de política de privacidad y términos de uso. **Deben revisarlos un abogado o un delegado de protección de datos (DPD) antes de publicar la web.** Los campos entre corchetes `[ … ]` hay que completarlos.

## 1. Marco normativo aplicable

| Norma | Por qué aplica |
|---|---|
| **Reglamento (UE) 2016/679 (RGPD)** | Se tratan datos personales de estudiantes (correo, fecha de nacimiento, apuntes, resultados). |
| **Ley Orgánica 3/2018 (LOPDGDD)**, en especial **art. 7** (consentimiento de menores) y **arts. 84 y 92** (protección de menores en internet) | Usuarios en España, muchos menores. En España la edad mínima para consentir por sí mismo es **14 años**; por debajo, el consentimiento lo da quien ejerce la patria potestad o tutela. |
| **Ley 34/2002 (LSSI‑CE)** | Servicio de la sociedad de la información (aviso legal, comunicaciones electrónicas). |
| **Reglamento (UE) 2024/1689 (Reglamento de IA)** | La web usa IA generativa. Obligaciones de **transparencia (art. 50)**: informar de que el contenido lo genera una IA. Hay que **analizar con un profesional** si la corrección automática podría encajar en el anexo III, punto 3 (educación); en principio la web no la usa una institución educativa ni para decisiones de acceso o calificación oficial, y la nota es **orientativa**. |

## 2. Cómo se aplica en la web (privacidad desde el diseño, art. 25 RGPD)

### 2.1 Edad y consentimiento de padres o tutores (art. 8 RGPD y art. 7 LOPDGDD)
- En el registro se pide la **fecha de nacimiento**.
- **Si el usuario tiene 14 años o más**, acepta él mismo la política de privacidad y el tratamiento con IA.
- **Si tiene menos de 14 años**, la cuenta queda en estado **«pendiente de consentimiento»**:
  - Se pide el **correo del padre, madre o tutor legal**.
  - Se envía a ese correo un **enlace de un solo uso** (token aleatorio de 32 bytes, guardado solo como *hash* SHA‑256, caduca en 7 días).
  - El adulto ve una página con la información del tratamiento y confirma con su nombre, la relación con el menor y casillas de consentimiento separadas (cuenta y tratamiento de apuntes con IA).
  - Se guarda **prueba del consentimiento**: fecha, versión de la política, nombre y relación declarada, y *hash* de la IP (no la IP en claro).
  - **Hasta que el adulto confirma, el menor no puede subir apuntes ni usar la IA.** Esto se impone en el servidor y en la base de datos (función `puede_tratar_datos()` usada en las políticas RLS y en el Storage), no solo en la interfaz.
- El responsable debe hacer **esfuerzos razonables** para verificar que quien consiente es el tutor (art. 8.2 RGPD). El correo de confirmación es un mínimo; el profesional que revise debe valorar si hace falta un método reforzado.
- El tutor puede **retirar el consentimiento** en cualquier momento escribiendo a `[correo de privacidad]` o desde la cuenta del menor (Perfil → Privacidad → Borrar todos mis datos).

### 2.2 Minimización y privacidad por defecto
- Solo se piden: correo, nombre visible (puede ser un apodo), fecha de nacimiento y, si es menor de 14, el correo del tutor.
- **Apuntes privados por defecto**: no existe ninguna función para compartir apuntes con otros usuarios. Cada fila de la base de datos y cada archivo del Storage pertenece a un usuario y la **Row Level Security** (RLS) impide que nadie más los lea.
- El *bucket* de Storage es **privado**; las imágenes se muestran con URL firmadas que caducan.
- No hay publicidad, ni rastreadores de terceros, ni perfiles comerciales.
- Las notificaciones son **opcionales**, del propio navegador, y nunca entre las 22:00 y las 8:00.

### 2.3 Derechos de los interesados (arts. 15‑22 RGPD)
- **Acceso y portabilidad**: *Perfil → Privacidad → Exportar mis datos* descarga un archivo JSON con todos los datos y enlaces temporales a los archivos subidos.
- **Supresión**: *Perfil → Privacidad → Borrar todos mis datos* elimina la cuenta, todos los registros (borrado en cascada) y todos los archivos del Storage. Es inmediato e irreversible.
- **Rectificación**: el estudiante puede editar su perfil, el texto extraído de sus apuntes y todas las flashcards.
- Para el resto de derechos (oposición, limitación) o reclamaciones: `[correo de privacidad]`. Derecho a reclamar ante la **Agencia Española de Protección de Datos** (www.aepd.es).

### 2.4 Encargados del tratamiento y transferencias internacionales (arts. 28 y 44‑49 RGPD)
| Proveedor | Función | Notas a verificar por el responsable |
|---|---|---|
| **Supabase** | Base de datos, autenticación y almacenamiento | Elegir región en la UE (p. ej. Frankfurt). Firmar el DPA. |
| **Netlify** | Alojamiento web y funciones de servidor | Firmar el DPA; revisar región de ejecución de las funciones. |
| **Anthropic (API de Claude)** | Lectura de fotos y generación de materiales | Firmar el DPA. Posible transferencia a EE. UU.: revisar el marco aplicable (Marco de Privacidad de Datos UE‑EE. UU. o cláusulas contractuales tipo). Según las condiciones comerciales de la API, los datos enviados no se usan para entrenar modelos; **confirmarlo en el contrato vigente** y revisar el periodo de retención. |
| **Voyage AI** (opcional) | Vectores de búsqueda (embeddings) de los apuntes | Solo si se configura `VOYAGE_API_KEY`. Mismas comprobaciones. |
| **Resend** (opcional) | Envío del correo de consentimiento al tutor | Solo si se configura `RESEND_API_KEY`. |

### 2.5 Seguridad (art. 32 RGPD)
- Claves solo en variables de entorno del servidor (`.env`, nunca en el repositorio ni en el navegador). El navegador solo recibe la clave **anon** de Supabase, que es pública por diseño y está limitada por RLS.
- Todas las llamadas a la IA se hacen desde funciones de servidor que verifican el token del usuario, el consentimiento y los **límites diarios de uso**.
- RLS activado en **todas** las tablas. Pruebas automáticas en `tests/db` comprueban que un usuario no puede leer ni modificar datos de otro.
- Registro de consumo de IA (`ai_usage`) sin contenido de los apuntes: solo tipo de operación y tokens.

### 2.6 Evaluación de impacto (art. 35 RGPD)
Por tratarse de **datos de menores a gran escala con tecnologías nuevas (IA)**, es **muy recomendable realizar una Evaluación de Impacto (EIPD)** antes del lanzamiento. La AEPD publica guías y la herramienta *Gestiona EIPD*.

### 2.7 Conservación
- Los datos se conservan mientras la cuenta esté activa.
- Recomendación (a decidir por el responsable): borrar o avisar a las cuentas **inactivas durante 24 meses**, y borrar los tokens de consentimiento caducados.
- Los registros de consumo de IA se pueden conservar de forma agregada para controlar costes.

---

## 3. Borrador de POLÍTICA DE PRIVACIDAD

*(Versión `2026-10-01`. Redactada en lenguaje sencillo porque muchos usuarios son menores, como recomienda el considerando 58 del RGPD.)*

**¿Quién es el responsable?**
`[Nombre o razón social]`, NIF `[ ]`, domicilio `[ ]`. Correo de privacidad: `[ ]`. Delegado de protección de datos (si existe): `[ ]`.

**¿Qué datos tratamos?**
- Tu correo, tu nombre o apodo y tu fecha de nacimiento.
- Si tienes menos de 14 años, el correo y el nombre de tu padre, madre o tutor, y la prueba de que ha dado su consentimiento.
- Las fotos, PDF y textos de tus apuntes, y el texto que se extrae de ellos.
- Lo que generas al estudiar: exámenes que creas, resúmenes, flashcards, resultados de tests, planes de estudio, rachas y logros.
- Datos técnicos mínimos: registros de uso de la IA (tipo de operación y cantidad de texto procesado) para controlar los límites diarios.

**¿Para qué los usamos?**
1. Para darte el servicio: crear tus exámenes, leer tus apuntes y generar materiales de estudio y tu plan. *(Base: ejecución del contrato, art. 6.1.b RGPD, y tu consentimiento o el de tu tutor, art. 6.1.a y 8 RGPD.)*
2. Para leer tus apuntes con inteligencia artificial: tus fotos y textos se envían a nuestro proveedor de IA solo para generar tus materiales. *(Base: consentimiento, art. 6.1.a.)*
3. Para la seguridad de la web y para que nadie abuse de la IA (límites de uso). *(Base: interés legítimo, art. 6.1.f.)*

**No** vendemos tus datos, **no** mostramos publicidad y **no** compartimos tus apuntes con otros usuarios.

**Inteligencia artificial.** Los resúmenes, tarjetas, preguntas, correcciones y respuestas del tutor los genera una IA a partir de tus apuntes. Pueden contener errores. La nota estimada es **orientativa**. Lo que la IA añade y no está en tus apuntes aparece marcado como «Ampliación».

**¿A quién se comunican?** Solo a los proveedores que nos ayudan a prestar el servicio (alojamiento, base de datos, IA y envío de correos), con contrato de encargo de tratamiento. Algunos pueden estar fuera de la UE; en ese caso se aplican las garantías del RGPD (`[detallar: Marco de Privacidad de Datos UE‑EE. UU. / cláusulas contractuales tipo]`).

**¿Cuánto tiempo?** Mientras tengas la cuenta. Si la borras, se borra todo en el momento. `[Política de cuentas inactivas]`.

**Tus derechos.** Puedes ver, descargar, corregir y borrar tus datos desde *Perfil → Privacidad*. También puedes oponerte o pedir que limitemos el uso escribiendo a `[correo]`. Si eres menor de 14 años, tu padre, madre o tutor puede ejercerlos por ti. Si no estás conforme, puedes reclamar ante la Agencia Española de Protección de Datos (www.aepd.es).

**Menores de 14 años.** Necesitan que su padre, madre o tutor dé su consentimiento. Hasta entonces la cuenta no puede subir apuntes ni usar la IA.

---

## 4. Borrador de TÉRMINOS DE USO

*(Versión `2026-10-01`.)*

1. **Qué es Estudia.** Una herramienta para preparar exámenes a partir de tus propios apuntes, con ayuda de inteligencia artificial.
2. **Quién puede usarla.** Cualquier estudiante. Si tienes menos de 14 años, necesitas el consentimiento de tu padre, madre o tutor legal.
3. **Tu cuenta.** Eres responsable de guardar tu contraseña. Avísanos si crees que alguien ha entrado en tu cuenta.
4. **Tus apuntes son tuyos.** Solo subes contenido que tienes derecho a usar (tus apuntes, o fotos de libros para tu estudio personal). No subas datos personales de otras personas ni contenido ilegal. Nos das permiso solo para procesarlos y generar *tus* materiales.
5. **Uso razonable de la IA.** Hay límites diarios de uso para que el servicio sea sostenible. Si los alcanzas, puedes seguir usando todo lo que ya se ha generado.
6. **La IA puede equivocarse.** Los materiales, correcciones y la nota estimada son una ayuda orientativa. Revisa lo marcado como «Ampliación» y consulta con tu profesorado ante cualquier duda. No garantizamos ninguna nota.
7. **Uso prohibido.** No uses la web para copiar en exámenes reales, para acosar a nadie ni para intentar acceder a datos de otros usuarios.
8. **Baja.** Puedes borrar tu cuenta y todos tus datos cuando quieras desde el Perfil.
9. **Cambios.** Si cambiamos estos términos te avisaremos en la web; si eres menor de 14 años y el cambio afecta al tratamiento de datos, volveremos a pedir el consentimiento a tu tutor.
10. **Ley aplicable.** Ley española. `[Jurisdicción / mecanismos de resolución de conflictos para consumidores]`.

---

## 5. Lista de comprobación antes de publicar

- [ ] Revisión de este documento por un abogado o DPD.
- [ ] Completar los datos del responsable en la política y en el aviso legal (LSSI).
- [ ] Firmar los DPA con Supabase, Netlify, Anthropic (y Voyage/Resend si se usan).
- [ ] Elegir región UE en Supabase.
- [ ] Realizar la EIPD.
- [ ] Configurar el remitente de correo verificado para el consentimiento de tutores.
- [ ] Registro de actividades de tratamiento (art. 30 RGPD).
- [ ] Revisar la clasificación según el Reglamento de IA.
