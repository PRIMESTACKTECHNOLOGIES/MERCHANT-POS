package com.pos2013.offline.emv

/**
 * EMV TLV Parser — parses BER-TLV encoded data from card responses.
 */
object EmvTlv {

    data class TlvNode(val tag: String, val value: ByteArray)

    fun parse(data: ByteArray): List<TlvNode> {
        val nodes = mutableListOf<TlvNode>()
        var i = 0
        while (i < data.size) {
            // Tag
            var tagByte = data[i].toInt() and 0xFF
            var tag = String.format("%02X", tagByte)
            i++
            if ((tagByte and 0x1F) == 0x1F) {
                // Two-byte tag
                if (i >= data.size) break
                val second = data[i].toInt() and 0xFF
                tag += String.format("%02X", second)
                i++
            }
            if (i >= data.size) break

            // Length
            val lenByte = data[i].toInt() and 0xFF
            i++
            val length = when {
                lenByte == 0x81 -> { val l = data[i].toInt() and 0xFF; i++; l }
                lenByte == 0x82 -> { val l = ((data[i].toInt() and 0xFF) shl 8) or (data[i+1].toInt() and 0xFF); i += 2; l }
                else -> lenByte
            }

            if (i + length > data.size) break
            val value = data.slice(i until i + length).toByteArray()
            i += length
            nodes.add(TlvNode(tag, value))
        }
        return nodes
    }

    fun get(nodes: List<TlvNode>, tag: String): ByteArray? =
        nodes.firstOrNull { it.tag.equals(tag, ignoreCase = true) }?.value

    fun getFromResponse(resp: ByteArray, tag: String): ByteArray? =
        get(parse(resp), tag)

    fun toHex(bytes: ByteArray): String =
        bytes.joinToString("") { String.format("%02X", it.toInt() and 0xFF) }

    fun fromHex(hex: String): ByteArray {
        val clean = hex.replace(" ", "")
        return ByteArray(clean.length / 2) { i ->
            clean.substring(i * 2, i * 2 + 2).toInt(16).toByte()
        }
    }

    fun buildTlv(tag: String, value: ByteArray): ByteArray {
        val tagBytes = fromHex(tag)
        val lenBytes = when {
            value.size < 0x80 -> byteArrayOf(value.size.toByte())
            value.size < 0x100 -> byteArrayOf(0x81.toByte(), value.size.toByte())
            else -> byteArrayOf(0x82.toByte(), (value.size shr 8).toByte(), (value.size and 0xFF).toByte())
        }
        return tagBytes + lenBytes + value
    }
}
