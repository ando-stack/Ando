# Fundamentos pedagógicos de Estudia

Este documento explica **qué técnica de estudio hay detrás de cada función** de la web, por qué se ha elegido y en qué evidencia se apoya. Las referencias están al final, numeradas.

> Criterio general: priorizamos las técnicas que la revisión de Dunlosky y colaboradores [1] califica con **utilidad alta** (práctica de recuperación y práctica distribuida) o **moderada** (práctica intercalada, autoexplicación e interrogación elaborativa). Las técnicas de utilidad baja (releer, subrayar, resumir sin más) no son el centro de la web: los resúmenes existen como punto de partida, pero cada resumen termina invitando a pasar a flashcards o tests.

---

## 1. Recuperación activa (práctica de evocación)

**Qué es.** Intentar recordar la información sin mirarla (responder preguntas, completar huecos, explicar) en lugar de volver a leerla.

**Evidencia.** Hacer pruebas mejora la retención a largo plazo más que estudiar el mismo tiempo releyendo (*efecto test*) [2]. Los metaanálisis lo confirman con efectos moderados‑grandes y en todos los niveles educativos [3][4][5]. El efecto es mayor cuando hay **retroalimentación** con la respuesta correcta [6].

**Dónde se usa en la web.**
- **Flashcards**: la tarjeta muestra la pregunta y el estudiante debe intentar responder *antes* de girarla.
- **Tests de práctica**: opción múltiple, verdadero/falso **con justificación**, respuesta corta, relacionar y ordenar. Cada respuesta se corrige al instante con explicación y **cita del apunte** (retroalimentación inmediata y elaborada [6][7]).
- **Ideas clave del resumen**: se pueden ocultar para autoevaluarse.
- **Técnica Feynman** (ver §6).

## 2. Repetición espaciada (práctica distribuida)

**Qué es.** Repartir los repasos en el tiempo, con intervalos crecientes, en vez de concentrarlos en una sesión.

**Evidencia.** La práctica distribuida supera a la concentrada en cientos de experimentos [8]. El intervalo óptimo depende del tiempo que falta hasta la prueba: cuanto más lejos esté el examen, más largo puede ser el intervalo [9].

**Dónde se usa en la web.**
- **Algoritmo FSRS** (*Free Spaced Repetition Scheduler*) [10][11]. Implementado en `src/lib/fsrs.ts` siguiendo la documentación pública del algoritmo (versión FSRS‑5, con sus 19 parámetros por defecto). Modela para cada tarjeta:
  - **Estabilidad (S)**: días que tarda la probabilidad de recordar en bajar al 90 %.
  - **Dificultad (D)**: de 1 a 10.
  - **Recuperabilidad (R)**: probabilidad de recordar hoy, `R(t,S) = (1 + F·t/S)^C` con `C = −0,5` y `F = 19/81`.
  - El intervalo siguiente es el que hace que R baje hasta la **retención deseada** (90 % por defecto).
- **Adaptación al examen** (inspirada en [9]): ningún repaso se programa *después* del examen; si el intervalo calculado lo supera, se adelanta para que el último repaso caiga **antes** de la fecha, y en los últimos días se priorizan las tarjetas con menor recuperabilidad prevista *el día del examen*.
- **Plan de estudio**: cada tema se estudia por primera vez con antelación y vuelve a aparecer en días posteriores (repasos con flashcards y tests), no todo de golpe.

## 3. Práctica con exámenes (simulacros)

**Qué es.** Hacer exámenes con el mismo formato, duración y condiciones que el real.

**Evidencia.** Es una forma de recuperación activa [3][4]; además, practicar con el **mismo formato** que la prueba final mejora el rendimiento y reduce la ansiedad ante el examen [12]. Los beneficios de las pruebas se transfieren mejor cuando las preguntas exigen aplicar y no solo reconocer [5].

**Dónde se usa en la web.**
- **Exámenes de práctica** con el formato (porcentaje de test, cortas, desarrollo, problemas) y la duración que indicó el estudiante, con temporizador.
- **Corrección con rúbrica visible**: la IA corrige desarrollo y problemas con criterios explícitos, nota estimada y **qué falta para subir nota** (retroalimentación orientada a la tarea y al siguiente paso, la que más ayuda según [7]).
- El plan programa simulacros en la segunda mitad del tiempo disponible y deja los últimos días para repaso general.

