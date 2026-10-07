"""Copia un set seleccionado de emojis Twemoji (CC-BY 4.0) a /assets/emojis.

Uso (una sola vez, ya se incluye el resultado en el repositorio):
    cd frontend && npm install && cd .. && python backend/tools/build_emojis.py
"""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "frontend" / "node_modules" / "@twemoji" / "svg"
DST = ROOT / "assets" / "emojis"

# emoji -> palabras clave (en español) que ayudan a Claude a elegir
EMOJIS = {
    "😀": "feliz alegría sonrisa", "😂": "risa gracioso jajaja", "🤣": "carcajada muy gracioso",
    "😊": "contento amable", "😍": "encanta amor precioso", "🥰": "cariño adorable",
    "😎": "guay chulo genial", "🤔": "pensar duda pregunta", "🤯": "alucinante mente explota sorpresa",
    "😱": "miedo susto impactante", "😮": "sorpresa asombro", "😢": "triste pena", "😭": "llorar muy triste",
    "😡": "enfadado rabia", "😅": "nervios uf alivio", "🙄": "aburrido obvio", "😴": "sueño dormir cansado",
    "🤩": "emocionado estrellas wow", "🥳": "fiesta celebrar cumpleaños", "😇": "inocente bueno",
    "🤫": "secreto silencio", "🤐": "callar no decir", "🤑": "dinero ganar rico", "🤓": "aprender estudiar friki",
    "😬": "incómodo ups", "🫡": "respeto saludo", "🙃": "ironía", "😏": "pícaro", "🥺": "por favor tierno",
    "👍": "bien de acuerdo ok", "👎": "mal no", "👏": "aplausos bravo", "🙌": "celebrar bien hecho",
    "🙏": "gracias por favor", "💪": "fuerza fuerte gimnasio esfuerzo", "👀": "mirar atención ojo",
    "👋": "hola adiós saludo", "✌️": "paz victoria", "🤝": "acuerdo trato colaboración",
    "👉": "señalar esto", "👆": "arriba aquí", "👇": "abajo debajo enlace", "☝️": "importante uno",
    "🤞": "suerte ojalá", "✅": "correcto hecho sí check", "❌": "incorrecto no error",
    "⚠️": "cuidado aviso peligro", "❗": "importante atención", "❓": "pregunta duda", "💯": "cien perfecto total",
    "🔥": "fuego increíble tendencia caliente", "⭐": "estrella destacado", "✨": "magia brillo nuevo",
    "💡": "idea consejo truco", "🎯": "objetivo meta precisión", "🚀": "rápido despegar crecer lanzamiento",
    "📈": "crecer subir datos", "📉": "bajar caer pérdida", "💰": "dinero ahorro precio", "💸": "gastar dinero caro",
    "💵": "dólares pago", "🏆": "ganar trofeo premio mejor", "🥇": "primero ganador oro", "🎉": "fiesta celebrar enhorabuena",
    "🎁": "regalo sorteo", "❤️": "amor corazón me gusta", "💔": "desamor roto", "💥": "explosión impacto boom",
    "⚡": "energía rápido rayo", "🌟": "brillante especial", "🧠": "cerebro inteligente pensar mente",
    "⏰": "tiempo hora despertador", "⏳": "esperar tiempo", "📅": "fecha calendario día", "📌": "importante nota fijar",
    "📝": "apuntar notas escribir", "📚": "libros estudiar", "📱": "móvil teléfono app", "💻": "ordenador portátil trabajo",
    "🖥️": "pantalla ordenador", "⌨️": "teclado escribir", "🎮": "videojuego jugar", "🎬": "vídeo cine grabar",
    "🎥": "cámara grabar", "📷": "foto cámara", "🎤": "micrófono hablar cantar", "🎧": "auriculares música escuchar",
    "🎵": "música canción", "🔊": "volumen sonido", "🔇": "silencio sin sonido", "📣": "anuncio aviso",
    "🔔": "notificación suscribir campana", "🔍": "buscar lupa investigar", "🔑": "clave llave secreto",
    "🔒": "seguro privado", "🛠️": "herramientas arreglar", "⚙️": "ajustes configuración", "🧪": "experimento prueba",
    "🧩": "pieza encajar puzle", "🤖": "robot ia inteligencia artificial", "👾": "videojuego retro",
    "🌍": "mundo planeta viaje", "✈️": "viaje avión", "🏠": "casa hogar", "🚗": "coche conducir", "🏃": "correr deporte prisa",
    "⚽": "fútbol deporte", "🏀": "baloncesto", "🍕": "pizza comida", "🍔": "hamburguesa comida", "☕": "café mañana",
    "🍺": "cerveza bar", "🍷": "vino cena", "🎂": "tarta cumpleaños", "🍿": "palomitas película",
    "🌞": "sol verano buen día", "🌧️": "lluvia mal tiempo", "❄️": "frío nieve invierno", "🌈": "arcoíris colores",
    "🐶": "perro mascota", "🐱": "gato mascota", "🦄": "unicornio único", "🌱": "crecer planta empezar",
    "🌹": "rosa flor", "🐐": "el mejor goat", "💀": "muerto de risa muerto", "👻": "fantasma", "👑": "rey reina mejor",
    "💎": "valioso diamante", "🛒": "comprar tienda", "📦": "paquete envío", "🧾": "factura recibo", "💳": "tarjeta pagar",
    "🗣️": "hablar decir", "💬": "mensaje comentario chat", "🤷": "no sé da igual", "🤦": "facepalm error tonto",
    "🙋": "pregunta yo levantar mano", "👨‍💻": "programador trabajo", "📊": "gráfico estadísticas",
    "🆕": "nuevo novedad", "🆓": "gratis", "🔝": "top mejor", "➡️": "siguiente derecha", "⬅️": "anterior izquierda",
    "🔄": "repetir actualizar", "➕": "más añadir", "➖": "menos quitar",
}


def codepoints(e: str) -> str:
    cps = [f"{ord(c):x}" for c in e]
    # Twemoji omite el selector de variación FE0F salvo en secuencias ZWJ
    if "200d" not in cps:
        cps = [c for c in cps if c != "fe0f"]
    return "-".join(cps)


def main():
    DST.mkdir(parents=True, exist_ok=True)
    index = []
    for e, kw in EMOJIS.items():
        name = codepoints(e)
        src = SRC / f"{name}.svg"
        if not src.exists():
            print("No encontrado:", e, name)
            continue
        shutil.copy(src, DST / f"{name}.svg")
        index.append({"emoji": e, "file": f"{name}.svg", "keywords": kw})
    (DST / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    print(len(index), "emojis copiados")


if __name__ == "__main__":
    main()
