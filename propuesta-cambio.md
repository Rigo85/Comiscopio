# Plan De Ejecucion: Worker Nativo Para CBR

## Objetivo

Reorientar el procesamiento de `cbr` hacia un worker nativo externo, portable y autocontenido, que haga en una sola pasada:

- descompresion del contenedor
- decodificacion de la imagen
- generacion de miniatura
- generacion de version reducida para el lector cuando aplique
- escritura de artefactos listos para consumo por la app

La aplicacion Electron/Angular debe dejar de hacer trabajo pesado de imagen y pasar a consumir resultados estables desde disco.

## Estado Actual

Hoy el proyecto ya tiene:

- apertura de `cbr` dentro de Electron
- extraccion a directorio temporal
- generacion de miniaturas fuera del renderer
- cache de paginas reducidas para el lector
- instrumentacion de tiempos y memoria

Componentes relevantes ya existentes:

- [`electron/file-handler.ts`](/media/work/OneDrive/Personal-Git/Comiscopio/electron/file-handler.ts)
- [`electron/thumbnail-manager.ts`](/media/work/OneDrive/Personal-Git/Comiscopio/electron/thumbnail-manager.ts)
- [`src/app/services/page-cache.service.ts`](/media/work/OneDrive/Personal-Git/Comiscopio/src/app/services/page-cache.service.ts)
- [`src/app/services/thumbnail-cache.service.ts`](/media/work/OneDrive/Personal-Git/Comiscopio/src/app/services/thumbnail-cache.service.ts)

Estado funcional actual:

- las miniaturas ya se muestran
- el lector funciona
- el archivo grande de prueba sigue siendo pesado
- existen problemas de complejidad y un error Angular de sincronizacion en el panel de miniaturas

## Problemas Detectados

### 1. La extraccion sigue siendo un costo importante

Los tiempos de apertura muestran que gran parte del tiempo total se va en descompresion/extraccion del contenedor.

### 2. Se sigue pagando demasiado por pagina

Los logs muestran que:

- `decodeMs` domina el costo de miniaturas
- `resizeMs` no es el cuello principal
- `encodeMs` suele ser bajo
- `writeMs` tiene picos, pero no domina siempre

Interpretacion:

- el problema principal no es el resize
- el problema principal es abrir y decodificar imagenes grandes demasiadas veces

### 3. La app sigue cargando demasiada logica de procesamiento

Aunque parte del trabajo salio del renderer, Electron sigue asumiendo:

- orquestacion de extraccion
- transporte de miniaturas
- colas
- cache
- transformacion parcial para el lector

Eso hace mas dificil:

- medir
- depurar
- simplificar UX
- aislar problemas

### 4. La arquitectura actual sigue penalizando archivos de 1000+ paginas

Para archivos muy grandes, aunque la generacion de miniaturas mejoro, el sistema sigue sintiendose pesado porque:

- la pagina original es muy grande
- la decodificacion es cara
- el trabajo se reparte entre varias capas

## Direccion Elegida

### Camino Decidido

**Worker externo + UnRAR + libvips**

Esta propuesta asume:

- worker nativo por plataforma
- extractor basado en `UnRAR`
- pipeline de imagen basado en `libvips`
- la app como consumidora de archivos ya generados

## Por Que Este Camino

### UnRAR

Se elige `UnRAR` porque la prioridad aqui es:

- compatibilidad practica con `rar/rar5`
- buen comportamiento con `cbr`
- evitar abrir otro frente de compatibilidad mientras se redefine la arquitectura

No se esta optimizando por pureza de licencia sino por viabilidad tecnica y tiempo de salida.

### libvips

Se elige `libvips` porque:

- es fuerte en rendimiento
- es eficiente en memoria
- sirve muy bien para pipelines de imagen
- es una mejor apuesta que seguir dependiendo de transformaciones indirectas dentro de Electron

### Worker externo

Se elige proceso externo y no addon Node como primera opcion porque:

- aisla crashes
- simplifica profiling
- reduce acoplamiento con Electron
- permite una frontera tecnica limpia entre app y motor

## Hipotesis Tecnica

La mejora real no vendra de "usar otro extractor" por si solo.

La mejora real vendra de este principio:

> cada pagina debe descomprimirse y decodificarse una sola vez, y desde esa unica decodificacion deben salir todos los derivados necesarios.

Pipeline ideal por pagina:

```text
entrada RAR
  -> bytes de imagen descomprimidos
  -> decode una vez
  -> miniatura
  -> version para lector si aplica
  -> persistencia
```

## Aclaracion Sobre Redimensionado

Para redimensionar una imagen raster hay que entrar al dominio de imagen decodificada.

Respuesta corta:

- si, hay que pasar por una representacion de pixeles o equivalente
- no necesariamente a un bitmap gigantesco final
- idealmente el decoder debe permitir, cuando sea posible, bajar costo durante decode

Conclusion operativa:

- el worker debe evitar multiples decodificaciones
- thumb y pagina del lector deben salir del mismo material decodificado

## Arquitectura Objetivo

### Layout Del Worker

Se propone mantenerlo dentro del repo actual, no en otro repo todavia.

Estructura sugerida:

```text
native/
  worker/
    src/
    include/
    vendor/
    build/
    scripts/
```

La razon para mantenerlo dentro del repo actual:

- el contrato con la app va a cambiar mucho
- la iteracion inicial necesita cercania
- separar repos ahora agregaria friccion sin beneficio inmediato

## Contrato Con La App

Interfaz minima del worker:

```bash
comiscopio-worker \
  --input "/ruta/archivo.cbr" \
  --output "/ruta/temp/sesion"
```

