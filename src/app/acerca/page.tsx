export default function AcercaDe() {
  return (
    <div className="container">
      <div className="card">
        <h1>Acerca del Agente Deutsch</h1>

        <p>
          El Agente Deutsch audita la calidad de las explicaciones que ofrece un texto, no si tiene razón
          sobre el mundo, sino si sus propios argumentos están bien construidos.
        </p>

        <p>
          <strong>En qué se basa.</strong> El criterio central viene de David Deutsch (
          <em>The Beginning of Infinity</em>): una buena explicación es <em>difícil de variar</em>, si le
          cambias los detalles y sigue &ldquo;explicando&rdquo; igual de bien, esos detalles nunca estaban
          haciendo un trabajo real. El agente pone a prueba cada explicación generando sustitutos y viendo
          si el argumento resiste. El criterio se nutre además de ideas de Karl Popper (sobre crítica
          racional y persuasión), y de Michel Meyer (sobre reconstruir la pregunta que un texto responde,
          aunque nunca la formule explícitamente).
        </p>

        <p>
          <strong>Lo que sí hace y lo que no.</strong> El agente mide coherencia interna, no verdad externa:
          no verifica si los hechos que cita un texto son ciertos, ni juzga quién tiene razón en un debate.
          Lo que evalúa es si el razonamiento se sostiene por sí mismo: si sus explicaciones están bien
          ancladas, si sus problemas quedan resueltos o silenciados, y si el texto invita al lector a pensar
          o le cierra el paso con presión emocional en vez de argumentos.
        </p>

        <p>
          <strong>Qué tipos de texto acepta.</strong> Funciona con cualquier texto que ofrezca explicaciones
          genuinas (un mecanismo que resuelve una tensión o un problema), sin importar si trata sobre el
          mundo real o un mundo construido por un autor. Eso incluye artículos de opinión, ensayos,
          no-ficción en general, y también fragmentos de ficción donde un personaje o narrador argumenta por
          qué algo ocurre dentro de las reglas de esa historia; el criterio evaluativo no exige que los
          hechos sean reales, solo que el argumento sea coherente en sus propios términos. Lo que el agente
          descarta, en ficción o no, es la simple narración de eventos sin ningún &ldquo;por qué&rdquo;
          detrás. Debería funcionar razonablemente con discursos y transcripciones de entrevistas también,
          aunque estos géneros están menos probados: un discurso suele tener más pasajes persuasivos que
          explicativos (lo cual el agente reporta correctamente, no como falla), y una entrevista involucra
          dos voces que el agente hoy no distingue explícitamente.
        </p>

        <h2>Cómo funciona: son cinco etapas</h2>

        <ul>
          <li>
            <strong>Problema:</strong> antes de mirar ninguna explicación, el agente busca el conflicto real
            que el texto plantea: una tensión entre lo que se esperaría y lo que se observa, o dos ideas que
            no pueden ser ambas ciertas. Si no encuentra ninguno, el análisis se detiene ahí; sin problema no
            hay nada que explicar.
          </li>
          <li>
            <strong>Explicación:</strong> para cada problema encontrado, busca si el texto ofrece una
            respuesta genuina, y la separa en dos capas: el mecanismo general que invoca (la regla
            universal, sin nombres ni casos concretos) y su aplicación específica al caso del texto. Esa
            separación es la que después permite poner a prueba el mecanismo sin quedar atado a los
            detalles superficiales del ejemplo.
          </li>
          <li>
            <strong>Test:</strong> la etapa central. El agente genera variantes de cada explicación,
            sustituyendo un detalle a la vez, y observa si el argumento sigue funcionando igual de bien. De
            ahí sale el veredicto: <strong>difícil de variar</strong> (resistió los intentos de sustituirla;
            es evidencia real a favor, aunque nunca una prueba definitiva, ya que solo se probó un número
            limitado de alternativas), <strong>fácil de variar</strong> (se encontró un sustituto que
            funciona igual, señal de que el detalle no estaba haciendo un trabajo necesario), o{" "}
            <strong>sin sustituto genuino</strong> (no se logró generar ningún rival real para ponerla a
            prueba, algo distinto de &ldquo;difícil de variar&rdquo;: simplemente no llegó a probarse). En
            esta misma etapa, el agente revisa también si el texto usa recursos retóricos que le cierran el
            paso al lector (apelar a la vergüenza, a la lealtad, a un tabú) en vez de invitarlo a examinar
            el argumento por sus propios méritos, y si la analogía o imagen central de una explicación carga
            más peso persuasivo del que el mecanismo lógico realmente sostiene.
          </li>
          <li>
            <strong>Consecuencia:</strong> para las explicaciones que sobrevivieron el Test, el agente
            pregunta qué preguntas nuevas abren, si el propio autor las reconoce o las deja de lado, y si su
            misma lógica alcanzaría para explicar otros casos que el autor no menciona. También revisa cómo
            se relacionan las distintas explicaciones del texto entre sí: si compiten por el mismo terreno o
            se complementan.
          </li>
          <li>
            <strong>Reporte:</strong> la síntesis final, en prosa ordinaria, sin tecnicismos ni nombres de
            método. Abre con un resumen neutral del texto (qué plantea, en sus propios términos, sin
            adelantar ninguna crítica), y a partir de ahí desarrolla, explicación por explicación, qué tan
            bien construida está cada una, qué preguntas deja abiertas, y cómo trata el texto al lector
            cuando podría cuestionarlo. Sirve tanto para leer con más cuidado el trabajo de otro como para
            revisar el propio: más de un análisis ha terminado señalando, con precisión, en qué punto exacto
            un argumento propio se apoyaba en una imagen persuasiva en vez de en un mecanismo real.
          </li>
        </ul>

        <h2>Un ejemplo real</h2>

        <p>
          En un artículo, una de las explicaciones sostiene que &ldquo;quienes controlen la IA y los
          recursos, aunque mantengan a la gente sin exigirle trabajo, exigirán a cambio simpatía, belleza y
          buen comportamiento, igual que un dueño elige qué mascota conservar.&rdquo;
        </p>

        <p>
          El agente primero separa el mecanismo general (quien sostiene económicamente a otro, sin
          obligarlo a producir, igual conserva la capacidad de retirar ese sostén, y la usa para exigir
          ajuste a sus preferencias) de la aplicación concreta (la analogía con la mascota). Después, en
          Test, genera sustitutos del detalle específico: ¿y si en vez de exigir simpatía y belleza,
          exigieran lealtad ideológica? ¿O que produjeras datos útiles para sus sistemas? ¿O que consumieras
          lo que ellos mismos producen? En los tres casos, la explicación siguió funcionando exactamente
          igual: el detalle concreto resultó intercambiable, señal de que no estaba haciendo un trabajo
          necesario. Veredicto: fácil de variar.
        </p>

        <p>
          Pero el agente encontró algo más, sin que se le pidiera: la propia imagen de la
          &ldquo;mascota&rdquo; carga connotaciones de subordinación e infantilización que el mecanismo
          lógico, despojado de esa imagen, no exige por sí solo; la fuerza persuasiva de la explicación vive
          más en la viveza de la analogía que en la necesidad del argumento. Y encontró una laguna distinta:
          el texto nunca argumenta por qué tener que agradar a quien te sostiene produciría malestar en vez
          de aceptarse con gusto; asume esa reacción, no la explica.
        </p>

        <p>
          Nada de esto significa que el argumento esté mal, o que la analogía sea un truco; significa que
          el reporte final puede decírtelo con esa precisión, en vez de simplemente &ldquo;esto no
          convence.&rdquo;
        </p>

        <p>
          <strong>Biblioteca y Comparación.</strong> Todos los análisis quedan guardados en una biblioteca
          compartida entre los usuarios de la aplicación. Desde ahí puedes elegir dos análisis y
          compararlos: el agente evalúa cuál de los dos textos argumenta con más rigor, sin declarar nunca
          cuál tiene razón sobre el fondo del asunto.
        </p>
      </div>
    </div>
  );
}
