# Parámetros de instalación institucional

## Qué queda definido por la versión

La versión 2.3.1 conserva los cinco perfiles y permisos de la base 2.3.0,
las cinco Facultades, los nombres esperados de los Excel, la estructura de la
base, la cuenta principal protegida y los controles de seguridad. No deben
reprogramarse durante la instalación.

Los valores que dependen de la infraestructura institucional no pueden venir
incorporados en el ZIP porque contienen dominios, credenciales o decisiones de
operación. Deben definirse antes de publicar el sistema.

## Decisiones obligatorias

| Tema | Parámetro o recurso | Valor de referencia | Quién debe definirlo |
|---|---|---|---|
| Modalidad | Docker Compose o Node.js + systemd | Docker Compose es la opción más reproducible | Infraestructura UNRC |
| Dirección pública | `PUNTOS_BASE_URL` | `https://puntos-docentes.unrc.edu.ar` | Redes / Infraestructura |
| DNS | Nombre que resolverá al servidor | El mismo host de `PUNTOS_BASE_URL` | Redes |
| HTTPS | Certificado y clave privada | Certificado institucional vigente | Redes / Seguridad |
| PostgreSQL | `DATABASE_URL` y contraseña | Base y usuario exclusivos | DBA |
| Cifrado PostgreSQL | `PUNTOS_DATABASE_SSL` | `false` en la red privada de Compose; `true` para base remota con TLS válido | DBA / Seguridad |
| OAuth de Google | `PUNTOS_GOOGLE_CLIENT_ID` | Cliente OAuth 2.0 tipo Web | Administrador Google Cloud |
| Secreto OAuth | `PUNTOS_GOOGLE_CLIENT_SECRET` | Valor entregado por Google Cloud | Administrador Google Cloud |
| Retorno OAuth | URI registrada en Google | `<PUNTOS_BASE_URL>/api/auth/google/callback` | Administrador Google Cloud |
| Regla de correo | Incorporada al sistema | `@unrc.edu.ar` y subdominios terminados en `.unrc.edu.ar` | Ya definida institucionalmente |
| Sugerencia para Google | `PUNTOS_GOOGLE_HOSTED_DOMAIN_HINT` | `*`, para no limitar el selector a un solo subdominio | Administrador Google Cloud; no reemplaza la validación del servidor |
| Secreto de sesión | `PUNTOS_AUTH_SECRET` | Generar con `npm run security:secret` | Administrador del servidor |
| Administrador principal | `PUNTOS_INITIAL_ADMIN_EMAIL` | `rtorrespicco@ac.unrc.edu.ar` | Autoridad funcional |
| Nombre del administrador | `PUNTOS_INITIAL_ADMIN_NAME` | `Ramiro Torres Picco` | Autoridad funcional |
| Carpeta de Drive | `PUNTOS_DRIVE_FOLDER_ID` | ID de la carpeta oficial compartida | Responsable funcional |
| Lector de Drive | `GOOGLE_APPLICATION_CREDENTIALS` | Archivo JSON de una cuenta de servicio lectora | Administrador Google Cloud |
| Salida a Internet | Firewall/proxy | HTTPS hacia Google Identity, OAuth y Drive API | Redes |
| Respaldo | Destino, frecuencia y retención | PostgreSQL + volumen de datos + configuración cifrada | Infraestructura / Seguridad |

## Parámetros con valores predeterminados

Estos valores pueden mantenerse inicialmente y modificarse en el archivo de
entorno cuando la política institucional lo requiera.

| Variable | Predeterminado | Función |
|---|---:|---|
| `PORT` | `3000` | Puerto interno de Next.js; no debe publicarse directamente a Internet |
| `TZ` | `America/Argentina/Buenos_Aires` | Zona horaria operativa |
| `PUNTOS_COOKIE_SECURE` | `true` | Obliga cookies sólo por HTTPS |
| `PUNTOS_SESSION_IDLE_MINUTES` | `30` | Cierre por inactividad |
| `PUNTOS_SESSION_ABSOLUTE_HOURS` | `8` | Duración máxima de una sesión |
| `PUNTOS_REAUTH_MINUTES` | `10` | Vigencia de la confirmación para cambios críticos |
| `PUNTOS_SYNC_INTERVAL_SECONDS` | `60` | Frecuencia de consulta liviana de metadatos; sólo se descarga el Excel modificado |
| `PUNTOS_MAX_FILE_MB` | `10` | Tamaño máximo de cada Excel |
| `PUNTOS_ORIGINAL_RETENTION` | `20` | Copias originales por Facultad, además de la vigente protegida |
| `PUNTOS_DATA_DIR` | `/var/lib/control-puntos-docentes` | Estado, historial y originales persistentes |

## Archivos institucionales esperados

La carpeta de Google Drive debe compartir permiso de **Lector** con la cuenta de
servicio y contener como máximo un archivo vigente con cada nombre:

| Facultad | Archivo |
|---|---|
| Agronomía y Veterinaria | `PUFAV.xlsx` |
| Ciencias Exactas Fco. Qcas. y Naturales | `PUEXA.xlsx` |
| Ingeniería | `PUINGE.xlsx` |
| Ciencias Económicas | `PUECON.xlsx` |
| Ciencias Humanas | `PUHUM.xlsx` |

## Datos que nunca deben enviarse dentro del ZIP

- archivo `.env` completo;
- contraseña de PostgreSQL;
- `PUNTOS_AUTH_SECRET`;
- secreto del cliente OAuth;
- clave JSON de la cuenta de servicio;
- certificados privados;
- copias de la base, Excel o historial real.

El paquete incluye `.env.example` únicamente como plantilla. La comprobación
`npm run verify:package` rechaza los nombres de credenciales y archivos de
estado que no deben integrar una distribución.

## Condición para declarar la puesta en producción

La instalación queda técnicamente habilitada cuando:

1. `npm run verify:config` finaliza sin errores;
2. `/api/salud` responde con estado `ok`, versión `2.3.1` y base institucional `2.3.0`;
3. el Administrador General ingresa con Google Workspace;
4. se comprueba cada perfil con una cuenta institucional de prueba;
5. una actualización de Drive se detecta dentro del intervalo configurado,
   procesa sólo el Excel modificado, deja historial y conserva la última versión válida;
6. se realiza y restaura al menos una copia de seguridad de prueba.
7. las estadísticas muestran el ingreso, la consulta y el informe realizados
   por una cuenta institucional de prueba.
