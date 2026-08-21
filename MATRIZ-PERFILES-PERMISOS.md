# Matriz de perfiles, permisos y alcances

## Principio general

El alcance determina **qué Facultades puede ver** una persona. El permiso
determina **qué acciones puede realizar**. Tener alcance institucional total no
implica poder actualizar archivos.

| Función | Administrador General | Operador DGPFP | Responsable Facultad | Consulta General Institucional | Consulta Facultad |
|---|---:|---:|---:|---:|---:|
| Ver tablero autorizado | Sí, todas | Sí, todas | Sólo asignadas | Sí, todas | Sólo asignadas |
| Generar PDF individual | Sí | Sí | Sólo asignadas | Sí | Sólo asignadas |
| Generar PDF consolidado | Sí | Sí | No | Sí | No |
| Ver actividad de la sesión | Sí, todas | Sí, todas | Sólo asignadas | No | No |
| Ver historial completo | Sí | Sí | No | No | No |
| Ejecutar **Verificar ahora** | Sí | Sí | No | No | No |
| Administrar usuarios | Sí | No | No | No | No |
| Consultar auditoría de seguridad | Sí | No | No | No | No |

## Protección adicional

- Sólo el Administrador General principal protegido puede designar otro
  Administrador General.
- El Administrador General principal no puede suspenderse, darse de baja,
  perder su perfil ni modificar su correo desde la interfaz.
- Ningún usuario puede modificar su propia autorización.
- Todo perfil de Facultad exige al menos una Facultad asignada.
- Un perfil institucional no admite alcances individuales redundantes.
- Las reglas se aplican en la API, en la capa de autorización y, para las
  invariantes centrales, también en PostgreSQL.

## Actualización automática

La consulta periódica de Drive es una tarea del servidor. Un perfil de consulta
puede ver datos nuevos una vez validados, pero su ingreso o navegación no inicia
el reprocesamiento de archivos. La consulta manual sólo puede activarse con el
permiso `sync:manual`.

