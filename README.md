# Control de Puntos Docentes UNRC

## v2.3.1 · Detección eficiente de cambios en Google Drive

Esta versión toma como base exclusiva e íntegra la edición institucional
`v2.3.0`. Conserva la identidad mediante Google Workspace, la autorización por
perfil y Facultad, las sesiones revocables en PostgreSQL, la auditoría
inalterable y las estadísticas generales e individuales de utilización.

La consulta automática de los cinco Excel se mantiene cada 60 segundos, pero
ahora compara primero ID, versión, fecha, tamaño y MD5. Sólo descarga y valida
el Excel cuyo contenido cambió. Ante errores temporales de Drive aplica
reintentos progresivos y conserva siempre la última versión válida.

Este directorio corresponde a la **edición institucional instalable**. No usa
la autenticación de `chatgpt.site` ni almacenamiento local del navegador para
usuarios. La habilitación productiva requiere completar los parámetros de la
infraestructura UNRC y ejecutar la verificación incluida.

### Decisiones institucionales implementadas

- Google Workspace es el único método de ingreso.
- Sólo se aceptan identidades verificadas cuyo correo sea `@unrc.edu.ar` o
  pertenezca a un subdominio válido terminado en `.unrc.edu.ar`, como
  `@ac.unrc.edu.ar`, `@eco.unrc.edu.ar`, `@exa.unrc.edu.ar` o
  `@ing.unrc.edu.ar`.
- No existe registro público: cada correo debe ser autorizado previamente.
- Ramiro Torres Picco es el Administrador General principal protegido.
- Las contraseñas no ingresan ni se almacenan en esta aplicación.
- Los permisos se verifican en el servidor y se deniegan por defecto.
- Los cambios críticos revocan todas las sesiones del usuario afectado.
- La baja es lógica y conserva íntegramente la trazabilidad.
- La auditoría no puede modificarse ni eliminarse desde la aplicación.
- **Verificar ahora** queda limitado a Administrador General y Operador DGPFP.
- La verificación periódica y manual evita descargas de archivos sin cambios.
- Consulta General Institucional ve las cinco Facultades en modo de sólo lectura.
- El Administrador General dispone de estadísticas de primer y último acceso,
  ingresos totales y recientes, días de utilización, última actividad,
  consultas e informes por usuario.
- El resumen general informa usuarios registrados, activos en 30 días, personas
  que nunca ingresaron y evolución diaria y mensual.
- El detalle estadístico puede exportarse como CSV compatible con Excel.
- La estadística funcional no muestra direcciones IP; la IP permanece sólo en
  la auditoría de seguridad con acceso administrativo.

### Componentes

- Next.js 16 y Node.js 22 o posterior.
- PostgreSQL para usuarios, alcances, sesiones, límites y auditoría.
- Registro inalterable de actividad funcional para consultas e informes.
- Google OpenID Connect con `state`, `nonce`, PKCE y validación de `sub`/`hd`.
- Cuenta de servicio de Google Drive separada, únicamente lectora.
- Cookies `__Host-`, `Secure`, `HttpOnly`, `SameSite` y tokens opacos.
- Sesión: 30 minutos de inactividad y 8 horas máximas.
- Reautenticación reciente para altas, cambios, suspensiones y bajas.
- CSP con nonce, HTTPS/HSTS y protección CSRF por sesión y origen.

### Documentación incluida

- `INSTALACION-V2.3.1.md`: despliegue, actualización, PostgreSQL y Google Cloud.
- `CAMBIOS-V2.3.1.md`: alcance exacto de la optimización de Google Drive.
- `VERSION-INSTITUCIONAL.txt`: identificación inequívoca de la entrega.
- `PARAMETROS-INSTALACION.md`: decisiones y valores que debe suministrar la UNRC.
- `VALIDACION-ENTREGA.md`: controles ejecutados y alcance de la aprobación final.
- `MANUAL-GESTION-USUARIOS.md`: operatoria del Administrador General.
- `MATRIZ-PERFILES-PERMISOS.md`: perfiles, acciones y alcances exactos.
- `.env.example`: variables requeridas sin secretos reales.

### Preparación resumida

```bash
npm ci
npm run db:prepare
npm run verify:release
npm run verify:config
npm start
```

La aplicación no contiene clave JSON, secreto OAuth, contraseña de PostgreSQL,
usuarios secundarios, Excel, estado ni historial real.
