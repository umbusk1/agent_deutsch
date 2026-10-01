import { after } from "next/server";
import { registrarErrorDeStream } from "./stream-errors";
import { registrarDuracion, type Desenlace } from "./step-timings";

const encoder = new TextEncoder();

type Enviar = (data: unknown) => void;

/**
 * Arma una respuesta SSE con heartbeat y cierre defensivo ante desconexión del cliente.
 *
 * El heartbeat existe porque, con llamadas largas a Claude, el navegador puede pasar 30s+ sin recibir
 * ningún byte y algún intermediario entre el cliente y Vercel corta la conexión por inactividad aunque la
 * función termine bien (ERR_CONNECTION_CLOSED con 200 en los logs).
 *
 * Pero cuando el cliente sí se desconecta (o la plataforma cierra la conexión de su lado antes de que
 * terminemos), seguir escribiendo hacia el controller revienta con errores del tipo "Invalid state:
 * Controller is already closed" / ReadableStream ya bloqueado. En vez de confiar en matchear el mensaje de
 * ese error (que puede variar), cada intento de escribir queda protegido con try/catch y una bandera
 * `cerrado` — así detectamos el caso por comportamiento, no por texto. `request.signal` además se
 * suscribe al cierre de la conexión (Next.js lo aborta desde el 'close' de la respuesta Node cuando el
 * cliente se fue antes de que termináramos, ver next-request.js) para no seguir con el heartbeat de más.
 *
 * Importante: a Redis (ver stream-errors.ts) solo va el caso en que ESCRIBIR nosotros mismos al stream
 * falla (enqueue/close revientan) — nunca la desconexión en sí. Que el cliente cierre la pestaña a mitad
 * de un análisis es esperado y ocurre con frecuencia normal; cuando pasa, el handler simplemente sigue,
 * `enviar` pasa a no-opear en silencio, y no queda ningún registro. Si además el handler tira una
 * excepción de negocio (Claude falló, timeout, etc.) mientras el cliente ya se había ido, esa excepción
 * no tiene adónde mandarse pero tampoco es la falla que queremos rastrear acá — es un error de negocio
 * aparte, sin relación con el stream, y contarlo junto con las fallas de escritura ensuciaría la señal.
 */
export function crearRespuestaSse(
  request: Request,
  ruta: string,
  handler: (enviar: Enviar) => Promise<void>
): Response {
  // `void registrarDuracion(...)` (como estaba antes) es fire-and-forget: en una función serverless, nada
  // garantiza que el runtime siga vivo el tiempo suficiente para que esa escritura a Redis termine una vez
  // que la respuesta ya se consideró "enviada" — confirmado en la práctica: faltaban entradas reales en el
  // registro. `after()` (ver node_modules/next/dist/docs/.../functions/after.md) es la API de Next.js
  // pensada exactamente para esto: extiende la vida de la invocación (vía waitUntil en Vercel) hasta que la
  // promesa que le pasamos se resuelva. Se registra acá, de forma SÍNCRONA, al llamar a crearRespuestaSse
  // (dentro del mismo contexto de request del route handler) — el propio callback recién espera la duración
  // real más abajo, una vez que el handler del stream termina.
  let resolverResultado: (resultado: { ms: number; desenlace: Desenlace }) => void;
  const resultadoListo = new Promise<{ ms: number; desenlace: Desenlace }>((resolve) => {
    resolverResultado = resolve;
  });
  after(async () => {
    const { ms, desenlace } = await resultadoListo;
    await registrarDuracion(ruta, ms, desenlace);
  });

  const stream = new ReadableStream({
    async start(controller) {
      let cerrado = false;
      // Para el desenlace: si el único envío que se pudo hacer fue porque el cliente ya se había ido
      // (desconectado=true y nunca se logró enqueue de ningún payload), eso es "cliente-desconectado", no
      // "sin-resultado" — distingue el caso esperado (el usuario cerró la pestaña) de un handler que de
      // verdad terminó sin llamar a enviar().
      let desconectado = false;
      let envioExitoso = false;
      let envioError = false;

      const cerrar = () => {
        if (cerrado) return;
        cerrado = true;
        try {
          controller.close();
        } catch (closeError) {
          void registrarErrorDeStream(ruta, closeError);
        }
      };

      const enviar: Enviar = (data) => {
        if (cerrado) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          if (data && typeof data === "object" && "error" in data) {
            envioError = true;
          } else {
            envioExitoso = true;
          }
        } catch (enqueueError) {
          cerrado = true;
          void registrarErrorDeStream(ruta, enqueueError);
        }
      };

      const heartbeat = setInterval(() => {
        if (cerrado) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch (pingError) {
          cerrado = true;
          clearInterval(heartbeat);
          void registrarErrorDeStream(ruta, pingError);
        }
      }, 10_000);

      const alDesconectar = () => {
        cerrado = true;
        desconectado = true;
      };
      request.signal.addEventListener("abort", alDesconectar);

      const inicio = Date.now();
      try {
        await handler(enviar);
      } catch (error) {
        // Error de negocio (falla de Claude, timeout, etc.), no de escritura al stream — se manda al
        // cliente si sigue ahí (enviar no-opea sola si ya se desconectó) pero no se registra en Redis:
        // esa desconexión ya es esperada y manejada, no la falla que este registro busca detectar.
        console.error(error);
        const message = error instanceof Error ? error.message : "Error desconocido.";
        enviar({ error: message });
      } finally {
        // Resuelve la promesa que after() ya está esperando (arriba) — el registro real a Redis ocurre
        // adentro de ese callback, con la vida de la invocación garantizada por waitUntil. Prioridad:
        // cliente-desconectado solo si NINGÚN envío (ni éxito ni error) llegó a hacerse — si ya se había
        // mandado algo antes de que el cliente se fuera, ese envío es el desenlace real.
        const desenlace: Desenlace =
          desconectado && !envioExitoso && !envioError
            ? "cliente-desconectado"
            : envioError
              ? "error"
              : envioExitoso
                ? "ok"
                : "sin-resultado";
        resolverResultado({ ms: Date.now() - inicio, desenlace });
        clearInterval(heartbeat);
        request.signal.removeEventListener("abort", alDesconectar);
        cerrar();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
