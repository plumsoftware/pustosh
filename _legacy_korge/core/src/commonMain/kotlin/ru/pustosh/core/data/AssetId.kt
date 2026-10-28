package ru.pustosh.core.data

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlin.jvm.JvmInline

/**
 * id спрайта из `assets_manifest.json` (`folder.name`, например `icons.tools.axe_scrap`).
 * В data/<файл>.json картинки записаны путями `assets/...png` — они переводятся в id при загрузке.
 */
@JvmInline
@Serializable(with = AssetIdSerializer::class)
value class AssetId(val id: String) {
    override fun toString() = id

    companion object {
        fun fromPath(path: String): AssetId {
            require(path.startsWith(PREFIX) && path.endsWith(SUFFIX)) { "путь к картинке должен быть assets/...png: '$path'" }
            return AssetId(path.removePrefix(PREFIX).removeSuffix(SUFFIX).replace('/', '.'))
        }

        private const val PREFIX = "assets/"
        private const val SUFFIX = ".png"
    }
}

object AssetIdSerializer : KSerializer<AssetId> {
    override val descriptor = PrimitiveSerialDescriptor("AssetId", PrimitiveKind.STRING)
    override fun deserialize(decoder: Decoder) = AssetId.fromPath(decoder.decodeString())
    override fun serialize(encoder: Encoder, value: AssetId) =
        encoder.encodeString("assets/" + value.id.replace('.', '/') + ".png")
}
