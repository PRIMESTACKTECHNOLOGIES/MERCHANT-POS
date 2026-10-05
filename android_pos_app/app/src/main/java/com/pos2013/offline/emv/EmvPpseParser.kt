package com.pos2013.offline.emv

/**
 * Parses the PPSE (Proximity Payment System Environment) response
 * to extract available AIDs for application selection.
 */
object EmvPpseParser {

    data class ApplicationEntry(val aid: ByteArray, val label: String, val priority: Int)

    fun parse(ppseResponse: ByteArray): List<ApplicationEntry> {
        val apps = mutableListOf<ApplicationEntry>()
        val nodes = EmvTlv.parse(ppseResponse)

        // FCI (6F) → FCI Proprietary (A5) → Dir Entry (BF0C) → Application (61)
        fun findApps(data: ByteArray) {
            val sub = EmvTlv.parse(data)
            for (node in sub) {
                if (node.tag.equals("61", ignoreCase = true)) {
                    val inner = EmvTlv.parse(node.value)
                    val aid   = EmvTlv.get(inner, "4F") ?: continue
                    val label = EmvTlv.get(inner, "50")?.toString(Charsets.US_ASCII) ?: "Unknown"
                    val prio  = EmvTlv.get(inner, "87")?.getOrNull(0)?.toInt() ?: 99
                    apps.add(ApplicationEntry(aid, label, prio))
                } else if (node.tag in listOf("6F","A5","BF0C","70")) {
                    findApps(node.value)
                }
            }
        }
        findApps(ppseResponse)

        return apps.sortedBy { it.priority }
    }

    fun selectBestAid(apps: List<ApplicationEntry>): ByteArray? {
        // Prefer Visa (A000000003), then MC (A000000004)
        val visaPrefix  = "A000000003"
        val mcPrefix    = "A000000004"
        return apps.firstOrNull { EmvTlv.toHex(it.aid).startsWith(visaPrefix) }?.aid
            ?: apps.firstOrNull { EmvTlv.toHex(it.aid).startsWith(mcPrefix) }?.aid
            ?: apps.firstOrNull()?.aid
    }
}
