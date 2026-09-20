# Runbook operativo de REKREOS

Este documento reúne la rutina mínima para operar REKREOS con clientes reales.
La fuente diaria de verdad es el panel **Integraciones → Panel central de incidencias**.

## 1. Panel central de incidencias

El panel solo muestra señales observadas en PostgreSQL:

- **Meta**: diferencia entre leads reportados por Meta y leads recibidos en REKREOS, además de errores explícitos de sincronización.
- **WhatsApp**: envíos marcados como fallidos y leads sin un envío, entrega o respuesta confirmada.
- **Mappings**: leads de Meta que no pudieron quedar atribuidos a una cuenta o campaña conocida.

La ausencia de actividad no se interpreta como un fallo. Si el panel está vacío, hay que confirmar la fecha de última actividad en Estado real de REKREATIVE y revisar Make antes de concluir que todo está operativo.

## 2. Prueba controlada en producción

La prueba se ejecuta con un único lead identificado como `PRUEBA CONTROLADA - AAAA-MM-DD`.

1. Confirmar que los escenarios de REKREOS están activos y que no hay ejecuciones incompletas en Make.
2. Crear o enviar un único lead de prueba desde el formulario de Meta acordado.
3. Comprobar el recorrido completo: Meta → Make → REKREOS → Google Sheets → WhatsApp.
4. Confirmar en REKREOS los eventos `lead_received`, `ai_analyzed` y `whatsapp_sent` o `whatsapp_failed`.
5. Cambiar el estado del mismo lead por las rutas comerciales acordadas: cualificado, cita, propuesta enviada y conversión. Validar también cancelada y no-show cuando corresponda.
6. Revisar calendario, hoja y panel de incidencias. Guardar hora, identificador del lead y resultado.
7. Borrar o archivar el lead de prueba solo después de conservar el resultado de la prueba.

No se debe ejecutar esta prueba sin confirmar expresamente el envío real de WhatsApp y la creación de actividad de calendario.

## 3. Monitorización y cadencia

- **Continuo**: Railway comprueba `GET /api/health` como liveness.
- **Antes de trabajar**: comprobar `GET /api/ready` y el panel central de incidencias.
- **Cada 12 horas**: confirmar que el escenario de métricas de Meta sigue programado en Make y que existe una sincronización reciente.
- **Diario**: revisar diferencias Meta, WhatsApp sin confirmación, mappings y leads calientes sin contactar.
- **Tras cada cambio**: ejecutar una comprobación controlada y anotar el resultado en el registro operativo.

Los endpoints de salud no exponen credenciales. El panel tampoco muestra tokens, URLs de conexión ni datos personales del lead.

## 4. Copias y recuperación

La copia de SQLite de producción se genera con:

```powershell
npm run backup:production -- -DestinationRoot C:\Users\Kilian\REKREOS-Backups
```

El script ejecuta la copia en Railway, descarga el manifiesto y snapshots, verifica integridad y conserva un `latest-status.json`. Si falla, no se debe borrar la carpeta `.failed-*` hasta revisar el motivo.

La copia debe quedar fuera del volumen de Railway. Antes de cualquier reset o restauración hay que tener una copia verificada y comprobar después `/api/health`, `/api/ready` y los datos restaurados. PostgreSQL/Supabase mantiene su propia política de backups; los cambios de esquema deben pasar por migración y nunca por una edición manual de producción.

## 5. Registro de incidencias

Para cada incidencia guardar:

- fecha y hora en Madrid;
- categoría: Meta, WhatsApp, mapping o sistema;
- escenario de Make y última ejecución conocida;
- identificador técnico sin incluir tokens;
- acción tomada y resultado;
- si requiere repetir la prueba controlada.

El objetivo es poder distinguir un retraso de Meta, una ejecución fallida de Make y un dato que nunca llegó a REKREOS.
