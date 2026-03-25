# Propuesta De Cambio

## Resumen

La arquitectura actual resolvió parte del problema de miniaturas al mover su generacion fuera del renderer, pero sigue pagando demasiado costo por pagina:

- descompresion del contenedor
- apertura y decodificacion de imagenes grandes
- generacion de miniaturas
- reduccion condicional para el lector
- transporte y sincronizacion entre procesos

La propuesta es introducir un binario nativo por SO (`gnu/linux`, `windows`, `macos`) que procese el archivo fuente de forma secuencial y emita artefactos listos para consumo por la aplicacion. La app dejaria de hacer trabajo pesado de imagen y pasaria a leer desde una carpeta de salida estable.

La idea central es simple:

`archive entry -> decode una vez -> generar derivados -> persistir`

No se debe pagar dos veces por la misma informacion.

## Problema Actual

Hoy existen tres focos principales:

1. La descompresion del contenedor sigue siendo un costo dominante y aun no esta suficientemente atacada como parte del pipeline completo.
2. Las miniaturas mejoraron, pero siguen costando mucho para archivos grandes porque la decodificacion de la imagen fuente domina el tiempo.
3. El lector aun puede requerir una version reducida de la pagina, lo que reintroduce trabajo redundante si no se aprovecha la misma decodificacion que ya se hizo para la miniatura.

En los logs actuales el patron es consistente:

- `decodeMs` domina el costo de miniaturas
- `resizeMs` es secundario
- `encodeMs` suele ser bajo
- `writeMs` suele ser bajo, pero tiene picos

Conclusion: el problema principal no es el resize. El problema es abrir y decodificar imagenes gigantes demasiadas veces.

## Hipotesis De Cambio

Introducir un proceso nativo, invocado con el archivo de entrada, que:

1. Abra el `cbr`.
2. Recorra sus entradas secuencialmente.
3. Cuando encuentre una imagen:
   - la descomprima
   - la decodifique una sola vez
   - genere la miniatura
   - genere una version reducida para el lector si supera umbrales
   - persista los artefactos resultantes en disco
4. Exponga progreso y estado a la app.
5. Finalice cuando el conjunto de paginas procesadas este listo.

La aplicacion no haria resize ni pipeline de derivacion. Solo consumiria archivos ya materializados.

## Arquitectura Propuesta

### Binario Nativo

Un ejecutable por plataforma:

- `comiscopio-worker-linux`
- `comiscopio-worker-windows.exe`
- `comiscopio-worker-macos`

Interfaz minima:

```bash
comiscopio-worker \
  --input "/ruta/archivo.cbr" \
  --output "/ruta/temp/sesion" \
  --format cbr
```

Parametros futuros:

- `--thumb-width 180`
- `--thumb-quality 60`
- `--reader-max-dimension 2400`
- `--reader-quality 82`
- `--emit-originals false`
- `--jobs 1`

### Carpeta De Salida

La salida debe ser totalmente predecible:

```text
sesion/
  manifest.json
  pages/
    000000.webp
    000001.webp
  thumbs/
    000000.jpg
    000001.jpg
  originals/
    000000.jpg
    000001.png
  meta/
    000000.json
    000001.json
```

La app solo necesita:

- leer `manifest.json`
- mostrar `thumbs/*.jpg`
- mostrar `pages/*.webp`

### Contrato Con La App

La app Electron/Angular pasa a ser un coordinador:

1. lanza el worker
2. observa progreso
3. muestra lo que ya existe en disco
4. cancela o limpia si el usuario cambia de archivo

Esto elimina mucha logica de transporte, colas, URLs especiales y sincronizacion fina entre procesos.

## Pipeline Por Pagina

Pipeline ideal:

1. Leer entrada comprimida desde el contenedor.
2. Descomprimir bytes de la imagen.
3. Decodificar una sola vez a una representacion raster apta para derivacion.
4. Desde esa unica decodificacion:
   - generar miniatura
   - generar pagina reducida para lector si aplica
5. Escribir ambos resultados.

Representacion conceptual:

```text
RAR entry
  -> bytes descomprimidos de imagen
  -> decode raster una vez
  -> resize thumb
  -> resize reader si aplica
  -> encode outputs
  -> persist
```

## Pregunta Clave: Hay Que Llevar La Imagen A Mapa De Bits

En terminos practicos: casi siempre, si.

Pero no necesariamente a un bitmap RGBA gigante y definitivo.

Lo correcto es pensar asi:

- para redimensionar una imagen raster, hay que entrar al dominio de imagen decodificada
- algunos decoders permiten hacer downscale durante decode
- eso puede evitar la peor version del costo

Entonces:

- no se puede asumir que todo resize exige un bitmap full-size completo
- pero tampoco se puede esperar hacer resize util directamente sobre bytes comprimidos del archivo

Para JPEG, por ejemplo, algunos decoders permiten decode reducido. Eso es importante porque muchas paginas de comics vienen en JPEG.

La consecuencia de diseño es:

- el worker debe usar un decoder que permita, cuando sea posible, producir una salida ya reducida
- si no se puede, al menos debe decodificar solo una vez y reutilizar esa salida para ambos derivados

## Compatibilidad Con RAR / RAR5

### Opcion 1: `libarchive`

Ventajas:

- libre
- portable
- buena integracion con pipeline tipo streaming
- razonable como dependencia base del worker

Riesgos:

