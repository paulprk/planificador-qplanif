# Planificador de CPU

Simulador web de algoritmos de planificación de CPU, inspirado en [qplanif](https://github.com/jperelli/Qplanif) (el simulador clásico usado en la cátedra de Introducción a los Sistemas Operativos). Pensado para verificar a mano los ejercicios de diagramas de Gantt, TR, TE, TPR y TPE.

**Demo en vivo:** https://planificador-cpu.vercel.app

## Qué hace

- Simula 8 algoritmos de planificación de CPU:
  - **FCFS** — First Come First Served
  - **SJF** — Shortest Job First (no expulsivo)
  - **SRTF** — Shortest Remaining Time First (expulsivo)
  - **Round Robin** (con quantum configurable)
  - **Round Robin virtual (VRR)** (solo en modo E/S: cola auxiliar para los procesos que vuelven de E/S con quantum pendiente)
  - **Prioridades** (no expulsivo)
  - **Prioridades** (expulsivo)
  - **Prioridades + Round Robin** (expulsivo entre prioridades, RR entre procesos de igual prioridad)
- Modo **E/S**: cada proceso alterna ráfagas de CPU con pedidos a dispositivos de E/S (disco, red, impresora…). Cada dispositivo atiende a un proceso por vez y tiene su propia cola, con política FCFS, SJF o Prioridades. El lote se edita en la página (dispositivos, llegadas, prioridades y pedidos de E/S) o pegando el código. Además del TR y el TE, muestra por separado la espera en la cola de listos, la espera en las colas de los dispositivos y el uso de cada uno.
- Modo **Colas multinivel**: una cola de listos por prioridad, cada una con Round Robin y prioridad entre colas, con o sin apropiación. Con envejecimiento opcional, un proceso que espera N unidades sube a la cola de arriba y vuelve a la suya al obtener la CPU. La cola de listos se muestra fila por fila, una por prioridad.
- Modo **Paginación**: con el tamaño de página, la memoria, el tamaño del proceso y la tabla de páginas, dibuja el espacio de direcciones del proceso, la tabla de páginas, la memoria principal y la tabla de marcos (con la fragmentación interna). Traduce direcciones lógica → física y física → lógica paso a paso, marcando en cada gráfico qué se usa, y opcionalmente corrige tu respuesta.
- Dos vistas del diagrama de Gantt:
  - **Vista única**: la línea de tiempo clásica de un único procesador (la que se dibuja a mano en los TPs).
  - **Vista por proceso**: una fila por proceso, mostrando los huecos de espera — igual al estilo de qplanif.
- Reproducción animada paso a paso ("Ejecución paso a paso" de qplanif): reproducir, pausar, avanzar/retroceder de a un instante, o arrastrar el slider. Se puede pausar/reproducir con la barra espaciadora.
- Costo de cambio de contexto opcional: el SO tarda N unidades en cargar a un proceso distinto del último que usó la CPU (se ve como bloque rayado en el Gantt, no cuenta como uso de CPU y el proceso elegido sigue esperando).
- Envejecimiento (aging) opcional en prioridades: cada N unidades en la cola de listos sube la prioridad del proceso, que vuelve a la base cuando toma la CPU.
- Calcula automáticamente TR, TE por proceso y TPR/TPE del lote.
- **Qué pasa en este instante**: en cada instante explica con palabras quién llega, quién deja la CPU, quién pasa a ejecutar y por qué lo eligió el planificador, junto con la cola de listos (y la de cada dispositivo) en ese momento.
- **Comparar políticas**: corre el mismo lote con todos los algoritmos (y varios quantums) y muestra TPR, TPE, tiempo total, uso de CPU y cambios de contexto lado a lado.
- **Compartir**: al final de la página, "Copiar código" (o "Copiar link") guarda todo lo cargado en el modo actual dentro de un código `PQ1.…`. Al pegarlo en "Cargar código" (o abrir el link) se carga lo mismo y el simulador pasa al modo que corresponde. Los datos viajan comprimidos dentro del código: no hay servidor.
- Carga de procesos por código, con el mismo formato `.def` de qplanif:
  ```
  RECURSO "Disco"

  TAREA "1" INICIO=0 PRIORIDAD=2 [CPU,7] [Disco,3] [CPU,2]
  TAREA "2" INICIO=0 [CPU,15]
  ```
  Si alguna tarea usa un recurso, el lote se carga en modo E/S; si no, en modo simple.

## Límites

- Una simulación se corta a las 5000 unidades de tiempo (muy por encima de cualquier ejercicio), para que un número mal tipeado o un link ajeno no cuelguen la pestaña.
- Los nombres de procesos no pueden llevar comillas ni `#`, porque el formato `.def` no tiene forma de escaparlos: se quitan al escribirlos.

## Uso

Entrá directo a la demo. No requiere instalación ni build — es una sola página HTML/CSS/JS sin dependencias externas.

1. Elegí el modo (simple, E/S, colas multinivel o paginación).
2. Cargá el lote de procesos (a mano, o pegando código `.def` y tocando "Cargar código").
3. Elegí el algoritmo (y el quantum, si aplica).
4. Apretá **Simular**.
5. Mirá el Gantt reproducirse, y los resultados de TR/TE/TPR/TPE debajo.

Para correrlo en tu máquina hace falta servir la carpeta por HTTP (el código usa módulos de JavaScript, que los navegadores no cargan desde `file://`):

```bash
python3 -m http.server 8000
```

y abrir http://localhost:8000.

## Tests

El motor de simulación, el parser del formato `.def`, el código para compartir y la narración no tocan el DOM, así que se prueban con el runner que trae Node (20 o más nuevo), sin instalar nada:

```bash
npm test
```

Los tests de `tests/` son ejercicios resueltos a mano (el Gantt esperado de cada política, casos de E/S, VRR, cambio de contexto, envejecimiento) más comprobaciones generales sobre varios lotes: la CPU atiende de a uno, cada proceso usa exactamente su ráfaga y nunca ejecuta antes de llegar. Para sumar un ejercicio del TP, copiá un test de `tests/algoritmos.test.js`, pegá el lote y escribí el diagrama de la resolución de la cátedra.

## Cómo está armado

| Archivo | Qué hace |
| --- | --- |
| `js/iosim.js` | El motor: simula CPU + dispositivos instante a instante. Lo usan todos los modos de planificación. |
| `js/algorithms.js`, `js/metrics.js`, `js/compare.js` | Entrada del modo simple, cálculo de TR/TE/uso y tabla de comparación. |
| `js/parser.js`, `js/share.js` | Formato `.def` y código para compartir. |
| `js/main.js` | Orquesta: modos, opciones, "Simular" y qué datos viajan al compartir. |
| `js/table.js`, `js/ioeditor.js`, `js/codepreview.js`, `js/sharepanel.js` | Las partes editables de la página: tabla simple, editor de E/S, textarea del código y panel de compartir. |
| `js/gantt.js`, `js/readyqueue.js`, `js/narrate.js`, `js/guide.js`, `js/results.js` | Lo que se dibuja con cada simulación. Los tres primeros leen el mismo objeto de resultado. |
| `js/paging.js` | El modo Paginación, independiente del resto. |
| `js/flip.js`, `js/infopopover.js`, `js/theme.js`, `js/colors.js` | Animaciones, popover de ayuda, tema claro/oscuro y paleta. |

## Stack

HTML + CSS + JavaScript vanilla, sin frameworks ni dependencias de build. Paleta de colores basada en los system colors de Apple (SwiftUI/UIKit), tipografía del sistema (San Francisco / SF Mono).

## Origen

Construido durante la cursada de Introducción a los Sistemas Operativos (UNLP, 2do semestre 2026) como herramienta de estudio para el TP2 de planificación de CPU, para verificar ejercicios de forma interactiva en lugar de a mano.
