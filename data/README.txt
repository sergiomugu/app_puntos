Esta carpeta es sólo una referencia y no contiene datos reales.

Docker Compose utiliza el volumen persistente app_data. En una instalación
directa, el estado, el historial y las copias privadas de los Excel deben
guardarse fuera del código, en el directorio indicado por PUNTOS_DATA_DIR. La
ruta recomendada es /var/lib/control-puntos-docentes.

No incorporar state.json, state.backup.json ni originales al ZIP o al repositorio.

La aplicación conserva por defecto las últimas 20 copias originales por
Facultad y protege siempre la versión válida vigente. El límite se configura
con PUNTOS_ORIGINAL_RETENTION.