## 4. Práctica intercalada

**Qué es.** Mezclar tipos de problemas o temas en una misma sesión en lugar de practicar en bloques (todo el tema 1, luego todo el tema 2).

**Evidencia.** Intercalar mejora la capacidad de **elegir la estrategia** adecuada y la retención, sobre todo en matemáticas [13][14] y en aprendizaje de categorías [15].

**Dónde se usa en la web.**
- Los **tests del examen completo** y los **simulacros** mezclan preguntas de todos los temas.
- La sesión de **flashcards** del día mezcla tarjetas de todos los temas que tocan (ordenadas por urgencia, no por tema).
- El **plan** alterna temas nuevos con repasos de temas ya vistos.

## 5. Elaboración: resúmenes por niveles y mapas conceptuales

**Qué es.** Organizar la información y relacionarla (jerarquías, causas, comparaciones).

**Evidencia.** Resumir tiene utilidad baja si se hace de forma pasiva [1], pero los mapas conceptuales ayudan a la comprensión y retención frente a leer textos o listas [16], especialmente cuando el estudiante **interactúa** con ellos. La interrogación elaborativa y la autoexplicación tienen utilidad moderada [1][17].

**Dónde se usa en la web.**
- **Resumen en tres niveles** (ideas clave → resumen → detallado): permite ir de lo general a lo concreto.
- **Esquemas y mapas conceptuales interactivos**: los nodos se despliegan; el estudiante puede intentar recordar qué hay debajo antes de desplegar (recuperación + organización).
- Al final de cada resumen se propone pasar a flashcards o test, para no quedarse en la relectura.

## 6. Técnica Feynman (explicar con tus palabras)

**Qué es.** Explicar un tema como si se le enseñara a otra persona, detectar dónde falla la explicación y volver a los apuntes.

**Evidencia.** "Aprender enseñando" y explicar a otros mejora la comprensión frente a solo estudiar [18][19]; la autoexplicación ayuda a detectar lagunas [17]. Es además una práctica de recuperación libre (*free recall*) [2].

**Dónde se usa en la web.** El estudiante escribe o dicta su explicación; la IA la compara **solo con sus apuntes** y señala: conceptos que faltan, errores y partes confusas, siempre citando el fragmento del apunte correspondiente.

## 7. Tutor basado en los apuntes y explicación por niveles

**Qué es.** Resolver dudas en el momento, con explicaciones paso a paso y ajustables en dificultad.

**Evidencia.** Los ejemplos resueltos paso a paso reducen la carga cognitiva de los principiantes [20]; la retroalimentación inmediata y específica mejora el aprendizaje [7]. El tutor **no da respuestas fuera de los apuntes sin avisar**: lo que no está en ellos se marca como "Ampliación".

## 8. Planificación, metas y nota objetivo

**Qué es.** Fijar una meta concreta (la nota) y planificar cuándo se estudia qué.

**Evidencia.** Las metas específicas y alcanzables mejoran el rendimiento frente a "hazlo lo mejor que puedas" [21]; planificar **cuándo y dónde** se hará cada tarea (intenciones de implementación) aumenta la probabilidad de hacerla [22].

**Dónde se usa en la web.**
- El **plan día a día** se calcula con la fecha, la nota objetivo, el nivel actual, el tiempo diario y la cantidad de contenido (`src/lib/plan.ts`).
- Si la meta no parece alcanzable, se avisa **con tacto** y se proponen ajustes concretos (más minutos diarios o priorizar temas), en lugar de una predicción desmoralizante.
- El plan se **reajusta solo** si el estudiante se salta días o va más rápido: no hay "deuda" acumulada que culpabilice.

## 9. Temporizador de concentración (Pomodoro)

**Qué es.** Bloques de trabajo con pausas breves (por defecto 25 + 5 minutos, configurable).

**Evidencia.** La evidencia directa sobre la técnica Pomodoro es **limitada** [23]; lo que sí está respaldado es que las pausas breves reducen la fatiga y mantienen el rendimiento en tareas largas [24]. Por eso el temporizador es **opcional y configurable**, no una obligación.