- RAR es formato propietario
- soporte real de archivos exoticos puede tener bordes
- no asumir compatibilidad perfecta con todos los `cbr` del mundo

Recomendacion:

- primera apuesta tecnica
- ideal para validar arquitectura

### Opcion 2: `unrar`

Ventajas:

- mayor compatibilidad practica con RAR/RAR5
- util como backend de contingencia

Riesgos:

- licencia menos comoda
- menos atractivo si se busca una implementacion totalmente propia y limpia

Recomendacion:

- mantenerlo como plan B si `libarchive` falla en corpus real

### Opcion 3: backend dual

El worker podria abstraer el extractor:

- backend A: `libarchive`
- backend B: `unrar`

Y conmutar por:

- configuracion
- tipo de error
- heuristica por archivo

Eso sube complejidad, asi que no deberia ser la version 1.

## Que Haria Una Persona Top 0.1%

No intentaria optimizar por separado:

- miniaturas
- lector
- extraccion

Lo veria como un unico problema de dataflow.

La pregunta correcta no es:

"como hago miniaturas mas rapido?"

La pregunta correcta es:

"como hago para no decodificar y transformar la misma pagina mas de una vez?"

Esa mirada cambia todo.

## Beneficios Esperados

1. Menos sobreingenieria en la app.
2. Menos trabajo pesado en renderer.
3. Menos acoplamiento entre UI y procesamiento de imagen.
4. Menos duplicacion de decode.
5. Mejor predictibilidad de tiempos.
6. Mejor posibilidad de profiling real del pipeline.
7. Camino mas claro para soportar mas formatos en el futuro.

## Riesgos Y Costos

1. Mantener un binario por plataforma agrega complejidad operativa.
2. Hay que empaquetar y distribuir artefactos nativos.
3. La compatibilidad RAR/RAR5 no debe asumirse sin corpus real.
4. El throughput final dependera mucho del decoder de imagen elegido, no solo del extractor.
5. Si el worker solo produce salida al final, la UX puede empeorar. Conviene emision progresiva.

## Ajuste Importante A La Hipotesis

La frase "la app solo espera por la terminacion de este proceso" conviene corregirla.

Eso seria demasiado rigido para UX.

Mejor:

- el worker debe escribir resultados progresivamente
- la app puede consumir en cuanto existan
- la terminacion completa no debe ser requisito para mostrar primeras paginas y primeras miniaturas

La carpeta sigue siendo simple y estatica, pero la produccion de artefactos debe ser incremental.

## Version 1 Recomendada

### Objetivo

Validar si el ahorro real aparece cuando se unifican:

- extraccion
- decode
- thumb generation
- reader downscale

### Alcance

- soportar solo `cbr`
- procesar en orden secuencial
- producir `thumbs` siempre
- producir `pages` reducidas solo si exceden umbral
- escribir `manifest.json` incremental
- dejar fuera, por ahora:
  - formatos adicionales
  - paralelismo complejo
  - backend dual de extractores

### Politica De Derivacion

Por cada pagina:

- miniatura: siempre
- pagina de lector:
  - si no excede umbral, reutilizar original o copiarla
  - si excede umbral, generar `webp` o formato equivalente reducido

## Plan De Implementacion

### Fase 1

- prototipo del worker con `cbr`
- extractor base con `libarchive`
- decoder de imagen elegido por rendimiento y portabilidad
- carpeta de salida estable
- manifest incremental

### Fase 2

- integrar la app como consumidora simple de carpeta
- eliminar parte del pipeline actual de miniaturas
- medir:
  - tiempo a primera miniatura
  - tiempo a primera pagina lista
  - tiempo total de archivo
  - memoria peak

### Fase 3

- evaluar corpus real de `cbr`
- medir fallos por compatibilidad RAR/RAR5
- decidir si hace falta backend alternativo

## Sesgos Ocultos En Esta Propuesta

### Sesgo 1: "lo nativo siempre es mejor"

Correccion:

No siempre. Si el costo dominante fuera UI o transporte, mover a nativo no resolveria nada. En este caso la evidencia apunta a decode y derivacion de imagen, asi que aqui si parece una apuesta razonable.

### Sesgo 2: "una arquitectura limpia vale cualquier costo"

Correccion:

No. Introducir binarios por SO tiene costo de build, firma, empaquetado, soporte y debugging. Debe justificarse por datos. En este proyecto ya hay suficientes sintomas para tomarlo en serio, pero aun requiere una validacion con prototipo.

### Sesgo 3: "esperar a que termine todo simplifica"

Correccion:

Simplifica la implementacion, pero empeora UX. Lo correcto es carpeta simple con produccion incremental, no carpeta simple con bloqueo total.

## Veredicto

La direccion propuesta es tecnicamente solida y ataca el problema correcto.

La idea valiosa no es solamente "usar un binario nativo". La idea valiosa es esta:

- extraer una vez
- decodificar una vez
- derivar multiples salidas
- persistirlas en una estructura trivial para la app

Si hubiera que resumir la propuesta en una sola linea:

> Mover el trabajo pesado a un worker nativo secuencial que convierta cada pagina en artefactos listos de una sola pasada.

## Recomendacion Final

Construir un prototipo pequeño del worker antes de seguir afinando la arquitectura actual de miniaturas dentro de Electron.

Si el prototipo confirma reduccion significativa en:

- tiempo a primera miniatura
- tiempo a pagina lista
- numero de decodificaciones por pagina
- uso de memoria

entonces valdra la pena reorientar el producto hacia este modelo.
