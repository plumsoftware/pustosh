package ru.pustosh.platform.stub

import ru.pustosh.core.Log
import ru.pustosh.platform.SaveService
import java.io.File

/** Сохранения в файлы `<dir>/<slot>.json`. Запись через временный файл, чтобы не потерять сейв при сбое. */
class FileSaveService(private val dir: File) : SaveService {
    override suspend fun load(slot: String): String? {
        requireValidSlot(slot)
        val file = File(dir, "$slot.json")
        return try {
            if (file.isFile) file.readText() else null
        } catch (e: Exception) {
            Log.e(TAG, "load '$slot'", e)
            null
        }
    }

    override suspend fun save(slot: String, json: String): Boolean {
        requireValidSlot(slot)
        return try {
            dir.mkdirs()
            val tmp = File(dir, "$slot.json.tmp")
            tmp.writeText(json)
            val target = File(dir, "$slot.json")
            if (!tmp.renameTo(target)) {
                target.delete()
                check(tmp.renameTo(target)) { "rename failed" }
            }
            true
        } catch (e: Exception) {
            Log.e(TAG, "save '$slot' to $dir", e)
            false
        }
    }

    private companion object {
        const val TAG = "Saves"
    }
}
