# Validación de la entrega institucional

## Identificación

- Sistema: Control de Puntos Docentes UNRC.
- Versión: 2.3.1 institucional.
- Base institucional exclusiva: 2.3.0.
- Fecha de preparación: 15 de agosto de 2026.
- Base funcional: 2.1.7.
- Edición: detección eficiente de cambios en Google Drive.

## Controles completados sobre el paquete

- 45 pruebas automatizadas aprobadas;
- análisis estático ESLint aprobado;
- validación TypeScript aprobada;
- compilación optimizada de Next.js aprobada;
- generación del runtime autónomo aprobada;
- auditoría npm de dependencias productivas: 0 vulnerabilidades detectadas;
- compilación de las nuevas rutas de estadísticas y registro de actividad;
- comparación previa de ID, versión, fecha, tamaño y MD5 de cada Excel;
- omisión comprobada de descargas cuando el contenido no cambió;
- detección comprobada de reemplazos y modificaciones reales;
- compatibilidad comprobada con el estado persistente de la versión 2.3.0;
- reintentos exponenciales comprobados para respuestas 429 y 5xx de Drive;
- regla de correo institucional validada para el dominio raíz y subdominios
  terminados en `.unrc.edu.ar`;
- migración incremental `003` incorporada sin modificar las migraciones ya
  publicadas de la versión 2.2.1;
- validación de actividades generales, actividades por Facultad y rechazo de
  combinaciones inválidas;
- control de que la estadística funcional no exponga direcciones IP;
- tablas, restricciones y protección del Administrador General verificadas;
- comprobación de ausencia de `.env`, credenciales JSON, datos e historial real;
- sintaxis del punto de entrada de Docker validada.

## Controles que corresponden al servidor institucional

No pueden completarse dentro del paquete porque requieren recursos y secretos
que sólo posee la UNRC:

- resolución DNS y certificado HTTPS definitivo;
- conexión a la instancia PostgreSQL seleccionada;
- cliente OAuth real de Google Workspace;
- política de segundo factor aplicada por Workspace;
- credencial lectora y permiso efectivo sobre la carpeta oficial de Drive;
- reglas institucionales de firewall, proxy y copias de seguridad;
- prueba de aceptación con cuentas reales representativas de cada perfil.

La versión es **instalable y funcionalmente cerrada**. La declaración de puesta
en producción se obtiene después de completar esos parámetros y la lista de
verificación funcional de `INSTALACION-V2.3.1.md`. Esto diferencia la
integridad del software de la habilitación de una infraestructura concreta.