Parametros previstos:

- `--thumb-width 180`
- `--thumb-quality 60`
- `--reader-max-dimension 2400`
- `--reader-quality 82`
- `--jobs 1`

La app debe:

1. lanzar el worker
2. leer progreso
3. leer artefactos desde disco
4. cancelar si el usuario cambia de archivo
5. limpiar sesion al cerrar

La app no debe:

- descomprimir
- generar miniaturas
- reducir paginas
- mantener logica complicada de transporte de imagenes

## Formato De Salida

Salida incremental y estable:

```text
sesion/
  manifest.json
  thumbs/
    000000.jpg
  pages/
    000000.webp
  meta/
    000000.json
```

El `manifest.json` debe escribirse progresivamente.

Cada pagina debe poder quedar disponible antes del final completo del archivo.

Eso corrige una version peor de la idea original:

- no conviene que la app espere al final total
- conviene que consuma resultados a medida que aparecen

## Requisitos De Portabilidad

### Regla

No depender de librerias del sistema si puede evitarse.

### Objetivo Practico

El worker debe viajar con sus dependencias.

Escenario aceptable:

- binario principal
- librerias junto al binario
- resolucion local de dependencias

Ejemplos por SO:

- Linux: `rpath` o wrapper con `LD_LIBRARY_PATH`
- macOS: `@loader_path`
- Windows: `.dll` junto al `.exe`

### Targets Iniciales

- `linux-x64`
- `win-x64`
- `macos-x64`
- `macos-arm64`

`linux-arm64` queda como opcional de segunda fase.

## Herramientas Elegidas

### Extraccion

- `UnRAR`

### Imagen

- `libvips`

### Integracion

- worker nativo externo
- app Electron lo invoca por proceso

### Artefactos

- miniaturas: `jpg`
- paginas lector: `webp` o formato equivalente definido por pruebas

## Lo Que Ya Sabemos Que No Queremos

- seguir profundizando la arquitectura actual de miniaturas dentro de Electron
- seguir mezclando transporte, cache y generacion en la app
- depender de callbacks complejos del renderer para un problema que es de pipeline nativo

## Fases De Ejecucion

### Fase 0: Preparacion

- congelar el estado actual en rama dedicada
- mantener esta propuesta como documento vivo del cambio

Estado:

- completado en rama `native-worker-plan`

### Fase 1: Spike Tecnico Del Worker

Objetivo:

- demostrar que `UnRAR + libvips` puede procesar una pagina y producir:
  - thumb
  - pagina reducida

Entregables:

- binario invocable por CLI
- salida minima a carpeta temporal
- medicion de tiempos por etapa

No incluye:

- integracion completa con Electron
- empaquetado final

### Fase 2: Pipeline Secuencial Completo Para CBR

Objetivo:

- recorrer todo el archivo
- emitir resultados progresivos
- producir `manifest.json`

Entregables:

- carpeta de salida estable
- progreso por pagina
- cancelacion basica

### Fase 3: Integracion Con La App

Objetivo:

- que Electron solo orqueste y consuma salida

Trabajo:

- lanzar worker
- escuchar progreso
- leer `manifest.json`
- reemplazar partes del pipeline actual

### Fase 4: Empaquetado Portable

Objetivo:

- dejar los binarios por plataforma junto con sus dependencias

Trabajo:

- layout de artefactos
- deteccion de plataforma
- resolucion local de libs

### Fase 5: Medicion Comparativa

Metricas obligatorias:

- tiempo a primera miniatura
- tiempo a primera pagina disponible
- tiempo total de archivo
- memoria peak del worker
- memoria peak de Electron
- cantidad de decodificaciones por pagina

## Riesgos

### 1. Complejidad De Build

Compilar y empaquetar `UnRAR + libvips` de manera portable no es trivial.

### 2. Integracion De Dependencias

El mayor riesgo operativo no es la idea del worker, sino dejarlo realmente autocontenido.

### 3. Formato De Salida

Si el contrato de artefactos no se diseña bien, la app podria seguir necesitando "magia" alrededor.

### 4. Eleccion De Lenguaje Del Worker

Esto aun no esta fijado. Lo importante aqui es la arquitectura y el stack de dependencias, no el lenguaje.

## Sesgos Y Correccion

### Sesgo 1: pensar que el extractor resolvera todo

Correccion:

No. El extractor solo resuelve una parte. El ahorro fuerte depende de fusionar extraccion, decode y derivados.

### Sesgo 2: pensar que lo nativo automaticamente arregla la UX

Correccion:

No. Si el worker solo entrega todo al final, la UX puede seguir siendo mala. Debe haber emision progresiva.

### Sesgo 3: separar el worker en otro repo para "hacerlo bien"

Correccion:

Todavia no. La frontera tecnica debe ser limpia, pero el monorepo es mejor para esta etapa.

## Veredicto

La direccion del proyecto cambia desde:

- optimizar miniaturas y paginas dentro de Electron

hacia:

- construir un worker nativo autocontenido que convierta el `cbr` en artefactos listos desde una sola pasada

En una sola linea:

> Vamos a sacar el procesamiento duro de imagen y contenedor fuera de Electron y rehacerlo como pipeline nativo incremental con UnRAR y libvips.

## Proximo Paso

Construir el spike de la Fase 1.

Ese spike debe responder, con datos:

1. cuanto cuesta procesar una pagina con este stack
2. cuanto baja el costo frente al pipeline actual
3. si la emision incremental es suficientemente simple
4. como quedan empacadas las dependencias por plataforma