## 10. Motivación sana

**Qué es.** Reforzar la constancia y la sensación de progreso sin castigar los fallos.

**Evidencia.** La motivación es más duradera cuando se apoya en la **competencia** (ver que avanzas), la **autonomía** (elegir) y no en presión externa [25]. La retroalimentación centrada en el proceso y en el esfuerzo es más útil que la que juzga a la persona [7][26]. Los sistemas de recompensa muy punitivos pueden dañar la motivación intrínseca [27].

**Dónde se usa en la web.**
- **Racha de días** con **un día de descanso a la semana que no la rompe**.
- **Logros por constancia** (no por "ser el mejor").
- **Mensajes positivos**: si te saltas un día, el plan se reajusta y el mensaje es "Retomamos hoy", nunca un reproche.
- **Celebraciones** al terminar simulacros, independientemente de la nota, y explicación de qué hacer para mejorar.
- **Nota estimada orientativa**, explicada siempre como estimación, nunca como predicción segura.
- Sin avisos nocturnos (de 22:00 a 8:00) para respetar el descanso, que también es necesario para consolidar lo aprendido [28].

## 11. Fidelidad a los apuntes (principio transversal)

Todo el material se genera **solo a partir de los apuntes** del estudiante y cada elemento cita la foto o página de la que sale. Esto no es solo una cuestión técnica: estudiar con contenido incorrecto o que no entra en el examen es contraproducente, y los errores "aprendidos" en pruebas pueden persistir si no se corrigen [6]. Lo que la IA añade por su cuenta aparece marcado como **"Ampliación — conviene comprobarlo"**.

---

## Referencias

