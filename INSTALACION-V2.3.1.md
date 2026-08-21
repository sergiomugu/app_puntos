# Instalación institucional v2.3.1

Esta revisión deriva exclusivamente de la versión institucional 2.3.0. Mantiene
usuarios, perfiles, auditoría, estadísticas y validaciones, y optimiza la
detección de cambios de los cinco Excel en Google Drive.

## 1. Arquitectura

El proxy institucional publica HTTPS y reenvía a Next.js en
`127.0.0.1:3000`. PostgreSQL no se publica a Internet. Google Workspace
autentica personas; una cuenta de servicio diferente consulta Drive en modo
lector.

```text
Navegador HTTPS → proxy → aplicación → PostgreSQL
                         ├──────────→ Google Workspace (identidad)
                         └──────────→ Google Drive (lectura de Excel)
```

La identidad de usuario y la credencial lectora de Drive son mecanismos
separados. El inicio de sesión no concede al sistema acceso al Drive personal de
la persona.

## 2. Requisitos

- Linux, Node.js 22.13 o posterior y npm.
- PostgreSQL 16 o posterior, o Docker Compose incluido.
- Nginx/Apache/proxy con certificado institucional.
- Salida HTTPS a los servicios de Google.
- Acceso administrativo a Google Cloud y Google Workspace.
- La clave JSON lectora de Drive ya documentada, fuera del paquete.

Antes de instalar, completar la hoja `PARAMETROS-INSTALACION.md`. Los valores
de infraestructura no se generan automáticamente porque la URL, las
credenciales, el certificado y el destino de respaldos pertenecen a la UNRC.

## 3. Cliente OAuth en Google Cloud

1. Abrir el proyecto de Google Cloud definido institucionalmente.
2. Configurar Google Auth Platform con audiencia **Internal** cuando el dominio
   Workspace lo permita.
3. Crear un cliente OAuth 2.0 de tipo **Web application**.
4. Registrar como origen autorizado la URL pública exacta, por ejemplo:
   `https://puntos-docentes.unrc.edu.ar`.
5. Registrar como URI de redirección exacta:
   `https://puntos-docentes.unrc.edu.ar/api/auth/google/callback`.
6. Resguardar Client ID y Client Secret en el archivo de entorno del servidor.

El sistema solicita únicamente `openid`, `email` y `profile`. No solicita
permisos delegados de Drive. El parámetro `hd` mejora la selección de cuenta,
pero no autoriza por sí mismo. La seguridad real valida en el servidor `hd`,
`email_verified`, audiencia, firma, vencimiento, `nonce`, el identificador
estable `sub` y el dominio del correo. Se admite `@unrc.edu.ar` y cualquier
subdominio DNS válido terminado en `.unrc.edu.ar`.

Se recomienda mantener `PUNTOS_GOOGLE_HOSTED_DOMAIN_HINT=*`. El asterisco evita
limitar el selector de Google a `ac`, `eco`, `exa`, `ing` u otro único dominio.
Una cuenta que no cumpla la regla UNRC será rechazada posteriormente por el
servidor aunque Google permita seleccionarla.

## 4. Segundo factor

Google Workspace debe exigir verificación en dos pasos para el grupo que usa el
sistema, preferentemente passkey o llave de seguridad. Como mínimo debe ser
obligatoria para Administradores Generales y Operadores DGPFP. Esta política se
administra en Workspace; la aplicación no puede sustituirla ni conocer el
segundo factor.

## 5. Variables

Copiar `.env.example` a un archivo protegido fuera del código:

```bash
sudo install -m 640 -o root -g controlpuntos .env.example \
  /etc/control-puntos-docentes/control-puntos-docentes.env
```

Reemplazar todos los valores `REEMPLAZAR`. Generar el secreto de autenticación:

```bash
npm run security:secret
```

No reutilizar la contraseña de PostgreSQL como secreto OAuth. Mantener
`PUNTOS_COOKIE_SECURE=true` y una URL HTTPS.

## 6. PostgreSQL

Crear base y usuario exclusivos. La cuenta de aplicación necesita operar sus
tablas, pero la base no debe escuchar en una interfaz pública. Ejecutar:

```bash
set -a
source /etc/control-puntos-docentes/control-puntos-docentes.env
set +a
npm ci
npm run db:migrate
npm run db:bootstrap
```

El bootstrap crea o verifica exclusivamente a:

- correo: `rtorrespicco@ac.unrc.edu.ar`;
- nombre: Ramiro Torres Picco;
- perfil: Administrador General;
- condición: principal protegido y activo.

Las migraciones poseen checksum y se niegan a continuar si un archivo ya
aplicado fue modificado.

### Actualización desde 2.3.0

