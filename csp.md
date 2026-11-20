# La política de seguridad del contenido (CSP)

Este documento acompaña al artefacto publicado junto con [MANUAL.md](MANUAL.md).
Explica qué permite la Content-Security-Policy de la aplicación, directiva por
directiva, y por qué está escrita así. La política **no** se copia a mano: la
construye `scripts/csp.mjs`, la escriben las páginas con `scripts/check-csp.mjs
--write` y el gate `node scripts/check-csp.mjs` comprueba que páginas y
documento no se hayan separado.

## Dos capas, dos dueños

La CSP decide **qué puede cargar el navegador**: un `script-src` sin
`'wasm-unsafe-eval'` no instancia el módulo WASM, y un `frame-src` sin el host
de una página no la muestra. Por debajo de esa capa, el kernel decide **qué
puede contener un documento** — qué dirección admite un marco incrustado, qué
enlace se abre, qué bytes son legibles—. Son reglas distintas: la del kernel es
más fina y la de la CSP es más gruesa, y un agujero en una no abre un agujero en
la otra.

Los hosts de `frame-src` son del kernel. La regla que decide qué host admite un
marco (dominio desnudo, o primer label convertido en comodín) no se re-deriva en
la política: el artefacto la publica ya expandida por `allowedFrameHosts`, y
`scripts/csp.mjs` sólo la formatea.

## Cómo viaja la política

- **En el documento**: cada página (`index.html`, `embed.html`, `collab.html`)
  lleva la política en una etiqueta `<meta http-equiv="Content-Security-Policy">`.
  Es lo único que un hosting estático puede garantizar sin configurar cabeceras.
- **En la cabecera**: `scripts/serve.mjs` lee la política de la propia página y
  la devuelve como `Content-Security-Policy` en la respuesta del documento. El
  navegador aplica **las dos** y la efectiva es su intersección; que la cabecera
  y la etiqueta se construyan de la misma fuente es lo que impide que las dos
  capas digan cosas distintas.
- **En el artefacto publicado**: el archivo extraído se sirve con
  `ROOT=<directorio-extraído> node scripts/serve.mjs`, y esa es la receta de
  hosting: el mismo servidor que el gate prueba, con las mismas cabeceras.

## Las directivas

| Directiva | Valor | Por qué |
|---|---|---|
| `default-src` | `'self'` | El cierre por defecto: lo que no se nombre debajo sólo puede venir del mismo origen. |
| `script-src` | `'self' 'wasm-unsafe-eval'` | Los módulos son de este origen, y el WASM se instancia desde bytes, que el navegador rechaza sin `'wasm-unsafe-eval'`. No hay `'unsafe-inline'`: las páginas no llevan script en línea. |
| `style-src` | `'self' 'unsafe-inline'` | La hoja va en el documento y el cliente posiciona elementos con estilos en línea; ambos son de la página, y prohibirlos rompería la disposición sin detener nada que el kernel no detenga ya. |
| `img-src` | `'self' data: blob:` | Las imágenes importadas llegan como data URL y la exportación entrega blob URLs. |
| `font-src` | `'self'` | Las caras viajan con la aplicación; no se piden a un servicio de fuentes. |
| `connect-src` | `'self' http: https: ws: wss:` | La página busca su artefacto y su build-info, y habla con un relevo de colaboración cuyo host elige el usuario, no este repositorio. Los esquemas se permiten enteros a propósito: el relevo es una función entregada (ADR-007). |
| `object-src` | `'none'` | Las páginas no tienen plugin. |
| `base-uri` | `'none'` | Ninguna página lleva `<base>`; prohibirlo impide que una inyección lo añada. |
| `form-action` | `'none'` | Las páginas no tienen formularios. |
| `frame-src` | los hosts y esquemas del kernel | El kernel es el dueño de qué host admite un marco; el artefacto los publica y la política los escribe. |

`frame-ancestors` no se fija: este editor está pensado para incrustarse en otra
página, y una política que lo prohibiera prohibiría el producto.

## Lo que la CSP no hace

- No valida el documento: eso es del kernel y del códec.
- No cifra ni autentica: eso es del transporte (TLS en el hosting) y de la clave
  de sala de la colaboración.
- No sustituye a la revisión del código: una directiva permitida sigue siendo una
  decisión que se lee en `scripts/csp.mjs`.

## Comprobación

`node scripts/check-csp.mjs` (la etapa `csp` del pipeline) verifica tres cosas:
cada página declara exactamente la política del repositorio, los hosts de
`frame-src` son al menos los del kernel y ninguno más, y ninguna página lleva un
script en línea. Además comprueba que este documento nombre cada directiva que
la política escribe: una directiva nueva sin su explicación es una directiva que
nadie puede auditar.
