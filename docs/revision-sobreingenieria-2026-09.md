# Revisión de sobreingeniería — septiembre de 2026

Revisión estática de los cambios acumulados, incluidos archivos nuevos, frente
a la versión base. No se encontró sobreingeniería estructural: las protecciones
de sesiones, cancelación, miniaturas, ACE y compatibilidad Windows responden a
problemas concretos. Parte del volumen del diff proviene de dependencias,
del SDK 7-Zip y del formato aplicado por las migraciones de Angular.

El usuario considera menores las oportunidades siguientes y decide diferirlas
para continuar con las pruebas Windows. No bloquean esa validación y no se
implementaron durante esta revisión:

- **Pruebas:** `scripts/test-all.cjs` compila nativos locales y portables y
  ejecuta suites Bash y Node con cobertura parcialmente coincidente. Distinguir
  mejor la comprobación rápida de la exhaustiva y evaluar la consolidación de
  casos equivalentes después de Windows. Conservar las comprobaciones propias
  de cada distribución, entorno y artefacto.
- **Limpieza ACE:** `ExtractionCleanup` ya elimina el directorio temporal al
  salir, pero persisten eliminaciones explícitas del mismo directorio. Retirar
  solo las redundantes, conservando la limpieza por entrada y cualquier orden
  necesario respecto a los eventos emitidos.
- **Contratos antiguos:** `PageData`, `OpenFileSession` y `REQUEST_PAGE_PATH`
  solo aparecen en sus declaraciones. Son restos previos; se puede evaluar
  retirarlos para aclarar el contrato vigente.

Se mantienen los controles de aperturas y sesiones: petición pendiente,
generación y sesión protegen momentos diferentes del flujo asíncrono. También
se mantienen las comprobaciones ACE del listado, presupuesto antes de escribir
y tamaño final, la reutilización acotada del lector CB7 y el control de procesos
Windows. No se propone introducir una máquina de estados, nuevos servicios ni
una infraestructura general de caché. El visor concentra complejidad previa,
pero no justifica por sí solo un rediseño en esta etapa.

No se ejecutaron nuevas pruebas por esta revisión. La validación Windows sigue
la guía [Windows](windows.md), primero Windows 11 y después Windows 10, una VM
a la vez. Continúa vigente la prohibición de commits, push y publicación.
