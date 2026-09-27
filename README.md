# Planificador de CPU

Simulador web de algoritmos de planificación de CPU, inspirado en [qplanif](https://github.com/jperelli/Qplanif) (el simulador clásico usado en la cátedra de Introducción a los Sistemas Operativos). Pensado para verificar a mano los ejercicios de diagramas de Gantt, TR, TE, TPR y TPE.

**Demo en vivo:** https://planificador-cpu.vercel.app

## Qué hace

- Simula 7 algoritmos de planificación de CPU:
  - **FCFS** — First Come First Served
  - **SJF** — Shortest Job First (no expulsivo)
  - **SRTF** — Shortest Remaining Time First (expulsivo)
  - **Round Robin** (con quantum configurable)
  - **Prioridades** (no expulsivo)
  - **Prioridades** (expulsivo)
  - **Prioridades + Round Robin** (expulsivo entre prioridades, RR entre procesos de igual prioridad)
- Dos vistas del diagrama de Gantt:
  - **Vista única**: la línea de tiempo clásica de un único procesador (la que se dibuja a mano en los TPs).
  - **Vista por proceso**: una fila por proceso, mostrando los huecos de espera — igual al estilo de qplanif.
- Reproducción animada paso a paso ("Ejecución paso a paso" de qplanif): reproducir, pausar, avanzar/retroceder de a un instante, o arrastrar el slider. Se puede pausar/reproducir con la barra espaciadora.
- Calcula automáticamente TR, TE por proceso y TPR/TPE del lote.
- Carga de procesos por código, con el mismo formato `.def` de qplanif:
  ```
  TAREA "1" INICIO=0 PRIORIDAD=2 [CPU,7]
  TAREA "2" INICIO=0 [CPU,15]
  ```

## Qué no hace (todavía)

- No simula entrada/salida (E/S) ni colas de recursos — solo procesos de CPU pura. Las referencias a recursos en el código `.def` (`[1,3]`, etc.) se ignoran con una advertencia.

## Uso

Abrí `index.html` en cualquier navegador, o entrá directo a la demo. No requiere instalación ni build — es una sola página HTML/CSS/JS sin dependencias externas.

1. Cargá el lote de procesos (a mano en la tabla, o pegando código `.def` con el botón "Cargar desde código").
2. Elegí el algoritmo (y el quantum, si aplica).
3. Apretá **Simular**.
4. Mirá el Gantt reproducirse, y los resultados de TR/TE/TPR/TPE debajo.

## Stack

HTML + CSS + JavaScript vanilla, sin frameworks ni dependencias de build. Paleta de colores basada en los system colors de Apple (SwiftUI/UIKit), tipografía del sistema (San Francisco / SF Mono).

## Origen

Construido durante la cursada de Introducción a los Sistemas Operativos (UNLP, 2do semestre 2026) como herramienta de estudio para el TP2 de planificación de CPU, para verificar ejercicios de forma interactiva en lugar de a mano.
