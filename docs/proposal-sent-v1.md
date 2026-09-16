# Propuesta enviada V1

## Estado de entrega

Implementado en agents/proposal-sent-v1, desde f7dd898.
Despliegue autorizado el 2026-09-16. Make y Sheets quedan fuera del alcance.
Este documento registra la validación previa y la secuencia aprobada; el resultado del despliegue se entrega en el informe operativo.

## Comportamiento

- proposal_sent es una etapa no terminal entre appointment y converted.
- Botón y selector en Leads, etiqueta, filtro, borde violeta y timeline.
- El botón registra que la propuesta ya se ha enviado; NO envía documentos ni mensajes.
- Inicio y Resultados muestran propuestas explícitas por lead, sin inferirlas de conversiones antiguas.
- No añade ingresos ni altera los cálculos de valor, CAC o ROAS.
- Se permite conversión directa sin propuesta y descarte posterior.
- Calendar tardío registra su evento/fecha sin bajar la etapa propuesta a cita.
- La creación directa en proposal_sent y el selector genérico también conservan el evento comercial.
- Identidad Make: type + externalEventId. Reintentos con la misma identidad no duplican; reutilizarla en otro lead devuelve conflicto.
- Acción manual: una propuesta semántica por lead, protegida con bloqueo transaccional de ese lead. Los demás eventos manuales conservan su comportamiento.
- Se mantienen permisos internos y filtros de ownership existentes.
- Las tasas entre filas del funnel siguen siendo cocientes de los contadores, no tasas de transición entre conjuntos idénticos: pueden saltarse etapas.

## Contratos

Manual: POST /api/leads/{id}/commercial-events
Body: { "type": "proposal_sent" }, summary opcional.

Integración: POST /api/leads/commercial-events
Body: { "type": "proposal_sent", "leadId": "...", "externalEventId": "..." }
Admite occurredAt, summary y details opcionales, igual que qualified.
No cambia credenciales, ownership ni escenario de Make.

## Verificación

- 305 pruebas seleccionadas correctas, incluidas pruebas reales PostgreSQL de lifecycle, reintentos, concurrencia, terminales, Results y aislamiento.
- Typecheck y git diff --check correctos.
- Migraciones 0001-0016 aplicadas en PostgreSQL 17 local; constraint de stage/evento verificada por lectura. Servidor de pruebas apagado.
- Build local termina con exit 0 usando configuración pública ficticia. Windows avisa de EPERM al empaquetar el enlace node_modules en standalone; el artefacto local no se considera validado para ejecución standalone.
- Suite global final: 2065 tests correctos, 405 omitidos, 2 tests fallidos y 2 errores de limpieza de suite. El test standalone-tracing falla por el empaquetado local incompleto descrito arriba; no se considera una validación completa del artefacto ejecutable.
- Suite global: fallos previos reproducidos en copia del commit base: componentes huérfanos ConnectionCard/IntegrationCategory y limpieza de SQLite bloqueada en dos suites lead-magnet. No se han modificado esas áreas.
- El primer build falló por falta de configuración pública en el worktree aislado; el segundo utilizó placeholders sin credenciales de producción.
- Pendiente revisión visual interactiva, especialmente móvil/tablet.

## Preflight final autorizado

- main remoto y la base de la rama coinciden en f7dd898, sin divergencia.
- Producción contiene 0001-0015, todavía sin 0016; etapas existentes compatibles.
- Backup del esquema público PostgreSQL archivado fuera del repositorio, formato custom, índice legible y SHA-256 calculado. No es un backup de Supabase Auth ni del volumen SQLite, que esta migración no modifica.
- Resuelto el empaquetado local: build completo en copia aislada con dependencias físicas y sin credenciales reales. Standalone tracing correcto y 153 pruebas de contrato/presentación correctas, 2 integraciones omitidas en esa pasada (las integraciones ya constan validadas arriba).
- No se han corregido los fallos previos ajenos a esta funcionalidad de orphans y limpieza SQLite; siguen documentados para otra tarea.

## Corrección necesaria encontrada

Las pruebas PostgreSQL de Results fallaban también en el commit base porque listLeads usaba created_at sin alias junto a un JOIN con otro created_at. Se ha especificado l.created_at en los dos filtros de fecha. Las 5 pruebas que fallaban ahora pasan. No cambia la semántica del periodo.

## Secuencia de despliegue aprobada

1. Revisar diff y confirmar main/remoto actual, sin incluir operational-daily-log.
2. Backup verificable y preflight de producción.
3. Aplicar 0016 antes de publicar el código; comprobar migration record y ambas constraints.
4. Integrar rama tras verificar compatibilidad con main y publicar solo lo aprobado.
5. Esperar Railway SUCCESS y comprobar health/ready.
6. QA con un lead de prueba interno y otro cliente: propuesta, timeline, filtro, no duplicación, conversión, descarte, Results por periodo y aislamiento.
7. QA móvil/tablet: botones sin desbordamiento y seis pasos del funnel.

La migración amplía CHECKs, no elimina datos ni rellena históricos. Requiere locks DDL; programar una ventana breve. Una vez existan propuestas no volver a constraints antiguas sin un plan explícito de compatibilidad.
