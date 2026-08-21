# Manual operativo de Gestión de usuarios

## 1. Ingreso al módulo

1. Ingresar al sistema con la cuenta institucional.
2. Seleccionar **Gestión de usuarios** en el encabezado.
3. El módulo sólo se abrirá si la sesión posee el permiso administrativo.
4. Si la última autenticación tiene más de diez minutos, utilizar **Verificar mi
   identidad** antes de guardar una acción crítica.

La confirmación vuelve a Google Workspace y rota la sesión. No solicita ni
guarda contraseñas dentro del sistema.

## 2. Alta

1. Seleccionar **Nuevo usuario**.
2. Ingresar el correo institucional. Puede ser `@unrc.edu.ar` o utilizar un
   subdominio terminado en `.unrc.edu.ar`, por ejemplo `@ac.unrc.edu.ar`,
   `@eco.unrc.edu.ar`, `@exa.unrc.edu.ar` o `@ing.unrc.edu.ar`.
3. Elegir el perfil.
4. Si el perfil es de Facultad, asignar una o más Facultades.
5. Definir vigencia cuando corresponda.
6. Registrar un motivo administrativo.
7. Confirmar **Autorizar usuario**.

El estado inicial será **Pendiente de primer acceso**. Cuando la persona ingrese
con Google, el sistema validará `hd`, correo verificado y `sub`, vinculará la
identidad estable y cambiará el estado a **Activo**. Una cuenta institucional no
autorizada previamente será rechazada.

## 3. Cambio de perfil o alcance

1. Localizar al usuario mediante los filtros.
2. Seleccionar **Editar**.
3. Modificar perfil, Facultades o vigencia.
4. Registrar el motivo.
5. Guardar.

La operación registra valores anteriores y nuevos, y revoca inmediatamente
todas las sesiones activas. El nuevo acceso rige al volver a ingresar.

## 4. Suspensión transitoria

Usar **Suspender** para licencias, reemplazos o una interrupción preventiva.
El motivo es obligatorio. La suspensión:

- impide nuevos ingresos;
- cierra todas las sesiones vigentes;
- mantiene el perfil, los datos y la auditoría;
- puede revertirse mediante **Reactivar**.

No hay reactivación automática por fecha: la decisión permanece bajo el
Administrador General.

## 5. Baja lógica

Usar **Baja** cuando finaliza la autorización. La operación no elimina al
usuario ni sus acciones anteriores. Revoca sesiones, bloquea el ingreso y
preserva nombre, identidad, eventos e informes históricos.

Si la persona regresa, utilizar **Reincorporar**. Deben definirse nuevamente
perfil, alcance, vigencia y motivo. La reincorporación queda como un evento
administrativo nuevo.

## 6. Estadísticas de acceso

La pestaña **Estadísticas de acceso** concentra información general e
individual de utilización:

- usuarios registrados, activos en los últimos 30 días y que nunca ingresaron;
- ingresos exitosos de los últimos 30 días;
- consultas de Facultades e historiales;
- informes PDF individuales y consolidados;
- evolución diaria de los últimos 14 días y evolución mensual del último año;
- primer acceso, último acceso, última actividad, ingresos acumulados y días
  distintos de utilización de cada persona.

Seleccionar **Ver historial** para consultar los últimos ingresos y actividades
funcionales del usuario. La pantalla estadística no muestra direcciones IP.
Estas permanecen restringidas a la auditoría de seguridad.

**Exportar para Excel** descarga un archivo CSV con separador compatible con la
configuración regional argentina. Puede abrirse directamente con Excel.

Los accesos históricos provienen de la auditoría ya existente. Las consultas e
informes comienzan a contabilizarse desde la instalación de la versión 2.3.0.

## 7. Auditoría

La pestaña **Auditoría de seguridad** muestra los últimos 100 eventos con:

- fecha y hora;
- acción y resultado;
- actor y usuario afectado;
- motivo;
- dirección IP de origen.

PostgreSQL conserva además valores anteriores, nuevos, agente del navegador y
metadatos de sesión. La aplicación no ofrece acciones de edición ni borrado y
la base rechaza actualizaciones o eliminaciones sobre la tabla de auditoría.

## 8. Estados

| Estado | Significado | Próxima acción posible |
|---|---|---|
| Pendiente | Autorizado, aún sin primer acceso | Ingresar, editar, suspender o baja |
| Activo | Identidad vinculada y acceso vigente | Editar, suspender o baja |
| Suspendido | Interrupción transitoria | Reactivar o baja |
| Baja | Autorización finalizada | Reincorporar |

## 9. Cuenta principal protegida

`rtorrespicco@ac.unrc.edu.ar` se crea como Administrador General principal. No
puede modificarse, suspenderse ni darse de baja desde la interfaz. Sólo esta
cuenta puede otorgar el perfil Administrador General a otra persona.
