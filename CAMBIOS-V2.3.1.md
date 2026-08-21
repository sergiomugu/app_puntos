# Cambios de la versión institucional 2.3.1

## Base y alcance

La versión 2.3.1 fue construida exclusivamente sobre la versión institucional
2.3.0. No reemplaza ni elimina ninguna función de usuarios, perfiles,
estadísticas, auditoría, tablero, validación, historial o generación de PDF.

## Detección eficiente de Google Drive

- consulta los metadatos de la carpeta cada 60 segundos;
- compara nombre, ID, versión, fecha de modificación, tamaño y MD5;
- no descarga los Excel cuyo contenido no cambió;
- descarga y valida solamente el archivo modificado;
- detecta el reemplazo de un archivo por otro con el mismo nombre;
- registra también los archivos rechazados para no procesarlos repetidamente;
- vuelve a procesar un rechazo cuando cambia la versión del validador;
- conserva la última versión válida ante errores o rechazos;
- mantiene el botón **Verificar ahora** con la misma lógica eficiente.

## Recuperación ante fallas transitorias

Las consultas y descargas reintentan respuestas temporales de Drive (429, 500,
502, 503 y 504) con pausas progresivas de 2, 4, 8, 16 y 32 segundos, más una
pequeña variación aleatoria. Los errores permanentes de credenciales, permisos
o archivo inexistente se informan sin generar reintentos innecesarios.

## Compatibilidad

No requiere una migración nueva de PostgreSQL. Puede instalarse sobre 2.3.0
conservando `.env`, credenciales externas, volúmenes, usuarios, auditoría,
estadísticas, estado, historial y originales.