1. Dunlosky, J., Rawson, K. A., Marsh, E. J., Nathan, M. J., y Willingham, D. T. (2013). Improving students' learning with effective learning techniques. *Psychological Science in the Public Interest, 14*(1), 4–58. https://doi.org/10.1177/1529100612453266
2. Roediger, H. L., y Karpicke, J. D. (2006). Test‑enhanced learning: Taking memory tests improves long‑term retention. *Psychological Science, 17*(3), 249–255. https://doi.org/10.1111/j.1467-9280.2006.01693.x
3. Rowland, C. A. (2014). The effect of testing versus restudy on retention: A meta‑analytic review of the testing effect. *Psychological Bulletin, 140*(6), 1432–1463. https://doi.org/10.1037/a0037559
4. Adesope, O. O., Trevisan, D. A., y Sundararajan, N. (2017). Rethinking the use of tests: A meta‑analysis of practice testing. *Review of Educational Research, 87*(3), 659–701. https://doi.org/10.3102/0034654316689306
5. Agarwal, P. K., Nunes, L. D., y Blunt, J. R. (2021). Retrieval practice consistently benefits student learning: A systematic review of applied research in schools and classrooms. *Educational Psychology Review, 33*, 1409–1453. https://doi.org/10.1007/s10648-021-09595-9
6. Butler, A. C., y Roediger, H. L. (2008). Feedback enhances the positive effects and reduces the negative effects of multiple‑choice testing. *Memory & Cognition, 36*(3), 604–616. https://doi.org/10.3758/MC.36.3.604
7. Hattie, J., y Timperley, H. (2007). The power of feedback. *Review of Educational Research, 77*(1), 81–112. https://doi.org/10.3102/003465430298487
8. Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., y Rohrer, D. (2006). Distributed practice in verbal recall tasks: A review and quantitative synthesis. *Psychological Bulletin, 132*(3), 354–380. https://doi.org/10.1037/0033-2909.132.3.354
9. Cepeda, N. J., Vul, E., Rohrer, D., Wixted, J. T., y Pashler, H. (2008). Spacing effects in learning: A temporal ridgeline of optimal retention. *Psychological Science, 19*(11), 1095–1102. https://doi.org/10.1111/j.1467-9280.2008.02209.x
10. Ye, J., Su, J., y Cao, Y. (2022). A stochastic shortest path algorithm for optimizing spaced repetition scheduling. *Proceedings of the 28th ACM SIGKDD Conference*, 4381–4390. https://doi.org/10.1145/3534678.3539081
11. Open Spaced Repetition. *The Algorithm* (documentación pública de FSRS). https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm
12. Agarwal, P. K., D'Antonio, L., Roediger, H. L., McDermott, K. B., y McDaniel, M. A. (2014). Classroom‑based programs of retrieval practice reduce middle school and high school students' test anxiety. *Journal of Applied Research in Memory and Cognition, 3*(3), 131–139. https://doi.org/10.1016/j.jarmac.2014.07.002
13. Rohrer, D., y Taylor, K. (2007). The shuffling of mathematics problems improves learning. *Instructional Science, 35*, 481–498. https://doi.org/10.1007/s11251-007-9015-8
14. Rohrer, D., Dedrick, R. F., y Stershic, S. (2015). Interleaved practice improves mathematics learning. *Journal of Educational Psychology, 107*(3), 900–908. https://doi.org/10.1037/edu0000001
15. Kornell, N., y Bjork, R. A. (2008). Learning concepts and categories: Is spacing the "enemy of induction"? *Psychological Science, 19*(6), 585–592. https://doi.org/10.1111/j.1467-9280.2008.02127.x
16. Nesbit, J. C., y Adesope, O. O. (2006). Learning with concept and knowledge maps: A meta‑analysis. *Review of Educational Research, 76*(3), 413–448. https://doi.org/10.3102/00346543076003413
17. Chi, M. T. H., De Leeuw, N., Chiu, M.‑H., y LaVancher, C. (1994). Eliciting self‑explanations improves understanding. *Cognitive Science, 18*(3), 439–477. https://doi.org/10.1207/s15516709cog1803_3
18. Fiorella, L., y Mayer, R. E. (2013). The relative benefits of learning by teaching and teaching expectancy. *Contemporary Educational Psychology, 38*(4), 281–288. https://doi.org/10.1016/j.cedpsych.2013.06.001
19. Fiorella, L., y Mayer, R. E. (2016). Eight ways to promote generative learning. *Educational Psychology Review, 28*, 717–741. https://doi.org/10.1007/s10648-015-9348-9
20. Sweller, J., y Cooper, G. A. (1985). The use of worked examples as a substitute for problem solving in learning algebra. *Cognition and Instruction, 2*(1), 59–89. https://doi.org/10.1207/s1532690xci0201_3
21. Locke, E. A., y Latham, G. P. (2002). Building a practically useful theory of goal setting and task motivation. *American Psychologist, 57*(9), 705–717. https://doi.org/10.1037/0003-066X.57.9.705
22. Gollwitzer, P. M., y Sheeran, P. (2006). Implementation intentions and goal achievement: A meta‑analysis of effects and processes. *Advances in Experimental Social Psychology, 38*, 69–119. https://doi.org/10.1016/S0065-2601(06)38002-1
23. Cirillo, F. (2018). *The Pomodoro Technique*. Currency. (Descripción original del método; no es un estudio empírico.)
24. Albulescu, P., Macsinga, I., Rusu, A., Sulea, C., Bodnaru, A., y Tulbure, B. T. (2022). "Give me a break!" A systematic review and meta‑analysis on the efficacy of micro‑breaks for increasing well‑being and performance. *PLOS ONE, 17*(8), e0272460. https://doi.org/10.1371/journal.pone.0272460
25. Ryan, R. M., y Deci, E. L. (2000). Self‑determination theory and the facilitation of intrinsic motivation, social development, and well‑being. *American Psychologist, 55*(1), 68–78. https://doi.org/10.1037/0003-066X.55.1.68
26. Mueller, C. M., y Dweck, C. S. (1998). Praise for intelligence can undermine children's motivation and performance. *Journal of Personality and Social Psychology, 75*(1), 33–52. https://doi.org/10.1037/0022-3514.75.1.33
27. Deci, E. L., Koestner, R., y Ryan, R. M. (1999). A meta‑analytic review of experiments examining the effects of extrinsic rewards on intrinsic motivation. *Psychological Bulletin, 125*(6), 627–668. https://doi.org/10.1037/0033-2909.125.6.627
28. Walker, M. P., y Stickgold, R. (2006). Sleep, memory, and plasticity. *Annual Review of Psychology, 57*, 139–166. https://doi.org/10.1146/annurev.psych.56.091103.070307