No modificar ni reemplazar las migraciones existentes. Copiar la versión 2.3.1
sobre el directorio de aplicación conservando fuera del código el archivo de
entorno, la credencial Drive y los volúmenes persistentes. Luego ejecutar:

```bash
npm ci
npm run db:migrate
npm run db:bootstrap
npm run verify:config
```

La actualización 2.3.1 no agrega ni modifica migraciones de PostgreSQL. Los
usuarios, sesiones, auditoría, estadísticas, estado, historial y originales de
la versión 2.3.0 se conservan. El primer control reutiliza los identificadores y
fechas ya registrados; después guarda la huella liviana de Drive para evitar
descargas innecesarias.

## 7. Compilación y control

```bash
npm run verify:release
npm run verify:config
```

La verificación comprueba entorno, HTTPS, dominio, longitud de secretos,
credencial lectora, directorio persistente, conexión PostgreSQL, tablas y
Administrador General principal protegido. La verificación de la versión
también ejecuta pruebas, análisis estático, compilación y control de que el
paquete no contenga credenciales ni estado real.

## 8. Servicio

El archivo `deploy/systemd/control-puntos-docentes.service` ejecuta migraciones
y bootstrap antes del arranque. Ajustar rutas si Node/npm se instalaron fuera
de `/usr/bin`.

```bash
sudo cp deploy/systemd/control-puntos-docentes.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now control-puntos-docentes
```

El endpoint `/api/salud` debe indicar versión `2.3.1`, base institucional
`2.3.0`, base de datos saludable, autenticación configurada y Drive disponible.

## 9. Docker Compose

El archivo `compose.yaml` levanta PostgreSQL con checksums y la aplicación sin
publicar el puerto de la base. Esta modalidad crea volúmenes persistentes para
PostgreSQL y para el estado del tablero.

Preparar la configuración:

```bash
cp .env.example .env
chmod 600 .env
install -d -m 700 secrets
install -m 400 /ruta-segura/google-drive-reader.json \
  secrets/google-drive-reader.json
```

Editar `.env`, reemplazar todos los marcadores y validar la composición antes
de iniciarla:

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

La aplicación ejecuta migraciones y bootstrap antes de iniciar el servidor. El
puerto queda limitado a `127.0.0.1:3000`; Nginx o el proxy institucional debe
ser el único punto de acceso externo.

Después del arranque:

```bash
curl --fail --silent http://127.0.0.1:3000/api/salud
docker compose logs --tail=100 control-puntos-docentes
```

## 10. Copias de seguridad

Respaldar conjuntamente:

- PostgreSQL mediante `pg_dump` cifrado y probado;
- `/var/lib/control-puntos-docentes`;
- archivo de entorno y credencial Drive mediante custodia segura.

Probar periódicamente una restauración. La copia de PostgreSQL contiene datos
de identidad, auditoría y estadísticas de utilización; debe tener acceso
restringido y una política formal de retención.

Ejemplo de extracción de los dos componentes en Docker:

```bash
docker compose exec -T postgres pg_dump -U controlpuntos \
  -d control_puntos_docentes -Fc > control_puntos_docentes.dump
docker compose exec -T control-puntos-docentes \
  tar -C /var/lib/control-puntos-docentes -czf - . > control_puntos_datos.tgz
```

No almacenar estos archivos sin cifrado ni comprobar un respaldo únicamente
por su existencia: debe ensayarse la restauración en un entorno aislado.

## 11. Verificación funcional mínima

1. Ingresar con la cuenta principal protegida.
2. Crear un usuario Consulta General Institucional.
3. Confirmar que ve cinco Facultades y no posee **Verificar ahora**.
4. Crear Consulta de Facultad y asignar sólo ECO.
5. Confirmar que la API y la pantalla sólo entregan ECO.
6. Crear Operador DGPFP y confirmar la verificación manual.
7. Cambiar un perfil y confirmar el cierre de su sesión anterior.
8. Suspender, reactivar, dar de baja y reincorporar un usuario de prueba.
9. Revisar cada evento en Auditoría.
10. Confirmar que la cuenta principal no ofrece acciones de modificación.
11. Abrir **Estadísticas de acceso** y verificar el resumen y el detalle del
    usuario de prueba.
12. Consultar una Facultad, generar un PDF y confirmar que ambos contadores se
    actualizan.
13. Exportar las estadísticas y abrir el archivo CSV en Excel.
14. Modificar solamente uno de los cinco Excel oficiales en Drive y confirmar
    que el tablero lo detecta dentro de aproximadamente 60 segundos.
15. Confirmar que las otras cuatro Facultades no generaron nuevas versiones ni
    descargas por esa modificación.

La aprobación productiva debe registrar fecha, versión, responsable técnico,
resultado de estas pruebas y ubicación del respaldo de recuperación.

## 12. Referencias técnicas

- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
